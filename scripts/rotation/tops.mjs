// Baixa os tops de uma spec no Warcraft Logs (rankings de DPS sem Power Infusion de outra pessoa, em cada chefe do
// raide de encounters/) no formato do scripts/wcl-fetch.mjs, mas só com os eventos que a leitura da
// rotação usa: o que o player (e os pets) fazem, o que cai nele, mortes e o dano de um colega
// (para saber quando a raid estava batendo).
//
// Credenciais: das variáveis de ambiente (WCL_CLIENT_ID / WCL_CLIENT_SECRET), do arquivo de testes
// samples/wcl-credentials.env (fora do git; aceita vários clientes: _2, _3...) ou, no Windows, do
// cofre de credenciais onde o app guarda o client da aba Desempenho. Nada é impresso.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fightActors, trimEvents } from './trim.mjs';

const ROOT = path.join(import.meta.dirname, '..', '..');

/**
 * Senha de uma entrada do cofre do Windows gravada pelo crate keyring do app (alvo "<nome>.wipe-cause",
 * texto em UTF-16). Lida por um PowerShell filho; o valor volta pelo stdout, direto para a memória.
 */
function vault(name) {
  if (process.platform !== 'win32') return null;
  const ps = `
$sig = '[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
[DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct CRED { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int BlobSize; public IntPtr Blob; public int Persist; public int AttrCount; public IntPtr Attrs; public string Alias; public string User; }';
Add-Type -MemberDefinition $sig -Namespace W -Name Cred -UsingNamespace System.Runtime.InteropServices
$p = [IntPtr]::Zero
if ([W.Cred]::CredReadW('${name}.wipe-cause', 1, 0, [ref]$p)) {
  $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][W.Cred+CRED])
  $b = New-Object byte[] $c.BlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($c.Blob, $b, 0, $c.BlobSize)
  [W.Cred]::CredFree($p)
  [Console]::Out.Write([Convert]::ToBase64String($b))
}`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  const out = r.status === 0 ? r.stdout.trim() : '';
  return out ? Buffer.from(out, 'base64').toString('utf16le') : null;
}

/** Clientes do arquivo de testes (samples/wcl-credentials.env, fora do git), na ordem: 1, _2, _3... */
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

/** Qual cliente do arquivo usar (troca quando os pontos por hora de um acabam). */
let clientIndex = 0;
export const clientCount = () => fileCredentials().length;
export function useClient(i) {
  clientIndex = i;
}

function credentials() {
  const { WCL_CLIENT_ID: envId, WCL_CLIENT_SECRET: envSecret } = process.env;
  if (envId && envSecret) return { id: envId, secret: envSecret };
  const file = fileCredentials();
  if (file.length) return file[clientIndex % file.length];
  const id = vault('wcl-client-id');
  const secret = id ? vault('wcl-client-secret') : null;
  if (id && secret) {
    console.log('credenciais do Warcraft Logs: cofre do Windows (client da aba Desempenho)');
    return { id, secret };
  }
  throw new Error('sem credenciais do Warcraft Logs: cole o client na aba Desempenho do app ou defina WCL_CLIENT_ID e WCL_CLIENT_SECRET (cliente em https://www.warcraftlogs.com/api/clients)');
}

async function client() {
  const { id, secret } = credentials();
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
    const text = await res.text();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {
      /* não era JSON (página de erro, limite) */
    }
    if (j?.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
    if (!res.ok || !j?.data) throw new Error(`API do Warcraft Logs respondeu ${res.status}: ${text.slice(0, 160)}`);
    return j.data;
  };
}

/** Pasta de um report: códigos como "a:BD1Jk62rXAGwcFtq" têm ":", que o Windows não aceita. */
export const reportDir = (code) => String(code).replace(/[:\\/]/g, '_');

