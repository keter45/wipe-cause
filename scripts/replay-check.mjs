// Confere o replay de um boss: tudo o que o boss faz nos players aparece no mapa? Cruza o log (as
// spells inimigas que acertaram players, os casts do boss, as unidades) com a regra do boss
// (encounters/, lida pelo `wipe-cli rules`) e com a arena (data/arenas.json). No fim, um relatório
// OK / ATENÇÃO / REVISAR. Os itens REVISAR pedem forma nova no replay ou regra nova: a skill
// replay-build cuida deles.
//
//   npm run replay:check -- <WoWCombatLog.txt | relatório.json>              o boss com mais pulls no log
//   npm run replay:check -- <log> --boss "The Coiled Altar" --difficulty Mythic
//
// O log é analisado pelo wipe-cli (target/release; `cargo build --release -p wipe-core --bin wipe-cli`),
// sem corte de mortes (o replay mostra o pull inteiro). O relatório fica em
// samples/replay/<data>-<boss>.md (e .json).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, bossPulls, cliArgs, loadReport, mmss, wipeCli, writeReport } from './lib/checks.mjs';

const OUT = path.join(ROOT, 'samples', 'replay');
const CACHE = path.join(OUT, '.cache');
const { opt, input } = cliArgs();
const APP_DATA = path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'gg.wipecause.app');

// ---------------------------------------------------------------- limites do relatório

/** Spell inimiga que pesa: esta parte do dano nos players, ou tantos acertos. */
const MIN_DAMAGE_SHARE = 0.005;
const MIN_HITS = 30;
/** Sem regra e acima disto do dano: REVISAR (abaixo, ATENÇÃO). */
const NO_RULE_REVISAR = 0.02;
/** Unidade inimiga que causa esta parte do dano e não aparece no mapa: ATENÇÃO. */
const UNIT_SHARE = 0.01;
/** Cast do boss sem regra visto tantas vezes por pull (em média): candidato a frontal, linha, área. */
const CAST_PER_PULL = 1;
/** Atribuição por posição: escudos que ficaram sem culpado nem portador morto acima disto: ATENÇÃO. */
const ASSIGN_UNEXPLAINED = 0.2;
/** Nota do encaixe da arena abaixo disto: reencaixar (scripts/arena-fit.mjs). */
const ARENA_FIT = 0.9;
/** Fora da conferência: ataque corpo a corpo (o tank está sempre no boss) e dano sem origem (o próprio player). */
const SKIP_SPELLS = new Set([1]);
// `nil`: o mesmo "sem origem" no log local (o Warcraft Logs chama de @none), ex.: o orb que o próprio player pisa
const SKIP_SOURCES = new Set(['@none', 'nil', '@environment']);
/** Tipos que não ganham forma por padrão: dano que pega o raid, estado, interrupt. */
const SHAPELESS_OK = new Set(['unavoidable', 'info', 'dispel', 'hp_balance', 'stack_limit', 'enrage']);

if (!input) {
  console.error('uso: npm run replay:check -- <WoWCombatLog.txt | relatório.json> [--boss "<nome>"] [--difficulty Mythic]');
  process.exit(1);
}

// ---------------------------------------------------------------- regra do boss

/** Os ids que ligam uma mecânica ao log. */
function idsOf(m) {
  const d = m.detect ?? {};
  const out = [...(d.damage_ids ?? []), ...(d.fail_ids ?? []), ...(d.aura_ids ?? []), d.aura_id, d.cast_id, d.hit_aura_id, d.soak_aura_id, d.confirm_aura, d.enrage_aura_id, m.cone?.cast_id, m.line?.cast_id, m.area?.aura, ...(m.cone?.target_spells ?? []), ...(m.blast?.event_ids ?? [])];
  return out.filter((x) => typeof x === 'number');
}

