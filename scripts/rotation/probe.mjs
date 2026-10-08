// Diagnóstico: como a API do Warcraft Logs filtra cada tipo de evento por ator, numa luta só (uma
// página de cada consulta, poucos pontos). Mostra quantos eventos vieram e quantos têm o ator como
// origem (source) ou alvo (target).
//
//   node scripts/rotation/probe.mjs <código do report> <fight> <nome do player> [tipo de recurso]
//   (tipo de recurso como no WCL: 3 energy, 2 focus, 19 essence...)

import { probeClient } from './tops.mjs';

const [code, fightArg, name, resArg] = process.argv.slice(2);
const resType = resArg != null ? +resArg : null;
if (!code || !fightArg || !name) {
  console.error('uso: node scripts/rotation/probe.mjs <código do report> <fight> <nome do player>');
  process.exit(2);
}
const fightId = +fightArg;
const gql = await probeClient();

const REPORT = `query R($code: String!) { reportData { report(code: $code) {
  fights { id startTime endTime }
  masterData { actors { id name type } }
} } }`;
const EVENTS = `query E($code: String!, $fight: Int!, $start: Float!, $end: Float!, $source: Int, $target: Int, $dataType: EventDataType, $hostility: HostilityType, $ability: Float) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], startTime: $start, endTime: $end, sourceID: $source, targetID: $target, dataType: $dataType, hostilityType: $hostility, abilityID: $ability, limit: 10000) { data nextPageTimestamp }
  } }
}`;

const report = (await gql(REPORT, { code })).reportData.report;
const fight = report.fights.find((f) => f.id === fightId);
const actor = report.masterData.actors.find((a) => a.type === 'Player' && a.name.toLowerCase() === name.toLowerCase());
if (!fight || !actor) throw new Error(`luta ${fightId} ou player ${name} não encontrado`);
console.log(`${name} = ator ${actor.id}; luta ${fightId}\n`);

const variants = [
  ['Casts  source', { dataType: 'Casts', source: actor.id }],
  ['Buffs  source', { dataType: 'Buffs', source: actor.id }],
  ['Buffs  target', { dataType: 'Buffs', target: actor.id }],
  ['Debuffs source', { dataType: 'Debuffs', source: actor.id }],
  ['Debuffs source + Enemies', { dataType: 'Debuffs', source: actor.id, hostility: 'Enemies' }],
  ['Debuffs target', { dataType: 'Debuffs', target: actor.id }],
  ['Debuffs target + Enemies', { dataType: 'Debuffs', target: actor.id, hostility: 'Enemies' }],
  ['Resources source', { dataType: 'Resources', source: actor.id }],
  ['Resources target', { dataType: 'Resources', target: actor.id }],
  ...(resType != null
    ? [
        [`Resources source + tipo ${resType}`, { dataType: 'Resources', source: actor.id, ability: resType }],
        [`Resources target + tipo ${resType}`, { dataType: 'Resources', target: actor.id, ability: resType }],
      ]
    : []),
];
const pct = (n, d) => `${Math.round((n / Math.max(1, d)) * 100)}%`.padStart(5);
console.log(`${'consulta'.padEnd(26)} ${'eventos'.padStart(8)}  origem=ator  alvo=ator  tipos`);
for (const [label, v] of variants) {
  try {
    const page = (await gql(EVENTS, { code, fight: fightId, start: fight.startTime, end: fight.endTime, ...v })).reportData.report.events;
    const ev = page.data;
    const src = ev.filter((e) => e.sourceID === actor.id).length;
    const tgt = ev.filter((e) => e.targetID === actor.id).length;
    const types = [...new Set(ev.map((e) => e.type))].slice(0, 5).join(',');
    console.log(`${label.padEnd(26)} ${String(ev.length).padStart(7)}${page.nextPageTimestamp ? '+' : ' '}  ${pct(src, ev.length)}        ${pct(tgt, ev.length)}     ${types}`);
  } catch (e) {
    console.log(`${label.padEnd(26)} erro: ${e.message}`);
  }
}
