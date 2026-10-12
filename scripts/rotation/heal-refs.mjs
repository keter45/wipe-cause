// Logs de referência de um healer no Warcraft Logs (regras em docs/healer-analysis.md): kills no
// mítico, US e EU, tirados de várias páginas do ranking de cura da spec. O topo do ranking fica de fora
// (é onde estão os logs inflados: raid tomando dano a mais, poucos healers) e a nota não entra na
// escolha. Cada candidato guarda a composição de healers, o dano tomado pela raid e a fatia da cura,
// para a referência escolher pela composição e descartar o que estiver distorcido.
//
// Formato da pasta igual ao dos tops (report.json + fight-<id>.json, lido pelo `wipe-cli wcl`), com os
// eventos que a leitura de healer usa: tudo o que o healer faz (casts, curas, absorções, buffs nos
// outros, dano), os buffs nele, a mana, as mortes, os casts dos inimigos e a vida da raid. Da vida da
// raid só ficam os eventos em que alguém cruza a linha de "ferido" (o motor só usa isso), senão cada
// luta passaria de 20 MB.

import fs from 'node:fs';
import path from 'node:path';
import { BUFF_EVENTS, ENEMY_CASTS, EVENTS, POWER_INFUSION, RATE, REPORT, probeClient, raidEncounters, reportDir } from './tops.mjs';
import { fightActors } from './trim.mjs';

/** Mesmo limite do motor (INJURED_PCT em crates/wipe-core/src/analysis.rs). */
const INJURED_PCT = 80;
/** Posições do ranking que ficam de fora: o topo é onde a cura de healer mais engana. */
const SKIP_TOP = 10;
/** Páginas do ranking (100 por página) de onde saem os candidatos. */
const PAGES = 4;
/** Candidatos conferidos por chefe, no máximo (cada um custa duas consultas). */
const MAX_TRIES = 16;
const REGIONS = new Set(['US', 'EU']);

const RANKINGS = `query R($id: Int!, $className: String!, $specName: String!, $page: Int!) {
  worldData { encounter(id: $id) { characterRankings(difficulty: 5, className: $className, specName: $specName, metric: hps, page: $page) } }
}`;
// composição, cura de cada um e dano tomado pela raid, numa consulta só
const FIGHT_INFO = `query F($code: String!, $fight: Int!) {
  reportData { report(code: $code) {
    playerDetails(fightIDs: [$fight])
    healing: table(fightIDs: [$fight], dataType: Healing)
    taken: table(fightIDs: [$fight], dataType: DamageTaken)
  } }
}`;

const tableEntries = (t) => t?.data?.entries ?? [];

/** Composição de healers do fight e os números para achar log distorcido. */
async function fightInfo(gql, code, fightId, playerName) {
  const r = (await gql(FIGHT_INFO, { code, fight: fightId })).reportData.report;
  const details = r.playerDetails?.data?.playerDetails ?? r.playerDetails?.playerDetails ?? {};
  const healers = (details.healers ?? []).map((h) => ({
    name: h.name,
    spec: `${h.specs?.[0]?.spec ?? '?'} ${h.type}`,
  }));
  const players = ['tanks', 'healers', 'dps'].reduce((n, k) => n + (details[k]?.length ?? 0), 0);
  const healing = tableEntries(r.healing);
  const healerNames = new Set(healers.map((h) => h.name));
  const healersTotal = healing.filter((e) => healerNames.has(e.name)).reduce((a, e) => a + (e.total ?? 0), 0);
  const mine = healing.find((e) => e.name === playerName)?.total ?? 0;
  const taken = tableEntries(r.taken).reduce((a, e) => a + (e.total ?? 0), 0);
  return {
    healers,
    players,
    share: healersTotal ? mine / healersTotal : 0,
    damageTaken: taken,
  };
}