/** O que a mecânica desenha no replay (mesma regra do `ground_linger_ms` do núcleo para o chão). */
function shapesOf(m) {
  const s = [];
  if (m.cone) s.push('cone');
  if (m.area) s.push(m.area.npc ? 'área na unidade' : 'área no portador');
  if (m.line) s.push('linha');
  if (m.soak) s.push('soak');
  if (m.blast) s.push('explosão');
  if (m.detect?.orbs) s.push('orbs');
  if (m.detect?.gaze) s.push('fantasmas');
  if (m.type === 'interrupt') s.push('add com barra de cast');
  const onlyTanks = (m.roles ?? []).length > 0 && m.roles.every((r) => r === 'tank');
  const ground = m.ground === undefined ? !onlyTanks && ['avoidable_damage', 'soak', 'positioning', 'spread'].includes(m.type) : m.ground !== false;
  if (ground) s.push('chão');
  return s;
}

// ---------------------------------------------------------------- conferir

const rep = loadReport(input, 0, CACHE);
const { pulls, ref, title, night } = bossPulls(rep.pulls ?? [], opt('boss'), opt('difficulty'));
const rules = JSON.parse(wipeCli(['rules']));
const rule = rules.find((r) => r.encounter_id === ref.encounterId);
const userRule = fs.existsSync(path.join(APP_DATA, 'encounters'))
  ? fs.readdirSync(path.join(APP_DATA, 'encounters')).find((f) => f.endsWith('.yaml') && new RegExp(`encounter_id:\\s*${ref.encounterId}\\b`).test(fs.readFileSync(path.join(APP_DATA, 'encounters', f), 'utf8')))
  : null;
const arena = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'arenas.json'), 'utf8')).arenas?.[ref.encounterId];

const items = [];
const add = (level, text) => items.push({ level, text });
if (!rule) add('REVISAR', `Sem regra para o encounter ${ref.encounterId}: o replay só mostra posições e mortes. Cadastre o boss (skill boss-rules).`);
if (userRule) add('ATENÇÃO', `Há uma regra do usuário (${path.join(APP_DATA, 'encounters', userRule)}) que substitui a embutida no app: o que você vê lá pode não ser o desta conferência.`);
if (!arena) add('REVISAR', 'Sem arena em data/arenas.json: o replay fica sem o mapa e sem o chão andável (seção "Arena" da skill replay-build).');
// `anchored`: posta pelos lugares que o log fixa (onde os adds nascem), com a nota da região da luta: a nota baixa não é erro
else if (arena.fit != null && arena.fit < ARENA_FIT && !arena.anchored) add('ATENÇÃO', `Arena com encaixe ${arena.fit} (abaixo de ${ARENA_FIT}): os pisões não caem bem no chão; reencaixe com scripts/arena-fit.mjs.`);

const byId = new Map();
for (const m of rule?.mechanics ?? []) for (const id of idsOf(m)) byId.set(id, [...(byId.get(id) ?? []), m]);

// dano do boss nos players, somado nos pulls
const spells = new Map();
for (const p of pulls)
  for (const e of p.enemySpells ?? []) {
    if (SKIP_SPELLS.has(e.spellId) || e.sources.every((x) => SKIP_SOURCES.has(x))) continue;
    const s = spells.get(e.spellId) ?? { spellId: e.spellId, name: e.name, sources: new Set(), hits: 0, damage: 0, casts: 0 };
    e.sources.forEach((x) => s.sources.add(x));
    s.hits += e.hitsOnPlayers;
    s.damage += e.damageToPlayers;
    s.casts += e.casts;
    spells.set(e.spellId, s);
  }
