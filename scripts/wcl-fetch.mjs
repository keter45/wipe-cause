// Baixa um report do Warcraft Logs (fights, atores e eventos de cada boss) para testar a
// análise sem o log local. Ferramenta de desenvolvimento.
//
//   $env:WCL_CLIENT_ID="..."; $env:WCL_CLIENT_SECRET="..."; node scripts/wcl-fetch.mjs <código> [pasta]
//
// As credenciais vêm só das variáveis de ambiente (nunca de arquivo). A saída vai para
// samples/wcl-<código>/ (fora do git: tem dados da guilda): report.json e um fight-<id>.json
// por boss (a noite inteira num arquivo só passa do limite de string do JS).

import fs from 'node:fs';
import path from 'node:path';

const code = process.argv[2]?.replace(/.*reports\//, '').replace(/[#?/].*/, '');
const out = process.argv[3] ?? path.join(import.meta.dirname, '..', 'samples', `wcl-${code}`);
const { WCL_CLIENT_ID: id, WCL_CLIENT_SECRET: secret } = process.env;
if (!code || !id || !secret) {
  console.error('uso: WCL_CLIENT_ID=... WCL_CLIENT_SECRET=... node scripts/wcl-fetch.mjs <código-do-report> [pasta]');
  process.exit(1);
}

const tokenRes = await fetch('https://www.warcraftlogs.com/oauth/token', {
  method: 'POST',
  headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
if (!tokenRes.ok) throw new Error(`token: ${tokenRes.status} ${await tokenRes.text()}`);
const { access_token: token } = await tokenRes.json();

async function gql(query, variables = {}) {
  const r = await fetch('https://www.warcraftlogs.com/api/v2/client', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
  return j.data;
}

const RATE = `rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }`;
const before = (await gql(`{ ${RATE} }`)).rateLimitData;

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
const report = (await gql(REPORT, { code })).reportData.report;
console.log(`${report.title} — ${report.fights.length} fights, ${report.masterData.actors.length} atores`);

const EVENTS = `query E($code: String!, $fight: Int!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], startTime: $start, endTime: $end, includeResources: true, limit: 10000) { data nextPageTimestamp }
  } }
}`;

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report));
const bosses = report.fights.filter((f) => f.encounterID > 0);
for (const f of bosses) {
  const all = [];
  let start = f.startTime;
  let pages = 0;
  while (start != null) {
    const page = (await gql(EVENTS, { code, fight: f.id, start, end: f.endTime })).reportData.report.events;
    all.push(...page.data);
    start = page.nextPageTimestamp;
    pages++;
  }
  fs.writeFileSync(path.join(out, `fight-${f.id}.json`), JSON.stringify(all));
  console.log(`  fight ${f.id} ${f.name} (${f.kill ? 'kill' : 'wipe'}): ${all.length} eventos em ${pages} páginas`);
}

const after = (await gql(`{ ${RATE} }`)).rateLimitData;
console.log(`pontos da API: ${after.pointsSpentThisHour - before.pointsSpentThisHour} gastos (${after.pointsSpentThisHour}/${after.limitPerHour} nesta hora)`);

console.log(`salvo em ${out}`);