/** Só os eventos que a leitura de healer usa; a vida da raid reduzida às viradas de "ferido". */
export function trimHealer(events, { mine, players, enemies }) {
  const own = new Set(mine);
  const friendly = new Set(players);
  const enemy = new Set(enemies);
  const injured = new Map();
  const out = [];
  for (const e of events) {
    if (own.has(e.sourceID) || e.type === 'death' || e.type === 'combatantinfo') {
      out.push(e);
      continue;
    }
    if ((e.type === 'cast' || e.type === 'begincast') && enemy.has(e.sourceID)) {
      out.push(e);
      continue;
    }
    // recurso e auras no healer vindos de outros (Power Infusion, Innervate)
    if (own.has(e.targetID) && !['damage', 'heal', 'absorbed'].includes(e.type)) {
      out.push(e);
      continue;
    }
    // vida da raid: o bloco de recursos é do alvo (resourceActor 2) nos golpes e curas em players
    if ((e.type === 'damage' || e.type === 'heal') && friendly.has(e.targetID) && e.resourceActor === 2 && e.maxHitPoints > 0) {
      const now = e.hitPoints > 0 && (e.hitPoints / e.maxHitPoints) * 100 < INJURED_PCT;
      if (now !== (injured.get(e.targetID) ?? false) || own.has(e.targetID)) {
        injured.set(e.targetID, now);
        // só o necessário para o motor ler a vida (a conversão pede o tipo e o spell)
        const { timestamp, type, sourceID, targetID, abilityGameID, fight, hitPoints, maxHitPoints, resourceActor, amount, overheal, tick } = e;
        out.push({
          timestamp,
          type,
          sourceID,
          targetID,
          abilityGameID,
          fight,
          hitPoints,
          maxHitPoints,
          resourceActor,
          amount,
          overheal,
          tick,
        });
      }
    }
  }
  return out;
}

