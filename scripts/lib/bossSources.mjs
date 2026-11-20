// Fontes de um boss novo: tabelas do jogo (wago.tools), módulo do BigWigs e reports do Warcraft Logs.
// Tudo com cache em samples/boss/ (fora do git); nada pessoal nas requisições (User-Agent genérico).

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync, execFileSync } from 'node:child_process';

export const ROOT = path.join(import.meta.dirname, '..', '..');
const UA = 'wipe-cause-dev';
const DB2_DIR = path.join(ROOT, 'samples', 'boss', '.db2');
const BW_DIR = path.join(ROOT, 'samples', 'boss', '.bigwigs');

// ───────────────────────── CSV em fluxo ─────────────────────────

/**
 * Parser de CSV incremental: aspas, `""` dentro de campo e quebra de linha dentro de aspas.
 * `push(texto)` devolve as linhas completas; `end()` devolve a última, se faltar o \n final.
 */
export class CsvParser {
  constructor() {
    this.row = [];
    this.field = '';
    this.quoted = false; // dentro de aspas
    this.pendingQuote = false; // vimos uma aspa dentro de aspas: pode ser fecho ou `""`
    this.pendingCr = false;
    this.started = false; // a linha atual tem algo
  }
  push(chunk) {
    const rows = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.pendingCr) {
        this.pendingCr = false;
        if (c === '\n') continue;
      }
      if (this.quoted) {
        if (this.pendingQuote) {
          this.pendingQuote = false;
          if (c === '"') {
            this.field += '"';
            continue;
          }
          this.quoted = false; // era o fecho; trata `c` como fora de aspas
        } else if (c === '"') {
          this.pendingQuote = true;
          continue;
        } else {
          this.field += c;
          continue;
        }
      }
      if (c === '"' && this.field === '') {
        this.quoted = true;
        this.started = true;
      } else if (c === ',') {
        this.row.push(this.field);
        this.field = '';
        this.started = true;
      } else if (c === '\n' || c === '\r') {
        if (c === '\r') this.pendingCr = true;
        if (this.started || this.field !== '') {
          this.row.push(this.field);
          rows.push(this.row);
        }
        this.row = [];
        this.field = '';
        this.started = false;
      } else {
        this.field += c;
        this.started = true;
      }
    }
    return rows;
  }
  end() {
    this.pendingQuote = false;
    if (this.started || this.field !== '') {
      this.row.push(this.field);
      const r = this.row;
      this.row = [];
      this.field = '';
      this.started = false;
      return [r];
    }
    return [];
  }
}

/** Lê um CSV de uma stream (Node Readable) e chama `onRow(objeto)` por linha, pelo cabeçalho da primeira. */
export async function streamCsv(readable, onRow) {
  const parser = new CsvParser();
  const dec = new TextDecoder('utf-8');
  let header = null;
  const feed = (rows) => {
    for (const r of rows) {
      if (!header) {
        header = r.map((h) => h.replace(/^﻿/, ''));
        continue;
      }
      const o = {};
      for (let i = 0; i < header.length; i++) o[header[i]] = r[i] ?? '';
      onRow(o);
    }
  };
  for await (const chunk of readable) feed(parser.push(typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true })));
  feed(parser.push(dec.decode()));
  feed(parser.end());
}

