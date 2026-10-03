// Baixa os tops de uma spec no Warcraft Logs (rankings de DPS sem buffs externos, em cada chefe do
// raide de encounters/) no formato do scripts/wcl-fetch.mjs, mas só com os eventos que a leitura da
// rotação usa: o que o player (e os pets) fazem, o que cai nele, mortes e o dano de dois colegas
// (para saber quando a raid estava batendo).
//
// Credenciais só por variável de ambiente (WCL_CLIENT_ID / WCL_CLIENT_SECRET), nunca em arquivo.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');

async function client() {
  const { WCL_CLIENT_ID: id, WCL_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('defina WCL_CLIENT_ID e WCL_CLIENT_SECRET no ambiente (cliente em https://www.warcraftlogs.com/api/clients)');
  const r = await fetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`token: ${r.status} ${await r.text()}`);
  const { access_token: token } = await r.json();
  return async (query, variables = {}) => {
    const res = await fetch('https://www.warcraftlogs.com/api/v2/client', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json();
    if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
    return j.data;
  };
}

/** Chefes do raide atual: encounter_id das regras em encounters/<raide>/. */
function raidEncounters() {
  const base = path.join(ROOT, 'encounters');
  const raids = fs.readdirSync(base).filter((d) => !d.startsWith('_') && fs.statSync(path.join(base, d)).isDirectory());
  const raid = raids.sort().at(-1);
  return fs
    .readdirSync(path.join(base, raid))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => {
      const src = fs.readFileSync(path.join(base, raid, f), 'utf8');
      return { id: +src.match(/^encounter_id:\s*(\d+)/m)?.[1], name: src.match(/^name:\s*"?([^"\n]+)/m)?.[1] ?? f };
    })
    .filter((e) => e.id);
}

const RANKINGS = `query R($id: Int!, $difficulty: Int!, $className: String!, $specName: String!) {
  worldData { encounter(id: $id) { characterRankings(difficulty: $difficulty, className: $className, specName: $specName, metric: dps, externalBuffs: Exclude) } }
}`;
const REPORT = `query R($code: String!) {
  reportData { report(code: $code) {
    code title startTime endTime visibility
    zone { id name }
    guild { id name server { slug region { slug } } }
    owner { name }
    fights { id encounterID name difficulty kill startTime endTime size fightPercentage bossPercentage lastPhase friendlyPlayers }
    masterData(translate: false) {
      logVersion gameVersion
      actors { id gameID name server type subType petOwner }
      abilities { gameID name type icon }
    }
  } }
}`;
const EVENTS = `query E($code: String!, $fight: Int!, $start: Float!, $end: Float!, $filter: String!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], startTime: $start, endTime: $end, filterExpression: $filter, includeResources: true, limit: 10000) { data nextPageTimestamp }
  } }
}`;
const RATE = `{ rateLimitData { limitPerHour pointsSpentThisHour } }`;

export async function downloadTops(spec, outDir, { difficulty = 5, perBoss = 2 } = {}) {
  const gql = await client();
  const before = (await gql(RATE)).rateLimitData;
  const picks = [];
  for (const enc of raidEncounters()) {
    let list = [];
    let diff = difficulty;
    for (const d of [difficulty, 4]) {
      const data = await gql(RANKINGS, { id: enc.id, difficulty: d, className: spec.wclClass, specName: spec.wclSpec });
      list = (data.worldData.encounter?.characterRankings?.rankings ?? []).filter((r) => r.report?.code && r.report.fightID != null);
      diff = d;
      if (list.length >= perBoss) break;
    }
    for (const r of list.slice(0, perBoss)) picks.push({ encounter: enc.name, difficulty: diff, name: r.name, server: r.server?.name, amount: Math.round(r.amount), code: r.report.code, fight: r.report.fightID });
    console.log(`${enc.name}: ${list.slice(0, perBoss).map((r) => `${r.name} ${Math.round(r.amount / 1000)}k`).join(', ') || 'sem rankings'}${diff !== difficulty ? ' (heroico)' : ''}`);
  }

  for (const [code, mine] of Object.entries(Object.groupBy(picks, (p) => p.code))) {
    const dir = path.join(outDir, code);
    fs.mkdirSync(dir, { recursive: true });
    const reportFile = path.join(dir, 'report.json');
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : (await gql(REPORT, { code })).reportData.report;
    fs.writeFileSync(reportFile, JSON.stringify(report));
    for (const [fightId, ps] of Object.entries(Object.groupBy(mine, (p) => p.fight))) {
      const file = path.join(dir, `fight-${fightId}.json`);
      if (fs.existsSync(file)) continue;
      const fight = report.fights.find((f) => f.id === +fightId);
      const actors = report.masterData.actors;
      const targets = actors.filter((a) => a.type === 'Player' && ps.some((p) => p.name === a.name && (!p.server || !a.server || p.server === a.server))).map((a) => a.id);
      if (!fight || !targets.length) {
        console.log(`  ${code} fight ${fightId}: player não encontrado, pulando`);
        continue;
      }
      const pets = actors.filter((a) => targets.includes(a.petOwner)).map((a) => a.id);
      const refs = (fight.friendlyPlayers ?? []).filter((id) => !targets.includes(id)).slice(0, 2);
      const filter = [
        `source.id in (${[...targets, ...pets].join(', ')})`,
        `target.id in (${targets.join(', ')})`,
        `type = "death"`,
        refs.length ? `(type = "damage" and source.id in (${refs.join(', ')}))` : null,
      ]
        .filter(Boolean)
        .join(' or ');
      const all = [];
      let start = fight.startTime;
      while (start != null) {
        const page = (await gql(EVENTS, { code, fight: +fightId, start, end: fight.endTime, filter })).reportData.report.events;
        all.push(...page.data);
        start = page.nextPageTimestamp;
      }
      fs.writeFileSync(file, JSON.stringify(all));
      console.log(`  ${code} fight ${fightId} ${fight.name} (${ps.map((p) => p.name).join(', ')}): ${all.length} eventos`);
    }
  }
  fs.writeFileSync(path.join(outDir, 'tops.json'), JSON.stringify(picks, null, 2));
  const after = (await gql(RATE)).rateLimitData;
  console.log(`\n${picks.length} tops em ${outDir}; pontos da API: ${after.pointsSpentThisHour - before.pointsSpentThisHour} (${after.pointsSpentThisHour}/${after.limitPerHour} nesta hora)`);
}