/** Chefes com regras escritas em encounters/<raide mais nova>/ (o encounter_id de cada uma). */
function ruleEncounters() {
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

const ZONE_OF = `query Z($id: Int!) { worldData { encounter(id: $id) { zone { id name encounters { id name } } } } }`;
const ZONE = `query Z($id: Int!) { worldData { zone(id: $id) { id name encounters { id name } } } }`;
const ZONES = `query { worldData { zones { id name frozen encounters { id } difficulties { id } } } }`;

/**
 * Chefes do raide pela zona do Warcraft Logs, para um raide novo entrar sem regras escritas:
 * `zone` = id da zona, "latest" = a zona de raide mais nova (não congelada, com Mítico), ou nada =
 * a zona do raide que já tem regras em encounters/ (pega também os chefes ainda sem regras).
 */
async function raidEncounters(gql, zone) {
  let z = null;
  if (zone === 'latest') {
    const zones = (await gql(ZONES)).worldData.zones.filter((x) => !x.frozen && x.encounters.length >= 3 && x.difficulties.some((d) => d.id === 5));
    const latest = zones.sort((a, b) => b.id - a.id)[0];
    z = latest && (await gql(ZONE, { id: latest.id })).worldData.zone;
  } else if (zone) z = (await gql(ZONE, { id: +zone })).worldData.zone;
  else {
    const known = ruleEncounters();
    if (known.length) z = (await gql(ZONE_OF, { id: known[0].id })).worldData.encounter?.zone ?? null;
    if (!z) return known;
  }
  if (!z?.encounters?.length) throw new Error(`zona ${zone ?? '(das regras)'} sem chefes no Warcraft Logs`);
  console.log(`Raide: ${z.name} (zona ${z.id}, ${z.encounters.length} chefes)`);
  return z.encounters.map((e) => ({ id: e.id, name: e.name }));
}

// Ranking com todos os parses: o filtro de buffs externos do WCL tira também quem jogou com
// Augmentation (Ebon Might, Prescience), e toda raid de topo tem um. Só o Power Infusion de outra
// pessoa descarta a luta, conferido em cada candidato (POWER_INFUSION).
const RANKINGS = `query R($id: Int!, $difficulty: Int!, $className: String!, $specName: String!) {
  worldData { encounter(id: $id) { characterRankings(difficulty: $difficulty, className: $className, specName: $specName, metric: dps) } }
}`;
const POWER_INFUSION = 10060;
const BUFF_EVENTS = `query B($code: String!, $fight: Int!, $start: Float!, $end: Float!, $target: Int!, $ability: Float!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], startTime: $start, endTime: $end, targetID: $target, dataType: Buffs, abilityID: $ability, limit: 1000) { data }
  } }
}`;
/** Candidatos conferidos por boss, no máximo: para não gastar pontos se muitos tiverem PI. */
const MAX_TRIES_PER_PICK = 3;
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
// Filtro pelos parâmetros da própria API, sempre com o tipo de evento (medido com probe.mjs):
// - o filterExpression com source.id voltava só as mortes; sourceID sem dataType, a luta inteira;
// - nas auras o WCL inverte: Buffs/Debuffs com sourceID = quem TEM a aura, com targetID = quem
//   LANÇA; os DoTs do player nos inimigos pedem também hostilityType Enemies;
// - Resources não filtra por ator de jeito nenhum: vem de todos e o trimEvents fica com o do player.
const EVENTS = `query E($code: String!, $fight: Int!, $start: Float!, $end: Float!, $source: Int, $target: Int, $dataType: EventDataType, $hostility: HostilityType) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], startTime: $start, endTime: $end, sourceID: $source, targetID: $target, dataType: $dataType, hostilityType: $hostility, includeResources: true, limit: 10000) { data nextPageTimestamp }
  } }
}`;
/** Pets por player: o bastante para os debuffs dos pets (lobos do Feral Spirit viram vários atores). */
const MAX_PETS = 12;
/** Teto de uma consulta só (o Augmentation passa de 40 mil eventos só com o Ebon Might). */
const MAX_PER_QUERY = 400_000;
/** Página em que menos que isso dos eventos é do ator pedido: a API ignorou o filtro. */
const MIN_MATCH = 0.5;
/** O evento é do ator pedido? `q.expect`: o ator é a origem ('source') ou o alvo ('target') do evento. */
const matches = (e, q) => (q.expect === 'source' ? e.sourceID === q.actor || e.supportID === q.actor : q.expect === 'target' ? e.targetID === q.actor : true);
const RATE = `{ rateLimitData { limitPerHour pointsSpentThisHour } }`;

/** Casts dos inimigos: para alinhar os pulls pelas mecânicas do boss (janelas paradas, defensivos). */
const ENEMY_CASTS = { dataType: 'Casts', hostility: 'Enemies' };
/** Fights de uma pasta que já têm os casts dos inimigos (os antigos não tinham). */
const enemyCastsDone = (dir) => {
  const f = path.join(dir, 'enemy-casts.json');
  return new Set(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
};
const markEnemyCasts = (dir, fightId) => {
  const done = enemyCastsDone(dir).add(+fightId);
  fs.writeFileSync(path.join(dir, 'enemy-casts.json'), JSON.stringify([...done]));
};

/** O cliente da API, para o diagnóstico (probe.mjs). */
export const probeClient = client;

export async function downloadTops(spec, outDir, { difficulty = 5, perBoss = 2, zone } = {}) {
  const gql = await client();
  const before = (await gql(RATE)).rateLimitData;
  const reports = new Map();
  const reportOf = async (code) => {
    if (reports.has(code)) return reports.get(code);
    const dir = path.join(outDir, reportDir(code));
    fs.mkdirSync(dir, { recursive: true });
    const reportFile = path.join(dir, 'report.json');
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : (await gql(REPORT, { code })).reportData.report;
    fs.writeFileSync(reportFile, JSON.stringify(report));
    reports.set(code, report);
    return report;
  };
  /** Power Infusion vindo de outra pessoa (o Priest dando PI em si mesmo vale). */
  const externalPI = async (code, report, p) => {
    const { fight, targets } = fightActors(report, p.fight, [p]);
    if (!fight || !targets.length) return null;
    const d = await gql(BUFF_EVENTS, { code, fight: p.fight, start: fight.startTime, end: fight.endTime, target: targets[0], ability: POWER_INFUSION });
    return d.reportData.report.events.data.some((e) => e.type === 'applybuff' && e.abilityGameID === POWER_INFUSION && !targets.includes(e.sourceID));
  };

  const picks = [];
  for (const enc of await raidEncounters(gql, zone)) {
    let list = [];
    let diff = difficulty;
    for (const d of [difficulty, 4]) {
      const data = await gql(RANKINGS, { id: enc.id, difficulty: d, className: spec.wclClass, specName: spec.wclSpec });
      list = (data.worldData.encounter?.characterRankings?.rankings ?? []).filter((r) => r.report?.code && r.report.fightID != null);
      diff = d;
      if (list.length >= perBoss) break;
    }
    const chosen = [];
    const skipped = [];
    for (const r of list.slice(0, perBoss * MAX_TRIES_PER_PICK)) {
      if (chosen.length >= perBoss) break;
      const p = { encounter: enc.name, difficulty: diff, name: r.name, server: r.server?.name, amount: Math.round(r.amount), code: r.report.code, fight: r.report.fightID };
      // já baixada: entrou numa rodada anterior
      if (fs.existsSync(path.join(outDir, reportDir(p.code), `fight-${p.fight}.json`))) {
        chosen.push(p);
        continue;
      }
      const pi = await reportOf(p.code)
        .then((report) => externalPI(p.code, report, p))
        .catch((e) => {
          if (/respondeu (429|5\d\d)|limit/i.test(e.message)) throw e; // limite ou queda da API: sobe para o lote esperar
          skipped.push(`${p.name} (${e.message.slice(0, 60)})`);
          return undefined;
        });
      if (pi === undefined) continue;
      if (pi === null) skipped.push(`${p.name} (não encontrado)`);
      else if (pi) skipped.push(`${p.name} (Power Infusion de outro)`);
      else chosen.push(p);
    }
    picks.push(...chosen);
    console.log(`${enc.name}: ${chosen.map((r) => `${r.name} ${Math.round(r.amount / 1000)}k`).join(', ') || 'sem rankings'}${diff !== difficulty ? ' (heroico)' : ''}${skipped.length ? ` · pulados: ${skipped.join(', ')}` : ''}`);
  }

  for (const [code, mine] of Object.entries(Object.groupBy(picks, (p) => p.code))) {
    const dir = path.join(outDir, reportDir(code));
    const report = await reportOf(code);
    for (const [fightId, ps] of Object.entries(Object.groupBy(mine, (p) => p.fight))) {
      const file = path.join(dir, `fight-${fightId}.json`);
      if (fs.existsSync(file)) continue;
      const { fight, targets, pets: allPets, refs, enemies } = fightActors(report, fightId, ps);
      if (!fight || !targets.length) {
        console.log(`  ${code} fight ${fightId}: player não encontrado, pulando`);
        continue;
      }
      const pets = allPets.slice(0, MAX_PETS * targets.length);
      // só o que a calibração usa (testado na Fire Mage: o resultado não muda sem o resto): casts,
      // buffs, debuffs, recurso e invocações do player e dos pets, as mortes e o dano de um colega
      // (para saber quando a raid estava batendo). Ficam de fora o dano do próprio player (no
      // Augmentation, dezenas de milhares de eventos de Ebon Might), o dano recebido e as curas.
      const cast = (id, dataType) => ({ source: id, dataType, actor: id, expect: 'source' });
      const queries = [
        ...targets.flatMap((id) => [
          ...['CombatantInfo', 'Casts', 'Summons'].map((dataType) => cast(id, dataType)),
          // auras no player (procs): sourceID = quem tem a aura
          { source: id, dataType: 'Buffs', actor: id, expect: 'target' },
          // DoTs do player: targetID = quem lança, nos inimigos
          { target: id, dataType: 'Debuffs', hostility: 'Enemies', actor: id, expect: 'source' },
        ]),
        ...pets.flatMap((id) => [cast(id, 'Casts'), { target: id, dataType: 'Debuffs', hostility: 'Enemies', actor: id, expect: 'source' }]),
        // recurso: sem filtro por ator na API (o trimEvents fica com o do player)
        { dataType: 'Resources' },
        { dataType: 'Deaths' },
        // o dano do colega vem com o dos pets dele: sem conferir a origem (o trimEvents fica com o dele)
        ...refs.map((id) => ({ source: id, dataType: 'DamageDone' })),
        ENEMY_CASTS,
      ];
      const seen = new Set();
      let all = [];
      let ignored = null;
      for (const q of queries) {
        let start = fight.startTime;
        let got = 0;
        while (start != null && !ignored) {
          const { actor, expect, ...vars } = q;
          const page = (await gql(EVENTS, { code, fight: +fightId, start, end: fight.endTime, ...vars })).reportData.report.events;
          got += page.data.length;
          const mine = page.data.filter((e) => matches(e, q)).length;
          if (got > MAX_PER_QUERY || (page.data.length >= 500 && mine < page.data.length * MIN_MATCH)) ignored = q;
          for (const e of page.data) {
            const key = JSON.stringify(e);
            if (!seen.has(key)) {
              seen.add(key);
              all.push(e);
            }
          }
          start = page.nextPageTimestamp;
        }
        if (ignored) break;
      }
      if (ignored) {
        console.log(`  ${code} fight ${fightId}: a consulta ${JSON.stringify(ignored)} veio com eventos de outros atores (a API ignorou o filtro) ou passou de ${MAX_PER_QUERY}, pulando`);
        continue;
      }
      // rede de segurança: só o que a leitura usa, mesmo que a API devolva a mais
      all = trimEvents(all, { targets, pets, refs, enemies });
      // as consultas se sobrepõem (o player buffando a si mesmo): em ordem de tempo, como no log
      all.sort((a, b) => a.timestamp - b.timestamp);
      if (!all.some((e) => e.type === 'cast' && targets.includes(e.sourceID))) {
        console.log(`  ${code} fight ${fightId}: nenhum cast do player veio, pulando`);
        continue;
      }
      fs.writeFileSync(file, JSON.stringify(all));
      if (all.some((e) => e.type === 'cast' && enemies.includes(e.sourceID))) markEnemyCasts(dir, fightId);
      console.log(`  ${code} fight ${fightId} ${fight.name} (${ps.map((p) => p.name).join(', ')}): ${all.length} eventos`);
    }
  }

  // fights baixados antes dos casts dos inimigos: completa só com eles
  for (const code of fs.readdirSync(outDir).filter((d) => fs.existsSync(path.join(outDir, d, 'report.json')))) {
    const dir = path.join(outDir, code);
    const done = enemyCastsDone(dir);
    for (const name of fs.readdirSync(dir).filter((n) => /^fight-\d+\.json$/.test(n))) {
      const fightId = +name.match(/\d+/)[0];
      if (done.has(fightId)) continue;
      const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
      const fight = report.fights.find((f) => f.id === fightId);
      if (!fight) continue;
      const enemies = new Set(fightActors(report, fightId, []).enemies);
      const got = [];
      for (let start = fight.startTime; start != null; ) {
        const page = (await gql(EVENTS, { code: report.code, fight: fightId, start, end: fight.endTime, dataType: ENEMY_CASTS.dataType, hostility: ENEMY_CASTS.hostility })).reportData.report.events;
        got.push(...page.data.filter((e) => (e.type === 'cast' || e.type === 'begincast') && enemies.has(e.sourceID)));
        start = page.nextPageTimestamp;
      }
      if (!got.length) {
        console.log(`  ${report.code} fight ${fightId}: nenhum cast de inimigo veio (a API ignorou o filtro?), tento de novo na próxima rodada`);
        continue;
      }
      const file = path.join(dir, name);
      const all = [...JSON.parse(fs.readFileSync(file, 'utf8')), ...got].sort((a, b) => a.timestamp - b.timestamp);
      fs.writeFileSync(file, JSON.stringify(all));
      markEnemyCasts(dir, fightId);
      console.log(`  ${report.code} fight ${fightId} ${fight.name}: +${got.length} casts dos inimigos`);
    }
  }
  fs.writeFileSync(path.join(outDir, 'tops.json'), JSON.stringify(picks, null, 2));
  const after = (await gql(RATE)).rateLimitData;
  console.log(`\n${picks.length} tops em ${outDir}; pontos da API: ${after.pointsSpentThisHour - before.pointsSpentThisHour} (${after.pointsSpentThisHour}/${after.limitPerHour} nesta hora)`);
}