/** Linhas de um texto CSV inteiro (para testes e arquivos pequenos). */
export function parseCsv(text) {
  const rows = [];
  void streamCsvSync(text, (o) => rows.push(o));
  return rows;
}
function streamCsvSync(text, onRow) {
  const p = new CsvParser();
  let header = null;
  for (const r of [...p.push(text), ...p.end()]) {
    if (!header) header = r.map((h) => h.replace(/^﻿/, ''));
    else onRow(Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  }
}

// ───────────────────────── wago.tools ─────────────────────────

/**
 * Tabela do jogo em CSV (wago.tools/db2/<tabela>/csv) como objetos (todos os valores em texto).
 * O arquivo vai para `cacheDir/<tabela>.csv` (baixado de novo com `fresh`) e é lido em fluxo; `filter(row)`
 * decide por linha o que fica, então tabelas de dezenas de MB nunca ficam inteiras na memória.
 */
export async function loadDb2(table, { cacheDir = DB2_DIR, fresh = false, filter = null } = {}) {
  if (!/^\w+$/.test(table)) throw new Error(`tabela inválida: ${table}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${table}.csv`);
  if (fresh || !fs.existsSync(file) || fs.statSync(file).size === 0) {
    const res = await fetch(`https://wago.tools/db2/${table}/csv`, { headers: { 'User-Agent': UA } });
    if (!res.ok || !res.body) throw new Error(`wago.tools/${table}: HTTP ${res.status}`);
    const tmp = `${file}.part`;
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    fs.renameSync(tmp, file);
  }
  const out = [];
  await streamCsv(fs.createReadStream(file, { encoding: 'utf8' }), (row) => {
    if (!filter || filter(row)) out.push(row);
  });
  return out;
}

/** Bits de `IconFlags` do Encounter Journal. */
export const ICON_FLAGS = ['tank', 'damage', 'healer', 'heroic', 'deadly', 'important', 'interruptible', 'magic', 'curse', 'poison', 'disease', 'enrage', 'mythic', 'bleed'];
export const flagNames = (bits) => ICON_FLAGS.filter((_, i) => (Number(bits) >> i) & 1);

const SHAPES = { 0: 'sphere', 1: 'box', 2: 'unk2', 3: 'polygon', 4: 'cylinder', 5: 'unk5', 6: 'unk6', 7: 'disk' };
const CREATE_AREATRIGGER = '179';
const num = (s) => (s === '' || s == null ? 0 : Number(s));

/**
 * Journal de um encontro pelo `DungeonEncounterID` + dados de cada spell citado.
 * `opts`: `{ cacheDir, fresh, extraSpellIds: [..] }`. Devolve `null` se o encontro não existe no Journal.
 */
export async function journal(encounterId, opts = {}) {
  const o = { cacheDir: opts.cacheDir, fresh: opts.fresh };
  const enc = (await loadDb2('JournalEncounter', { ...o, filter: (r) => Number(r.DungeonEncounterID) === Number(encounterId) }))[0];
  if (!enc) return null;
  const journalId = Number(enc.ID);
  const [inst] = await loadDb2('JournalInstance', { ...o, filter: (r) => r.ID === enc.JournalInstanceID });
  const rawSections = await loadDb2('JournalEncounterSection', { ...o, filter: (r) => Number(r.JournalEncounterID) === journalId });

  const spellIds = new Set([...rawSections.map((s) => Number(s.SpellID)).filter((n) => n > 0), ...(opts.extraSpellIds ?? []).map(Number)]);
  const inSet = (r) => spellIds.has(Number(r.SpellID));
  const [names, descs, effects, misc] = await Promise.all([
    loadDb2('SpellName', { ...o, filter: (r) => spellIds.has(Number(r.ID)) }),
    loadDb2('Spell', { ...o, filter: (r) => spellIds.has(Number(r.ID)) }).catch(() => []),
    loadDb2('SpellEffect', { ...o, filter: inSet }),
    loadDb2('SpellMisc', { ...o, filter: inSet }),
  ]);
  const radii = new Map((await loadDb2('SpellRadius', o)).map((r) => [r.ID, num(r.Radius)]));
  const durations = new Map((await loadDb2('SpellDuration', o)).map((r) => [r.ID, num(r.Duration)]));
  const casts = new Map((await loadDb2('SpellCastTimes', o)).map((r) => [r.ID, num(r.Base)]));
  const nameOf = new Map(names.map((r) => [Number(r.ID), r.Name_lang]));
  const descOf = new Map(descs.map((r) => [Number(r.ID), r.Description_lang]));

  // forma do areatrigger: Effect 179 com EffectMiscValue_0 = id em AreaTriggerCreateProperties
  const atIds = new Set(effects.filter((e) => e.Effect === CREATE_AREATRIGGER).map((e) => e.EffectMiscValue_0));
  const shapeOf = new Map(
    atIds.size ? (await loadDb2('AreaTriggerCreateProperties', { ...o, filter: (r) => atIds.has(r.ID) })).map((r) => [r.ID, SHAPES[num(r.ShapeType)] ?? `shape${r.ShapeType}`]) : [],
  );

  const spells = {};
  for (const id of spellIds) {
    const eff = effects.filter((e) => Number(e.SpellID) === id);
    const rad = new Set();
    for (const e of eff) for (const k of ['EffectRadiusIndex_0', 'EffectRadiusIndex_1']) if (e[k] && e[k] !== '0' && radii.get(e[k])) rad.add(radii.get(e[k]));
    // uma linha de SpellMisc por dificuldade: vale a base (0) se tiver, senão a primeira
    const ms = misc.filter((m) => Number(m.SpellID) === id);
    const m = ms.find((x) => x.DifficultyID === '0') ?? ms[0];
    const dur = m ? durations.get(m.DurationIndex) : 0;
    const cast = m ? casts.get(m.CastingTimeIndex) : 0;
    const at = eff.find((e) => e.Effect === CREATE_AREATRIGGER);
    spells[id] = {
      name: nameOf.get(id) ?? null,
      description: descOf.get(id) || null,
      radiusYd: [...rad].sort((a, b) => a - b),
      durationMs: dur > 0 ? dur : null,
      castMs: cast > 0 ? cast : null,
      areaTriggerShape: at ? (shapeOf.get(at.EffectMiscValue_0) ?? null) : null,
    };
  }

  const sections = rawSections
    .map((s) => {
      const spellId = Number(s.SpellID) || 0;
      const generic = /^Section \d+$/i.test(s.Title_lang);
      return {
        id: Number(s.ID),
        parentId: Number(s.ParentSectionID) || 0,
        title: generic && spellId && nameOf.get(spellId) ? nameOf.get(spellId) : s.Title_lang,
        spellId,
        flags: flagNames(s.IconFlags),
        difficultyMask: Number(s.DifficultyMask),
        body: s.BodyText_lang ?? '',
        order: Number(s.OrderIndex) || 0,
      };
    })
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .map(({ order: _o, ...rest }) => rest);

  return { encounterId: Number(encounterId), journalId, name: enc.Name_lang, instance: { id: Number(enc.JournalInstanceID), name: inst?.Name_lang ?? null }, sections, spells };
}

// ───────────────────────── BigWigs ─────────────────────────

const gh = (args) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 2 ** 28, stdio: ['ignore', 'pipe', 'pipe'] });