const total = [...spells.values()].reduce((a, s) => a + s.damage, 0) || 1;
const rows = [];
for (const s of [...spells.values()].sort((a, b) => b.damage - a.damage)) {
  const share = s.damage / total;
  if (share < MIN_DAMAGE_SHARE && s.hits < MIN_HITS) continue;
  const ms = byId.get(s.spellId) ?? [];
  const shapes = [...new Set(ms.flatMap(shapesOf))];
  let status = 'OK';
  let note = shapes.join(', ');
  if (!ms.length) {
    status = share >= NO_RULE_REVISAR ? 'REVISAR' : 'ATENÇÃO';
    note = 'sem regra';
    add(status, `${s.name} (${s.spellId}, de ${[...s.sources].join('/')}) fez ${(share * 100).toFixed(1)}% do dano nos players em ${s.hits} acertos e não está em nenhuma regra: é algo no chão, frontal ou área (forma no replay), ou dano no raid (\`unavoidable\`)?`);
  } else if (!shapes.length) {
    const types = [...new Set(ms.map((m) => m.type))];
    if (types.every((t) => SHAPELESS_OK.has(t)) || ms.some((m) => m.ground === false)) note = `sem forma (${types.join(', ')})`;
    else {
      status = 'ATENÇÃO';
      note = `na regra (${types.join(', ')}) sem forma no replay`;
      add(status, `${s.name} (${s.spellId}) está na regra como ${types.join(', ')}, mas não desenha nada: se é dano no raid, \`ground: false\`; senão \`cone\`/\`area\`/\`ground\`.`);
    }
  }
  rows.push({ ...s, sources: [...s.sources], share, rules: [...new Set(ms.map((m) => m.key))], shapes, status, note });
}

// casts do boss que nenhuma regra conhece (frontais, linhas e áreas costumam começar aqui)
const casts = new Map();
for (const p of pulls)
  for (const c of p.casts ?? []) {
    const k = casts.get(c.spellId) ?? { spellId: c.spellId, name: c.name, n: 0, hit: spells.has(c.spellId) };
    k.n++;
    casts.set(c.spellId, k);
  }
const unknownCasts = [...casts.values()].filter((c) => !byId.has(c.spellId) && c.n / pulls.length >= CAST_PER_PULL).sort((a, b) => b.n - a.n);
if (unknownCasts.length) add('ATENÇÃO', `${unknownCasts.length} casts do boss sem regra (lista abaixo): confira no guia se algum é frontal, linha ou área que deveria aparecer no mapa.`);

// unidades que fazem dano e não entram no mapa
// (unidade com `area: { npc }` vira o círculo da área, não um losango: também conta como desenhada)
const areaNpcs = new Set((rule?.mechanics ?? []).map((m) => m.area?.npc).filter(Boolean));
const drawn = new Set([
  ...pulls.flatMap((p) => (p.tracks?.units ?? []).filter((u) => u.kind !== 'player').map((u) => u.name)),
  ...(rule?.units ?? []).filter((u) => u.replay || u.boss || areaNpcs.has(u.npc_id)).map((u) => u.name),
]);
const bySource = new Map();
for (const s of spells.values()) for (const src of s.sources) if (!SKIP_SOURCES.has(src)) bySource.set(src, (bySource.get(src) ?? 0) + s.damage / s.sources.size);
const hiddenUnits = [...bySource.entries()].filter(([name, dmg]) => dmg / total >= UNIT_SHARE && !drawn.has(name)).map(([name, dmg]) => ({ name, share: dmg / total }));
for (const u of hiddenUnits) add('ATENÇÃO', `${u.name} faz ${(u.share * 100).toFixed(1)}% do dano nos players e não aparece no mapa: \`units\` com \`replay: true\` (ou \`area: { npc }\` se o perigo é em volta dela).`);
const ghosts = (rule?.mechanics ?? []).filter((m) => m.detect?.gaze);

// atribuição por posição (`detect.assign`): soma o resumo de cada pull
const assigns = (rule?.mechanics ?? [])
  .filter((m) => m.detect?.assign)
  .map((m) => {
    const sum = { key: m.key, name: m.name, waves: 0, judged: 0, skipped: {}, shieldsLeft: 0, blamed: 0, deadCarriers: 0, unexplained: 0, offSpot: [] };
    for (const p of pulls) {
      const a = (p.mechanics ?? []).find((x) => x.key === m.key)?.assign;
      if (!a) continue;
      for (const k of ['waves', 'judged', 'shieldsLeft', 'blamed', 'deadCarriers', 'unexplained']) sum[k] += a[k];
      for (const [why, n] of a.skipped) sum.skipped[why] = (sum.skipped[why] ?? 0) + n;
      sum.offSpot.push(...a.offSpot);
    }
    return sum;
  });
