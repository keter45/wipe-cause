// Boss novo num comando (docs/designs/boss-new.md): coleta → rascunho da regra → medição → arena →
// conferência → relatório. Cada etapa grava em samples/boss/<slug>/ (fora do git) e reaproveita o cache.
// No fim, um relatório OK / ATENÇÃO / REVISAR por etapa; a skill boss-new resolve os REVISAR.
//
//   npm run boss:new -- <encounter_id>                                   sem log: coleta e rascunho
//   npm run boss:new -- <encounter_id> --tops 6                          + 6 reports recentes de kill do WCL
//   npm run boss:new -- <encounter_id> --log <WoWCombatLog.txt>          + a noite da guilda (e o sim:check)
//   npm run boss:new -- <encounter_id> --wcl <código>[,<código>]          + reports do WCL escolhidos
//   --difficulty Mythic|Heroic|Normal (padrão Mythic)   --only <coleta|rascunho|medicao|arena|conferencia>
//   --fresh (baixa tudo de novo)   --no-build (não recompila o wipe-cli)
//
// Credenciais do WCL: as do `refresh` (ambiente ou samples/wcl-credentials.env). Nada pessoal vai nas
// requisições. A regra existente nunca é sobrescrita: o rascunho vai para <boss>.draft.yaml ao lado.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, WIPE_CLI, wipeCli } from './lib/checks.mjs';
import { bigwigs, fetchWclReport, journal, wclTopReports } from './lib/bossSources.mjs';
import { draftRule, slug } from './lib/bossDraft.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const flag = (n) => argv.includes(`--${n}`);
const all = (n) => argv.flatMap((a, i) => (a === `--${n}` ? String(argv[i + 1] ?? '').split(',') : [])).filter(Boolean);
const encounterId = Number(argv.find((a, i) => /^\d+$/.test(a) && !argv[i - 1]?.startsWith('--')));
if (!encounterId) {
  console.error('uso: npm run boss:new -- <encounter_id> [--log <WoWCombatLog.txt>]... [--wcl <código>]... [--tops N] [--difficulty Mythic] [--only <etapa>] [--fresh]');
  process.exit(1);
}
const DIFF = { Mythic: [16, 5], Heroic: [15, 4], Normal: [14, 3] };
const diffName = opt('difficulty', 'Mythic');
const [gameDiff, wclDiff] = DIFF[diffName] ?? DIFF.Mythic;
const only = opt('only');
const fresh = flag('fresh');
const STAGES = ['coleta', 'rascunho', 'medicao', 'arena', 'conferencia'];
if (only && !STAGES.includes(only)) throw new Error(`etapa desconhecida: ${only} (${STAGES.join(', ')})`);
const runs = (s) => !only || only === s;