/** Lê o módulo .lua do BigWigs (texto) e tira npcs, auras, opções e `self:Log`. */
export function parseBigWigsLua(src) {
  const npcs = [];
  for (const m of src.matchAll(/RegisterEnableMob\(([^)]*)\)/g)) for (const n of m[1].matchAll(/\b\d{4,}\b/g)) npcs.push(Number(n[0]));

  // SetAuraData({ {id, ...}, -- Nome (tank)
  const auras = [];
  const aura = src.match(/SetAuraData\(\{([\s\S]*?)\n\}\)/);
  if (aura) {
    for (const line of aura[1].split('\n')) {
      const m = line.match(/^\s*\{\s*(\d+)/);
      if (!m) continue;
      const c = line.match(/--\s*(.*)$/)?.[1]?.trim() ?? '';
      auras.push({ spellId: Number(m[1]), name: c.replace(/\s*\(.*?\)\s*/g, ' ').trim(), tank: /\(\s*tank\s*\)/i.test(c) });
    }
  }

  // GetOptions: primeiro bloco `return { ... }, {`; ids positivos no começo de cada linha (sem chaves `[id] =`)
  const options = [];
  const go = src.match(/function mod:GetOptions\(\)\s*return\s*\{([\s\S]*?)\n\t\}/);
  if (go) {
    for (const line of go[1].split('\n')) {
      const m = line.replace(/--.*$/, '').match(/^\s*\{?\s*(\d{4,})\b/);
      if (m) options.push(Number(m[1]));
    }
  }

  const logs = [];
  for (const m of src.matchAll(/self:Log\(\s*"(\w+)"\s*,\s*"(\w+)"\s*((?:,\s*\d+\s*)*)\)/g)) {
    logs.push({ event: m[1], handler: m[2], ids: [...m[3].matchAll(/\d+/g)].map((n) => Number(n[0])) });
  }
  return { npcs: [...new Set(npcs)], auras, options: [...new Set(options)], logs };
}

/**
 * Módulo do BigWigs do encontro (arquivo com `SetEncounterID(<id>)`), com cache em samples/boss/.bigwigs/.
 * Usa o `gh` (busca de código; sem resultado, varre as pastas cujo nome lembra a raide). `null` se não achar.
 */
export function bigwigs(encounterId, opts = {}) {
  const cacheDir = opts.cacheDir ?? BW_DIR;
  fs.mkdirSync(cacheDir, { recursive: true });
  const idx = path.join(cacheDir, `enc-${encounterId}.json`);
  let hit = !opts.fresh && fs.existsSync(idx) ? JSON.parse(fs.readFileSync(idx, 'utf8')) : null;
  if (!hit) {
    let src = null;
    let file = null;
    try {
      const items = JSON.parse(gh([`search/code?q=SetEncounterID(${encounterId})+repo:BigWigsMods/BigWigs`, '--jq', '.items'])) ?? [];
      for (const it of items) {
        const t = gh(['-H', 'Accept: application/vnd.github.raw', `repos/BigWigsMods/BigWigs/contents/${it.path}`]);
        if (new RegExp(`SetEncounterID\\(\\s*${encounterId}\\s*\\)`).test(t)) {
          file = it.path;
          src = t;
          break;
        }
      }
    } catch {
      /* sem gh, sem rede ou limite da busca: cai para null */
    }
    if (!src) return null;
    hit = { file, src };
    fs.writeFileSync(idx, JSON.stringify(hit));
  }
  return { file: hit.file, ...parseBigWigsLua(hit.src) };
}

// ───────────────────────── Warcraft Logs ─────────────────────────

/** Clientes de samples/wcl-credentials.env (CHAVE=valor; _2, _3... são clientes extras). */
function fileCredentials() {
  const f = path.join(ROOT, 'samples', 'wcl-credentials.env');
  if (!fs.existsSync(f)) return [];
  const kv = Object.fromEntries(
    fs
      .readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
  const out = [];
  for (let n = 1; ; n++) {
    const sfx = n === 1 ? '' : `_${n}`;
    if (!kv[`WCL_CLIENT_ID${sfx}`] || !kv[`WCL_CLIENT_SECRET${sfx}`]) break;
    out.push({ id: kv[`WCL_CLIENT_ID${sfx}`], secret: kv[`WCL_CLIENT_SECRET${sfx}`] });
  }
  return out;
}

/** Credenciais: ambiente primeiro, depois o arquivo de testes. Nada é impresso. */
export function wclCredentials() {
  const { WCL_CLIENT_ID: id, WCL_CLIENT_SECRET: secret } = process.env;
  if (id && secret) return { id, secret };
  const f = fileCredentials();
  if (f.length) return f[0];
  throw new Error('sem credenciais do Warcraft Logs: defina WCL_CLIENT_ID e WCL_CLIENT_SECRET ou crie samples/wcl-credentials.env');
}

async function wclQuery(query, variables) {
  const { id, secret } = wclCredentials();
  const tr = await fetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'grant_type=client_credentials',
  });
  if (!tr.ok) throw new Error(`token do Warcraft Logs: HTTP ${tr.status}`);
  const { access_token: token } = await tr.json();
  const res = await fetch('https://www.warcraftlogs.com/api/v2/client', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* página de erro */
  }
  if (j?.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
  if (!res.ok || !j?.data) throw new Error(`API do Warcraft Logs: HTTP ${res.status}`);
  return j.data;
}

/**
 * Códigos de report distintos dos kills mais recentes do boss (`fightRankings`, ordenados por data).
 * `difficulty` do WCL: 3 normal, 4 heroico, 5 mítico.
 */
export async function wclTopReports(encounterId, { difficulty = 5, n = 5 } = {}) {
  const Q = `query($id:Int!,$d:Int!,$p:Int!){worldData{encounter(id:$id){fightRankings(difficulty:$d,page:$p,metric:speed)}}}`;
  const rows = [];
  for (let page = 1; page <= 5; page++) {
    const d = await wclQuery(Q, { id: Number(encounterId), d: difficulty, p: page });
    const r = d.worldData?.encounter?.fightRankings;
    rows.push(...(r?.rankings ?? []));
    if (!r?.hasMorePages) break;
  }
  const seen = new Set();
  return rows
    .filter((r) => r.report?.code)
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
    .filter((r) => !seen.has(r.report.code) && seen.add(r.report.code))
    .slice(0, n)
    .map((r) => r.report.code);
}

/**
 * Baixa o report com o `scripts/wcl-fetch.mjs` (pula se a pasta já tem `report.json`). Com `encounter`
 * (e `difficulty` do WCL), só os pulls desse boss: um report da noite inteira passa de 1 GB. Devolve a pasta.
 */
export function fetchWclReport(code, outDir, { encounter, difficulty } = {}) {
  if (fs.existsSync(path.join(outDir, 'report.json'))) return outDir;
  fs.mkdirSync(outDir, { recursive: true });
  const { id, secret } = wclCredentials();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'wcl-fetch.mjs'), code, outDir], {
    env: { ...process.env, WCL_CLIENT_ID: id, WCL_CLIENT_SECRET: secret, WCL_ENCOUNTER: encounter ? String(encounter) : '', WCL_DIFFICULTY: difficulty ? String(difficulty) : '' },
    encoding: 'utf8',
    maxBuffer: 2 ** 28,
  });
  if (r.status !== 0) throw new Error(`wcl-fetch ${code} falhou: ${(r.stderr || '').slice(0, 200)}`);
  return outDir;
}