/** Candidatos espalhados pelo ranking (não só o começo), na ordem em que serão conferidos. */
function spread(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

export async function downloadHealRefs(spec, outDir, { perBoss = 4, zone } = {}) {
  const gql = await probeClient();
  const before = (await gql(RATE)).rateLimitData;
  fs.mkdirSync(outDir, { recursive: true });
  const refsFile = path.join(outDir, 'refs.json');
  const known = fs.existsSync(refsFile) ? JSON.parse(fs.readFileSync(refsFile, 'utf8')) : [];
  const save = (list) => fs.writeFileSync(refsFile, JSON.stringify(list, null, 2));
  const reports = new Map();
  const reportOf = async (code) => {
    if (reports.has(code)) return reports.get(code);
    const dir = path.join(outDir, reportDir(code));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'report.json');
    const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : (await gql(REPORT, { code })).reportData.report;
    fs.writeFileSync(file, JSON.stringify(report));
    reports.set(code, report);
    return report;
  };

  const picks = [];
  for (const enc of await raidEncounters(gql, zone)) {
    // já escolhidos numa rodada anterior (baixados ou não: o download abaixo completa os que faltam)
    const have = known.filter((k) => k.encounterId === enc.id);
    const chosen = [...have];
    const skipped = [];
    if (chosen.length < perBoss) {
      let list = [];
      for (let page = 1; page <= PAGES; page++) {
        const r = (
          await gql(RANKINGS, {
            id: enc.id,
            className: spec.wclClass,
            specName: spec.wclSpec,
            page,
          })
        ).worldData.encounter?.characterRankings;
        list.push(...(r?.rankings ?? []));
        if (!r?.hasMorePages) break;
      }
      list = list.slice(SKIP_TOP).filter((r) => r.report?.code && r.report.fightID != null && REGIONS.has(String(r.server?.region ?? '').toUpperCase()));
      for (const r of spread(list, MAX_TRIES)) {
        if (chosen.length >= perBoss) break;
        if (chosen.some((c) => c.code === r.report.code && c.fight === r.report.fightID)) continue;
        const p = {
          encounter: enc.name,
          encounterId: enc.id,
          name: r.name,
          server: r.server?.name,
          region: r.server?.region,
          amount: Math.round(r.amount),
          code: r.report.code,
          fight: r.report.fightID,
          startTime: r.startTime,
        };
        try {
          const report = await reportOf(p.code);
          const { fight, targets } = fightActors(report, p.fight, [p]);
          if (!fight || !targets.length) {
            skipped.push(`${p.name} (não encontrado)`);
            continue;
          }
          const pi = await gql(BUFF_EVENTS, {
            code: p.code,
            fight: p.fight,
            start: fight.startTime,
            end: fight.endTime,
            target: targets[0],
            ability: POWER_INFUSION,
          });
          if (pi.reportData.report.events.data.some((e) => e.type === 'applybuff' && !targets.includes(e.sourceID))) {
            skipped.push(`${p.name} (Power Infusion de outro)`);
            continue;
          }
          const info = await fightInfo(gql, p.code, p.fight, p.name);
          if (info.healers.length < 3 || info.healers.length > 6) {
            skipped.push(`${p.name} (${info.healers.length} healers)`);
            continue;
          }
          chosen.push({
            ...p,
            ...info,
            durationMs: fight.endTime - fight.startTime,
          });
        } catch (e) {
          if (/respondeu (429|5\d\d)|limit/i.test(e.message)) throw e;
          skipped.push(`${p.name} (${e.message.slice(0, 60)})`);
        }
      }
    }
    picks.push(...chosen);
    // a escolha fica salva chefe a chefe: se o limite da API estourar, a próxima rodada não refaz
    save([...picks, ...known.filter((k) => !picks.some((p) => p.code === k.code && p.fight === k.fight))]);
    const comp = (c) => `${c.healers.length}h`;
    console.log(`${enc.name}: ${chosen.map((c) => `${c.name} ${comp(c)}`).join(', ') || 'sem candidatos'}${skipped.length ? ` · pulados: ${skipped.join(', ')}` : ''}`);
  }

  // a escolha fica salva antes dos downloads: se o limite da API estourar no meio, a próxima rodada continua
  save([...known.filter((k) => !picks.some((p) => p.code === k.code && p.fight === k.fight)), ...picks]);

  for (const p of picks) {
    const dir = path.join(outDir, reportDir(p.code));
    const file = path.join(dir, `fight-${p.fight}.json`);
    if (fs.existsSync(file)) continue;
    const report = await reportOf(p.code);
    const { fight, targets, pets, enemies } = fightActors(report, p.fight, [p]);
    const players = fight.friendlyPlayers ?? [];
    const mine = [...targets, ...pets];
    const queries = [
      ...targets.flatMap((id) => [
        { source: id, dataType: 'CombatantInfo' },
        { source: id, dataType: 'Casts' },
        { source: id, dataType: 'Summons' },
        // auras no healer: sourceID = quem tem a aura
        { source: id, dataType: 'Buffs' },
        // buffs que ele põe nos outros (Atonement, Beacon, HoTs): targetID = quem lança
        { target: id, dataType: 'Buffs', hostility: 'Friendlies' },
        // DoTs dele nos inimigos (Shadow Word: Pain)
        { target: id, dataType: 'Debuffs', hostility: 'Enemies' },
        { source: id, dataType: 'DamageDone' },
      ]),
      ...pets.map((id) => ({ source: id, dataType: 'Casts' })),
      // curas e absorções de todo mundo (as dele inteiras; as dos outros viram vida da raid) e o dano tomado
      { dataType: 'Healing' },
      { dataType: 'DamageTaken' },
      { dataType: 'Resources' },
      { dataType: 'Deaths' },
      ENEMY_CASTS,
    ];
    const seen = new Set();
    const all = [];
    for (const q of queries) {
      for (let start = fight.startTime; start != null;) {
        const page = (
          await gql(EVENTS, {
            code: p.code,
            fight: p.fight,
            start,
            end: fight.endTime,
            ...q,
          })
        ).reportData.report.events;
        for (const e of page.data) {
          const key = JSON.stringify(e);
          if (!seen.has(key)) {
            seen.add(key);
            all.push(e);
          }
        }
        start = page.nextPageTimestamp;
      }
    }
    all.sort((a, b) => a.timestamp - b.timestamp);
    const kept = trimHealer(all, { mine, players, enemies });
    if (!kept.some((e) => e.type === 'cast' && targets.includes(e.sourceID))) {
      console.log(`  ${p.code} fight ${p.fight}: nenhum cast do healer veio, pulando`);
      continue;
    }
    fs.writeFileSync(file, JSON.stringify(kept));
    console.log(`  ${p.code} fight ${p.fight} ${fight.name} (${p.name}): ${kept.length} de ${all.length} eventos`);
  }

  const after = (await gql(RATE)).rateLimitData;
  console.log(
    `\n${picks.length} referências em ${outDir}; pontos da API: ${after.pointsSpentThisHour - before.pointsSpentThisHour} (${after.pointsSpentThisHour}/${after.limitPerHour} nesta hora)`,
  );
}