/** Etapas do relatório: { nome, status, linhas }. */
const stages = [];
function stage(name) {
  const s = { name, status: 'OK', lines: [], items: [] };
  stages.push(s);
  console.log(`\n== ${name}`);
  return s;
}
const RANK = { OK: 0, PULADO: 0, ATENÇÃO: 1, REVISAR: 2 };
function add(s, level, text) {
  s.items.push({ level, text });
  if (RANK[level] > RANK[s.status]) s.status = level;
  console.log(`  ${level} ${text}`);
}
const rel = (f) => path.relative(ROOT, f).replaceAll(path.sep, '/');
const readJson = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
function run(cmd, args, { capture = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 31 - 1, stdio: capture ? 'pipe' : 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// ---------------------------------------------------------------- 1. coleta

const BOSS_ROOT = path.join(ROOT, 'samples', 'boss');
fs.mkdirSync(BOSS_ROOT, { recursive: true });
// o slug sai do Journal; até lá, uma pasta pelo id
let dir = path.join(BOSS_ROOT, String(encounterId));
let sources = readJson(path.join(dir, 'sources.json'));
{
  const s = stage('1. Coleta');
  if (runs('coleta') || !sources) {
    const bw = bigwigs(encounterId, { fresh });
    const extra = [...new Set([...(bw?.auras ?? []).map((a) => a.spellId), ...(bw?.options ?? []).filter((x) => typeof x === 'number'), ...(bw?.logs ?? []).flatMap((l) => l.ids)])];
    const j = await journal(encounterId, { fresh, extraSpellIds: extra });
    sources = { encounterId, journal: j, bigwigs: bw, fetched: new Date().toISOString() };
  }
  const j = sources.journal;
  if (!j) add(s, 'REVISAR', `o encounter ${encounterId} não está no Encounter Journal (wago.tools): confira o id (o do ENCOUNTER_START).`);
  else s.lines.push(`- **Journal:** ${j.name} (${j.instance?.name}), ${j.sections.length} seções, ${Object.keys(j.spells).length} spells com dados do jogo`);
  if (!sources.bigwigs) add(s, 'ATENÇÃO', 'módulo do BigWigs não achado (precisa do `gh` autenticado): os ids por papel ficam só com o log.');
  else s.lines.push(`- **BigWigs:** \`${sources.bigwigs.file}\`, ${sources.bigwigs.npcs.length} npcs, ${sources.bigwigs.auras.length} auras, ${sources.bigwigs.logs.length} eventos`);
  if (j) {
    dir = path.join(BOSS_ROOT, slug(j.name));
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, 'sources.json'), sources);
  }
  // reports do Warcraft Logs: os pedidos e os N mais recentes com kill
  const codes = new Set(all('wcl'));
  const tops = Number(opt('tops', 0));
  if (tops > 0 && (runs('coleta') || !fs.readdirSync(dir).some((f) => f.startsWith('wcl-')))) {
    try {
      for (const c of await wclTopReports(encounterId, { difficulty: wclDiff, n: tops })) codes.add(c);
    } catch (e) {
      add(s, 'ATENÇÃO', `ranking do WCL não veio (${e.message.split('\n')[0]}): passe os códigos com --wcl.`);
    }
  }
  for (const c of codes) {
    try {
      fetchWclReport(c, path.join(dir, `wcl-${c}`), { encounter: encounterId, difficulty: wclDiff });
    } catch (e) {
      add(s, 'ATENÇÃO', `report ${c} não baixou (${e.message.split('\n')[0]}).`);
    }
  }
}

// as fontes de log: a noite local (se veio) e os reports baixados
const logs = all('log');
for (const f of logs) if (!fs.existsSync(f)) throw new Error(`log não encontrado: ${f}`);
const wclDirs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('wcl-') && fs.existsSync(path.join(dir, f, 'report.json'))).map((f) => path.join(dir, f)) : [];
/** Entradas para o wipe-cli / os checks: cada log local é uma; os reports do WCL vão juntos numa só. */
const inputs = [...logs, ...(wclDirs.length ? [wclDirs.join(',')] : [])];
const j = sources.journal;
const bossName = j?.name ?? String(encounterId);

/** `wipe-cli probe` numa entrada, JSON. */
function probe(input, args) {
  // a medida vem antes da fonte, as opções depois: probe <medida> <fonte> --encounter .. [opções]
  return JSON.parse(wipeCli(['probe', args[0], input, ...args.slice(1), '--encounter', String(encounterId), '--difficulty', String(gameDiff), '--json']));
}
function probeAll(args, tag) {
  const out = [];
  for (const input of inputs) {
    const cache = path.join(dir, `probe-${tag}-${slug(path.basename(input.split(',')[0]))}${input.includes(',') ? '-wcl' : ''}.json`);
    let v = !fresh && readJson(cache);
    if (!v) {
      v = probe(input, args);
      writeJson(cache, v);
    }
    out.push({ input, data: v });
  }
  return out;
}

// ---------------------------------------------------------------- 2. rascunho