for (const a of assigns) {
  if (a.offSpot.length) add('REVISAR', `${a.name}: ${a.offSpot.length} alvo(s) apareceram a mais de 5 jd de todos os lugares da regra (${a.offSpot.slice(0, 5).map(([x, y]) => `${x.toFixed(1)}, ${y.toFixed(1)}`).join('; ')}): meça o lugar e ponha em \`detect.assign.spots\` (skill replay-build).`);
  if (a.shieldsLeft && a.unexplained / a.shieldsLeft > ASSIGN_UNEXPLAINED) add('ATENÇÃO', `${a.name}: ${a.unexplained} de ${a.shieldsLeft} falhas sem culpado nem portador morto: confira o \`reach\` e os lugares de \`detect.assign\` (skill replay-build).`);
}

const status = items.some((i) => i.level === 'REVISAR') ? 'REVISAR' : items.length ? 'ATENÇÃO' : 'OK';

// ---------------------------------------------------------------- relatório

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const md = [];
md.push(`# Replay — ${title} (${night})`, '');
md.push(`**${status}** · ${pulls.length} pulls · regra: ${rule ? rule.file : 'nenhuma'} · arena: ${arena ? `${arena.name} (encaixe ${arena.fit ?? '?'})` : 'nenhuma'}`, '');
if (items.length) md.push(...items.map((i) => `- **${i.level}** ${i.text}`), '');
md.push('## Dano do boss nos players', '', '| Spell | De | Acertos | Dano | Regra | No replay | |', '|---|---|---|---|---|---|---|');
for (const r of rows) md.push(`| ${r.name} (${r.spellId}) | ${r.sources.join(', ')} | ${r.hits} | ${pct(r.share)} | ${r.rules.join(', ') || '—'} | ${r.note} | ${r.status === 'OK' ? '' : r.status} |`);
if (unknownCasts.length) {
  md.push('', '## Casts do boss sem regra', '', '| Cast | Vezes | Acerta players? |', '|---|---|---|');
  for (const c of unknownCasts) md.push(`| ${c.name} (${c.spellId}) | ${c.n} (${(c.n / pulls.length).toFixed(1)} por pull) | ${c.hit ? 'sim (mesmo id)' : 'não com este id'} |`);
}
md.push('', '## Unidades no mapa', '', `- **Desenhadas:** ${[...drawn].join(', ') || '—'}`);
if (hiddenUnits.length) md.push(`- **Fazem dano e não aparecem:** ${hiddenUnits.map((u) => `${u.name} (${pct(u.share)})`).join(', ')}`);
for (const a of assigns) {
  const skipped = Object.entries(a.skipped).map(([why, n]) => `${why} ${n}`).join(', ') || 'nenhuma';
  md.push('', `## Atribuição por posição — ${a.name} (${a.key})`, '', `- **Levas:** ${a.waves}, julgadas ${a.judged}; não julgadas: ${skipped}`, `- **Falhas (alvo que ficou com a aura):** ${a.shieldsLeft}: com culpado ${a.blamed}, com portador morto ${a.deadCarriers}, sem explicação ${a.unexplained}`);
  if (a.offSpot.length) md.push(`- **Alvos fora dos lugares:** ${a.offSpot.map(([x, y]) => `(${x.toFixed(1)}, ${y.toFixed(1)})`).join(', ')}`);
}
if (ghosts.length) md.push(`- **Fantasmas** (${ghosts.map((m) => m.key).join(', ')}): o caminho é simulado; calibre com \`WIPE_GAZE_DUMP\` + \`scripts/ghost-calibrate.mjs\` (skill replay-build).`);
const longest = [...pulls].sort((a, b) => b.durationMs - a.durationMs)[0];
md.push('', `Para olhar no app: pull ${longest.pullNumber} (${mmss(longest.durationMs)}), aba Replay, com o replay completo da luta.`, '');
const file = writeReport(OUT, title, md.join('\n'), { title, night, status, items, rule: rule?.file ?? null, arena: arena ? { name: arena.name, fit: arena.fit } : null, rows, unknownCasts, hiddenUnits, assigns });
console.log(`${status} · ${rows.length} spells · ${unknownCasts.length} casts sem regra · ${file}.md`);