/** A regra que já existe para o encounter (o arquivo em encounters/). */
function existingRule() {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.yaml') && !e.name.endsWith('.draft.yaml') ? [path.join(d, e.name)] : []));
  return walk(path.join(ROOT, 'encounters')).find((f) => new RegExp(`^encounter_id:\\s*${encounterId}\\b`, 'm').test(fs.readFileSync(f, 'utf8')));
}
let ruleFile = existingRule();
let idsData = null;
{
  const s = stage('2. Rascunho da regra');
  if (!j) {
    s.status = 'PULADO';
    s.lines.push('- sem Journal, sem rascunho');
  } else if (runs('rascunho')) {
    // os ids do log confirmam o papel de cada spell (cast, aura, dano); sem log, só o BigWigs
    if (inputs.length && fs.existsSync(WIPE_CLI)) {
      try {
        idsData = mergeIds(probeAll(['ids'], 'ids').map((x) => x.data));
      } catch (e) {
        add(s, 'ATENÇÃO', `\`wipe-cli probe ids\` não rodou (${e.message.split('\n')[0]}): os ids ficam só com o BigWigs.`);
      }
    }
    const text = draftRule({ journal: j, bigwigs: sources.bigwigs, ids: idsData });
    // rascunho que ninguém mexeu ainda (o cabeçalho RASCUNHO continua): refaz no lugar, agora com os ids do log
    const untouched = ruleFile && fs.readFileSync(ruleFile, 'utf8').startsWith('# RASCUNHO do `npm run boss:new`');
    if (untouched) {
      fs.writeFileSync(ruleFile, text);
      s.lines.push(`- rascunho refeito: \`${rel(ruleFile)}\` (ainda com o cabeçalho RASCUNHO; tire o cabeçalho ao começar a editar à mão)`);
    } else if (ruleFile) {
      const draft = ruleFile.replace(/\.yaml$/, '.draft.yaml');
      fs.writeFileSync(draft, text);
      s.lines.push(`- regra existente: \`${rel(ruleFile)}\` (não mexida); rascunho ao lado em \`${rel(draft)}\` para comparar`);
    } else {
      ruleFile = path.join(ROOT, 'encounters', slug(j.instance?.name ?? 'raid'), `${slug(j.name)}.yaml`);
      fs.mkdirSync(path.dirname(ruleFile), { recursive: true });
      fs.writeFileSync(ruleFile, text);
      s.lines.push(`- regra nova: \`${rel(ruleFile)}\``);
    }
    if (!flag('no-build')) {
      console.log('  compilando o wipe-cli (a regra vai embutida)…');
      const b = run('cargo', ['build', '--release', '-q', '-p', 'wipe-core', '--bin', 'wipe-cli']);
      if (!b.ok) add(s, 'REVISAR', 'o `cargo build` falhou com a regra: o YAML está inválido? Rode `cargo test -p wipe-core` (embedded_rules_parse).');
    }
  }
  if (ruleFile) {
    const text = fs.readFileSync(ruleFile, 'utf8');
    const review = (text.match(/"A revisar"/g) ?? []).length / 2;
    const needs = (text.match(/needs_id: true/g) ?? []).length;
    if (review) add(s, 'REVISAR', `${Math.ceil(review)} mecânica(s) com texto "A revisar" (tipo, culpa, tip e message: skill boss-new → boss-rules).`);
    if (needs) add(s, 'REVISAR', `${needs} mecânica(s) com \`needs_id: true\`: confirme o id com o \`probe ids\` (precisa de log).`);
  }
}

/** Junta o `probe ids` de várias entradas (soma por spell). */
function mergeIds(list) {
  const by = new Map();
  const NUM = ['castStart', 'castSuccess', 'auraOnPlayers', 'auraOnEnemies', 'damageHits', 'damage', 'summons'];
  const SETS = ['casters', 'auraSources', 'damageSources'];
  for (const d of list)
    for (const sp of d.spells ?? []) {
      const o = by.get(sp.spellId) ?? { spellId: sp.spellId, name: sp.name, ...Object.fromEntries(NUM.map((k) => [k, 0])), ...Object.fromEntries(SETS.map((k) => [k, []])) };
      for (const k of NUM) o[k] += sp[k] ?? 0;
      for (const k of SETS) o[k] = [...new Set([...o[k], ...(sp[k] ?? [])])];
      by.set(sp.spellId, o);
    }
  return { encounter: encounterId, pulls: list.reduce((a, d) => a + (d.pulls ?? 0), 0), spells: [...by.values()].sort((a, b) => b.damage - a.damage) };
}

// ---------------------------------------------------------------- 3. medição

const measures = [];
{
  const s = stage('3. Medição');
  if (!inputs.length) {
    s.status = 'PULADO';
    s.lines.push('- sem log (passe `--log` ou `--tops`/`--wcl`): as formas ficam sem número');
  } else if (runs('medicao') || runs('conferencia')) {
    const rules = JSON.parse(wipeCli(['rules']));
    const rule = rules.find((r) => r.encounter_id === encounterId);
    if (!rule) add(s, 'REVISAR', 'o wipe-cli não tem a regra do boss embutida: recompile (`cargo build --release -p wipe-core --bin wipe-cli`).');
    for (const m of rule?.mechanics ?? []) for (const job of measuresFor(m)) measures.push({ key: m.key, ...job });
    for (const ms of measures) {
      try {
        ms.results = probeAll(ms.args, `${ms.key}-${ms.args[0]}`).map((x) => ({ input: x.input.includes(',') ? `${x.input.split(',').length} reports do WCL` : path.basename(x.input), ...x.data }));
      } catch (e) {
        ms.error = e.message.split('\n')[0];
        add(s, 'ATENÇÃO', `${ms.key}: \`probe ${ms.args.join(' ')}\` falhou (${ms.error}).`);
      }
    }
    try {
      const units = probeAll(['units'], 'units');
      s.lines.push(`- **Unidades** (\`probe units\`): ${summarizeUnits(units.map((x) => x.data))}`);
      writeJson(path.join(dir, 'units.json'), units);
    } catch (e) {
      add(s, 'ATENÇÃO', `\`probe units\` falhou (${e.message.split('\n')[0]}).`);
    }
    writeJson(path.join(dir, 'measure.json'), measures);
    s.lines.push(`- ${measures.length} medida(s) pelas formas da regra (tabela abaixo; candidatos para a regra, com quantos casos)`);
  }
}

/** Que medidas cabem numa mecânica, pelos campos que ela já tem. */
function measuresFor(m) {
  const d = m.detect ?? {};
  const dmg = (d.damage_ids ?? []).find((x) => typeof x === 'number');
  const aura = m.area?.aura ?? d.aura_id;
  const cast = m.cone?.cast_id ?? m.soak?.cast_id ?? m.pool?.cast_id ?? d.cast_id;
  const out = [];
  // dano e aura com o mesmo id é o DoT no próprio marcado: não há raio em volta dele para medir
  if (dmg && aura && dmg !== aura) out.push({ what: 'raio em volta do portador', args: ['pulse-radius', '--damage', String(dmg), '--aura', String(aura)] });
  if (dmg && m.area?.npc) out.push({ what: 'raio em volta da unidade', args: ['pulse-radius', '--damage', String(dmg), '--npc', String(m.area.npc)] });
  if (dmg && cast && (m.cone || m.type === 'avoidable_damage')) out.push({ what: 'frontal', args: ['cone', '--cast', String(cast), '--damage', String(dmg)] });
  // soak: pela aura de quem soakou quando existe (o dano do soak às vezes pega o raid inteiro)
  const soakAura = d.soak_aura_id ?? (m.type === 'soak' ? aura : null);
  if (cast && (m.soak || m.type === 'soak') && (soakAura || dmg)) out.push({ what: 'ponto na frente de quem lança', args: ['ahead', '--cast', String(cast), ...(soakAura ? ['--aura', String(soakAura)] : ['--damage', String(dmg)])] });
  if (dmg && (m.waves?.aura ?? m.waves?.cast_id)) out.push({ what: 'direção e velocidade das ondas', args: ['wave-dir', ...(m.waves.aura ? ['--aura', String(m.waves.aura)] : ['--cast', String(m.waves.cast_id)]), '--damage', String(dmg), '--directions', String(m.waves.directions ?? 4)] });
  if (dmg && m.pool?.cast_id) out.push({ what: 'poça em lugar fixo', args: ['pool', '--cast', String(m.pool.cast_id), '--damage', String(dmg)] });
  // mecânica ainda sem forma (rascunho): candidatos genéricos, para a skill escolher a forma com número
  const shaped = m.area || m.cone || m.soak || m.waves || m.pool || m.line || m.blast;
  if (!shaped && dmg && !out.length) {
    out.push({ what: 'candidato: raio em volta de quem lança', args: ['pulse-radius', '--damage', String(dmg)] });
    if (d.cast_id && d.cast_id !== dmg) out.push({ what: 'candidato: frontal no fim do cast', args: ['cone', '--cast', String(d.cast_id), '--damage', String(dmg)] });
  }
  return out;
}

function summarizeUnits(list) {
  const npcs = new Map();
  for (const d of list) for (const u of d.units ?? []) if (!npcs.has(u.npcId) || npcs.get(u.npcId).units < u.units) npcs.set(u.npcId, u);
  return [...npcs.values()]
    .sort((a, b) => b.units - a.units)
    .slice(0, 12)
    .map((u) => `${u.name} (${u.npcId}, ${u.units}×, ${Math.round(u.posPct ?? 0)}% das linhas com posição${u.diedPct != null && u.diedPct < 50 ? `, só ${Math.round(u.diedPct)}% com UNIT_DIED` : ''})`)
    .join(', ') || '—';
}

// ---------------------------------------------------------------- 4. arena

{
  const s = stage('4. Arena');
  const arenas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'arenas.json'), 'utf8')).arenas ?? {};
  const arena = arenas[encounterId];
  if (!arena) {
    add(s, 'REVISAR', `sem arena em data/arenas.json: ache a imagem no raidplan.io (editor do boss, recurso cdn.raidplan.io/raid/.../map/...jpg), marque o chão em scripts/arena-fit.mjs e rode \`ARENA=${encounterId} node scripts/arena-fit.mjs --write\` (skill replay-build, seção Arena).`);
  } else {
    s.lines.push(`- **Arena:** ${arena.name}, encaixe ${arena.fit ?? '?'}${arena.anchored ? ' (ancorada)' : ''}`);
    if (runs('arena') && logs.length) {
      for (const log of logs) {
        const r = run('node', ['scripts/arena-check.mjs', log, String(encounterId), '--difficulty', String(gameDiff), '--draw', path.join(dir, `arena-${path.basename(log, '.txt')}.svg`)], { capture: true });
        const out = r.out.trim().split('\n').slice(-12).join('\n');
        s.lines.push('', '```', out, '```');
        if (/FORA(?! OK)/.test(r.out)) add(s, 'ATENÇÃO', `unidades fora do chão em ${path.basename(log)}: veja o desenho em ${rel(dir)} (offFloor ou arena pequena).`);
      }
    } else if (!logs.length) s.lines.push('- conferência do chão (`arena-check`) só com log local');
  }
}

// ---------------------------------------------------------------- 5. conferência

{
  const s = stage('5. Conferência');
  if (!inputs.length) {
    s.status = 'PULADO';
    s.lines.push('- sem log: replay:check e sim:check pulados');
  } else if (runs('conferencia')) {
    for (const input of inputs) {
      const r = run('node', ['scripts/replay-check.mjs', input, '--boss', bossName, '--difficulty', diffName], { capture: true });
      const last = r.out.trim().split('\n').at(-1) ?? '';
      const m = last.match(/^(OK|ATENÇÃO|REVISAR) .*· (\S+\.md)$/);
      if (!r.ok || !m) add(s, 'REVISAR', `replay:check falhou em ${path.basename(input.split(',')[0])}: ${(r.err || last).split('\n')[0]}`);
      else {
        s.lines.push(`- **replay:check** (${path.basename(input.split(',')[0])}${input.includes(',') ? ' e outros do WCL' : ''}): ${m[1]} → \`${m[2].replaceAll('\\', '/')}\``);
        if (m[1] !== 'OK') add(s, m[1], `replay:check: ${m[1]} (itens no relatório; skill boss-new → replay-build).`);
      }
    }
    for (const log of logs) {
      const r = run('node', ['scripts/sim-check.mjs', log, '--boss', bossName, '--difficulty', diffName, '--iterations', '300'], { capture: true });
      const last = r.out.trim().split('\n').at(-1) ?? '';
      if (!r.ok) add(s, 'ATENÇÃO', `sim:check não rodou em ${path.basename(log)}: ${(r.err || last).split('\n')[0]}`);
      else {
        s.lines.push(`- **sim:check** (${path.basename(log)}, 300 iterações): ${last}`);
        const st = last.match(/^(OK|ATENÇÃO|REVISAR)/)?.[1];
        if (st && st !== 'OK') add(s, st, `sim:check: ${st} (skill boss-new → sim-calibrate).`);
      }
    }
  }
}

// ---------------------------------------------------------------- 6. relatório

const worst = stages.reduce((a, s) => (RANK[s.status] > RANK[a] ? s.status : a), 'OK');
const md = [`# Boss novo — ${bossName} (${encounterId}, ${diffName})`, '', `**${worst}** · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · fontes: ${inputs.length ? inputs.map((i) => (i.includes(',') ? `${i.split(',').length} reports do WCL` : path.basename(i))).join(', ') : 'nenhum log'}`, ''];
for (const s of stages) {
  md.push(`## ${s.name} — ${s.status}`, '');
  if (s.items.length) md.push(...s.items.map((i) => `- **${i.level}** ${i.text}`));
  if (s.lines.length) md.push(...s.lines);
  md.push('');
}
if (measures.length) {
  md.push('## Medidas (candidatos para a regra)', '', 'Cada linha é um `wipe-cli probe` sobre os campos que a mecânica já tem. O número vem do log; ponha na regra com o comentário de onde veio (data, logs, casos).', '');
  for (const ms of measures) {
    md.push(`### ${ms.key} — ${ms.what}`, '', `\`wipe-cli probe ${ms.args.join(' ')}\``, '');
    if (ms.error) md.push(`- falhou: ${ms.error}`);
    for (const r of ms.results ?? []) md.push(`- **${r.input}:** ${summarizeMeasure(ms.args[0], r)}`);
    md.push('');
  }
}
if (j) {
  md.push('## Esboço da auditoria', '', `Copie para \`docs/${slug(j.name)}-replay-audit.md\` quando as formas estiverem medidas (modelo: docs/coiled-altar-replay-audit.md).`, '', '| Mecânica | Medida | Regra |', '|---|---|---|');
  for (const ms of measures) md.push(`| ${ms.key} | ${ms.results?.map((r) => summarizeMeasure(ms.args[0], r)).join('; ') ?? '—'} | — |`);
  md.push('');
}
const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${diffName.toLowerCase()}.md`);
fs.writeFileSync(file, md.join('\n'));
writeJson(file.replace(/\.md$/, '.json'), { encounterId, boss: bossName, difficulty: diffName, status: worst, stages, measures, ruleFile: ruleFile && rel(ruleFile) });
console.log(`\n${worst} · ${rel(file)}`);

/** Uma linha por resultado de medida (os campos de cada `probe --json`, documentados no wipe-cli.rs). */
function summarizeMeasure(kind, r) {
  const n = (x, d = 1) => (typeof x === 'number' ? x.toFixed(d) : '?');
  const pc = (x) => (typeof x === 'number' ? `${Math.round(x * 100)}%` : '?');
  switch (kind) {
    case 'pulse-radius':
      return `raio ${n(r.radius)} jd (dentro ${pc(r.tpr)} dos ${r.hits} acertos, ${pc(r.fpr)} de ${r.others} sem tomar; ${r.lots} pulsos)`;
    case 'cone':
      return `meio ângulo ${n(r.halfAngle, 0)}°, alcance ${n(r.range)} jd (dentro ${pc(r.tpr)}, ${pc(r.fpr)} sem tomar; ${r.casts} casts)`;
    case 'ahead':
      return `R ${n(r.r)} jd na frente (ângulo ${n(r.angle, 0)}°, desvio p50/p90 ${n(r.offset?.[0])}/${n(r.offset?.[1])} jd; ${r.withPoints} de ${r.casts} casts)`;
    case 'wave-dir': {
      const b = r.best ?? {};
      return `base ${b.base ?? '?'} φ ${n(b.phi, 0)}°: ${b.explained} de ${b.hits} acertos (ao acaso ${n(b.random, 0)}); start ${n(r.start)} jd, speed ${n(r.speed)} jd/s, largura ${n(r.width)} jd`;
    }
    case 'pool':
      return (r.casts ?? []).slice(0, 4).map((c) => `${c.n}ª vez (pull ${c.pull}): ${(c.circles ?? []).map(([x, y, rr]) => `(${n(x)}, ${n(y)}) r ${n(rr)}`).join(' + ')}, atraso ${n(c.delayS)} s, dura ${n(c.durationS)} s, J ${n(c.j, 2)}`).join('; ') || '—';
    default:
      return JSON.stringify(r).slice(0, 200);
  }
}
