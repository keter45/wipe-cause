// Top players da spec no Warcraft Logs (API v2, GraphQL). As consultas saem pelo backend,
// que guarda o client ID/secret no cofre do sistema e faz cache das respostas.
//
// Fluxo: rankings da spec no boss (com setup) -> escolhe quem tem ilvl parecido (e tempo de
// kill parecido, se já matamos) -> baixa os casts e o dano por habilidade daquele fight e
// monta um "player" no mesmo formato do nosso log, para a mesma comparação da aba.

import { invoke } from '@tauri-apps/api/core';
import type { GearItem, PlayerStats, Pull, Setup, SpellAmount, SpellCasts } from '../types';
import type { Sample } from './performance';
import { SPEC_NAMES } from './specs';
import { WCL_DIFFICULTY } from './wcl';

export interface WclConfig {
  configured: boolean;
  clientId: string | null;
}

export const wclGetConfig = () => invoke<WclConfig>('wcl_get_config');
export const wclSetConfig = (clientId: string, clientSecret: string) => invoke<void>('wcl_set_config', { clientId, clientSecret });

function query<T>(q: string, variables: Record<string, unknown>, cacheKey?: string): Promise<T> {
  return invoke<T>('wcl_query', { query: q, variables, cacheKey: cacheKey ?? null });
}

// ---- rankings

export interface TopRanking {
  name: string;
  server: string;
  region: string;
  /** DPS/HPS do parse */
  amount: number;
  durationMs: number;
  code: string;
  fightId: number;
  itemLevel: number | null;
  combatantInfo: unknown;
}

/** Entradas de `characterRankings` (JSON sem esquema fixo: lido com cuidado). */
export function parseRankings(json: unknown): TopRanking[] {
  const list = (json as { rankings?: unknown[] })?.rankings;
  if (!Array.isArray(list)) return [];
  return list.flatMap((r: any) => {
    if (!r?.report?.code || r.report.fightID == null || !r.name) return [];
    // os rankings trazem `gear` e `talents` ({talentID = entrada, points}) direto na entrada;
    // vira o mesmo formato do combatantInfo do playerDetails (os status só vêm de lá)
    const ci = {
      gear: r.gear,
      talentTree: Array.isArray(r.talents) ? r.talents.map((t: any) => ({ id: t?.talentID, rank: t?.points, nodeID: 0 })) : [],
    };
    const ilvl = Number(r.bracketData) || gearItemLevel(r.gear);
    return [
      {
        name: String(r.name),
        server: String(r.server?.name ?? ''),
        region: String(r.server?.region ?? ''),
        amount: Number(r.amount) || 0,
        durationMs: Number(r.duration) || 0,
        code: String(r.report.code),
        fightId: Number(r.report.fightID),
        itemLevel: ilvl,
        combatantInfo: ci,
      },
    ];
  });
}

/** Faixa de ilvl aceita na primeira tentativa; se ninguém cair nela, alarga. */
const ILVL_STEPS = [3, 6, 10, Infinity];
/** Quantos tops oferecer na lista. */
export const TOPS_SHOWN = 8;

/**
 * Tops comparáveis: ilvl parecido com o do player e, se o pull foi kill, tempo de kill parecido
 * (na progressão não há tempo de kill: só o ilvl filtra). Do maior para o menor parse.
 */
export function pickTops(list: TopRanking[], myIlvl: number | null, myKillMs: number | null): TopRanking[] {
  let pool = list;
  if (myIlvl != null) {
    for (const step of ILVL_STEPS) {
      const near = list.filter((r) => r.itemLevel == null || Math.abs(r.itemLevel - myIlvl) <= step);
      if (near.length >= 3 || step === Infinity) {
        pool = near;
        break;
      }
    }
  }
  if (myKillMs != null) pool = [...pool].sort((a, b) => Math.abs(a.durationMs - myKillMs) - Math.abs(b.durationMs - myKillMs)).slice(0, TOPS_SHOWN * 2);
  return [...pool].sort((a, b) => b.amount - a.amount).slice(0, TOPS_SHOWN);
}

const RANKINGS_QUERY = `query Rankings($id: Int!, $difficulty: Int!, $className: String!, $specName: String!, $metric: CharacterRankingMetricType, $page: Int) {
  worldData { encounter(id: $id) { characterRankings(difficulty: $difficulty, className: $className, specName: $specName, metric: $metric, page: $page, includeCombatantInfo: true) } }
}`;

const today = () => new Date().toISOString().slice(0, 10);

export async function fetchRankings(pull: Pull, specId: number, healer: boolean): Promise<TopRanking[]> {
  const spec = SPEC_NAMES[specId];
  const difficulty = WCL_DIFFICULTY[pull.difficultyId];
  if (!spec || !difficulty) throw new Error('Sem rankings para esta dificuldade ou spec no Warcraft Logs.');
  const metric = healer ? 'hps' : 'dps';
  const vars = { id: pull.encounterId, difficulty, className: spec.class, specName: spec.spec, metric };
  // rankings mudam ao longo do dia: cache diário, 2 páginas (200 parses)
  const pages = await Promise.all(
    [1, 2].map((page) =>
      query<any>(RANKINGS_QUERY, { ...vars, page }, `rank-${pull.encounterId}-${difficulty}-${specId}-${metric}-p${page}-${today()}`).catch((e) => {
        if (page === 1) throw e;
        return null;
      }),
    ),
  );
  return pages.flatMap((d) => parseRankings(d?.worldData?.encounter?.characterRankings));
}

// ---- fight de um top

const FIGHT_QUERY = `query Fight($code: String!, $fight: Int!) {
  reportData { report(code: $code) {
    fights(fightIDs: [$fight]) { id startTime endTime encounterID kill }
    masterData { actors(type: "Player") { id name server } abilities { gameID name icon } }
    playerDetails(fightIDs: [$fight], includeCombatantInfo: true)
  } }
}`;

// startTime sem endTime devolve lista vazia: os dois vão sempre juntos
const CASTS_QUERY = `query Casts($code: String!, $fight: Int!, $source: Int!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], sourceID: $source, dataType: Casts, startTime: $start, endTime: $end, limit: 10000) { data nextPageTimestamp }
  } }
}`;

const TABLE_QUERY = `query Table($code: String!, $fight: Int!, $source: Int!, $type: TableDataType!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) { table(fightIDs: [$fight], sourceID: $source, dataType: $type, startTime: $start, endTime: $end) } }
}`;

/** Tempo vivo do nosso player: a parte da luta que dá para comparar. */
const windowOf = (me: Sample) => Math.max(30_000, me.player.aliveMs ?? me.pull.analyzedMs);

/** COMBATANT_INFO do WCL -> nosso Setup. */
export function parseCombatantInfo(ci: any): Setup | null {
  if (!ci) return null;
  const st = (k: string) => Number(ci.stats?.[k]?.min ?? ci.stats?.[k] ?? 0) || 0;
  const gear: any[] = Array.isArray(ci.gear) ? ci.gear : [];
  const items: GearItem[] = gear.flatMap((g, i) =>
    g?.id
      ? [
          {
            slot: Number(g.slot ?? i),
            itemId: Number(g.id),
            ilvl: Number(g.itemLevel) || 0,
            enchant: Number(g.permanentEnchant) || null,
            gems: Array.isArray(g.gems) ? g.gems.map((x: any) => Number(x?.id)).filter(Boolean) : [],
          },
        ]
      : [],
  );
  const talents: [number, number, number][] = (Array.isArray(ci.talentTree) ? ci.talentTree : [])
    .filter((t: any) => t?.id)
    .map((t: any) => [Number(t.nodeID) || 0, Number(t.id), Number(t.rank) || 1]);
  return {
    stats: {
      strength: st('Strength'),
      agility: st('Agility'),
      stamina: st('Stamina'),
      intellect: st('Intellect'),
      crit: st('Crit'),
      haste: st('Haste'),
      mastery: st('Mastery'),
      versatility: st('Versatility'),
      leech: st('Leech'),
      avoidance: st('Avoidance'),
      speed: st('Speed'),
    },
    itemLevel: gearItemLevel(gear) ?? 0,
    items,
    talents,
  };
}

/** Média de ilvl como no jogo (sem camisa/tabardo; arma de duas mãos conta duas vezes). */
export function gearItemLevel(gear: any): number | null {
  if (!Array.isArray(gear)) return null;
  const items = gear.map((g, i) => ({ slot: Number(g?.slot ?? i), ilvl: Number(g?.itemLevel) || 0 })).filter((g) => g.ilvl > 0 && g.slot !== 3 && g.slot !== 18 && g.slot !== 17);
  if (items.length === 0) return null;
  let total = items.reduce((a, g) => a + g.ilvl, 0);
  if (!items.some((g) => g.slot === 16)) total += items.find((g) => g.slot === 15)?.ilvl ?? 0;
  return total / 16;
}

/** O que identifica o top e os links dele. */
export interface TopSource {
  code: string;
  fightId: number;
  actorId: number;
  name: string;
  server: string;
  amount: number;
}

export type TopSample = Sample & { source: TopSource };

export const wclFightUrl = (s: Pick<TopSource, 'code' | 'fightId' | 'actorId'>) =>
  `https://www.warcraftlogs.com/reports/${s.code}#fight=${s.fightId}&type=damage-done&source=${s.actorId}`;
export const wowAnalyzerUrl = (s: Pick<TopSource, 'code' | 'fightId' | 'name'>) =>
  `https://wowanalyzer.com/report/${s.code}/${s.fightId}/${encodeURIComponent(s.name)}/standard`;

/** Casts (só `cast`, sem `begincast`) em ms desde o início do fight, agrupados por habilidade. */
export function groupCasts(events: any[], startTime: number, names: Map<number, string>): SpellCasts[] {
  const by = new Map<number, number[]>();
  for (const e of events) {
    if (e?.type !== 'cast' || !e.abilityGameID) continue;
    const id = Number(e.abilityGameID);
    (by.get(id) ?? by.set(id, []).get(id)!).push(Number(e.timestamp) - startTime);
  }
  return [...by].map(([spellId, times]) => ({ spellId, name: names.get(spellId) ?? `Spell ${spellId}`, times }));
}

/** Linhas da tabela de dano/cura de uma fonte. */
export function tableAmounts(json: any): SpellAmount[] {
  const entries: any[] = json?.data?.entries ?? [];
  return entries
    .filter((e) => e?.guid && Number(e.total) > 0)
    .map((e) => ({ spellId: Number(e.guid), name: String(e.name ?? ''), amount: Number(e.total), pet: false }))
    .sort((a, b) => b.amount - a.amount);
}

/** Baixa o fight do top e monta a amostra no formato do nosso log. */
export async function loadTop(top: TopRanking, me: Sample, index: number): Promise<TopSample> {
  const key = `${top.code}-${top.fightId}`;
  const fightData = await query<any>(FIGHT_QUERY, { code: top.code, fight: top.fightId }, `fight-${key}`);
  const report = fightData?.reportData?.report;
  const fight = report?.fights?.[0];
  if (!fight) throw new Error('Fight do top não encontrado no Warcraft Logs (report privado ou apagado).');
  const actors: any[] = report.masterData?.actors ?? [];
  const actor = actors.find((a) => a.name === top.name && (!top.server || !a.server || a.server === top.server)) ?? actors.find((a) => a.name === top.name);
  if (!actor) throw new Error(`${top.name} não aparece no report do Warcraft Logs.`);
  const names = new Map<number, string>((report.masterData?.abilities ?? []).map((a: any) => [Number(a.gameID), String(a.name)]));

  const events: any[] = [];
  let start: number | null = fight.startTime;
  for (let page = 0; start != null && page < 10; page++) {
    const d = await query<any>(CASTS_QUERY, { code: top.code, fight: top.fightId, source: actor.id, start, end: fight.endTime }, `casts2-${key}-${actor.id}-${page}`);
    const ev = d?.reportData?.report?.events;
    events.push(...(ev?.data ?? []));
    start = ev?.nextPageTimestamp ?? null;
  }
  const healer = me.player.role === 'healer';
  const fullMs = Number(fight.endTime) - Number(fight.startTime);
  // mesma janela do nosso tempo vivo (arredondada a 5s, para o cache servir a pulls parecidos):
  // compara a mesma parte da luta, sem o execute e as fases que o wipe não viu
  const durationMs = Math.min(fullMs, Math.ceil(windowOf(me) / 5000) * 5000);
  const table = await query<any>(
    TABLE_QUERY,
    { code: top.code, fight: top.fightId, source: actor.id, type: healer ? 'Healing' : 'DamageDone', start: fight.startTime, end: fight.startTime + durationMs },
    `table2-${key}-${actor.id}-${healer ? 'h' : 'd'}-${durationMs}`,
  );
  const amounts = tableAmounts(table?.reportData?.report?.table);

  const details = report.playerDetails?.data?.playerDetails ?? report.playerDetails?.playerDetails ?? {};
  const detail = [...(details.dps ?? []), ...(details.healers ?? []), ...(details.tanks ?? [])].find((p: any) => p?.id === actor.id);
  const setup = parseCombatantInfo(detail?.combatantInfo ?? top.combatantInfo);
  const total = amounts.reduce((a, x) => a + x.amount, 0) || (top.amount * durationMs) / 1000;
  const casts = groupCasts(events, Number(fight.startTime), names)
    .map((c) => ({ ...c, times: c.times.filter((t) => t <= durationMs) }))
    .filter((c) => c.times.length > 0);

  const player: PlayerStats = {
    ...me.player,
    guid: `wcl:${key}:${actor.id}`,
    name: `${top.name}-${top.server}`,
    damageDone: healer ? 0 : total,
    healingDone: healer ? total : 0,
    dps: healer ? 0 : total / (durationMs / 1000),
    hps: healer ? total / (durationMs / 1000) : 0,
    deaths: 0,
    defensivesUsed: [],
    takenByAbility: [],
    interruptLog: [],
    interrupts: 0,
    interruptAttempts: 0,
    casts,
    damageBySpell: healer ? [] : amounts,
    healingBySpell: healer ? amounts : [],
    aliveMs: durationMs,
    setup,
  };
  const pull: Pull = {
    ...me.pull,
    id: -1 - index,
    pullNumber: 0,
    success: !!fight.kill,
    // duração real do kill (a janela comparada está em analyzedMs)
    durationMs: fullMs,
    analyzedMs: durationMs,
    cutoffT: null,
    players: [player],
    deaths: [],
  };
  return { pull, player, source: { code: top.code, fightId: top.fightId, actorId: Number(actor.id), name: top.name, server: top.server, amount: top.amount } };
}

// ---- o próprio pull no WCL (links do WoWAnalyzer)

const REPORT_FIGHTS_QUERY = `query Fights($code: String!, $encounter: Int!) {
  reportData { report(code: $code) { startTime fights(encounterID: $encounter) { id startTime endTime difficulty kill } masterData { actors(type: "Player") { id name server } } } }
}`;

export interface OwnFight {
  fightId: number;
  actors: { id: number; name: string; server: string }[];
}

/**
 * Qual fight do report é este pull: pelo horário (±2 min), senão pela ordem das tentativas
 * do boss na dificuldade (a numeração "Wipe N" do WCL conta os pulls curtos).
 */
export function matchFight(report: any, pull: Pull): number | null {
  const diff = WCL_DIFFICULTY[pull.difficultyId];
  const fights: any[] = (report?.fights ?? []).filter((f: any) => !diff || f.difficulty === diff);
  if (fights.length === 0) return null;
  const base = Number(report.startTime) || 0;
  const byTime = fights.find((f) => Math.abs(base + Number(f.startTime) - pull.startMs) <= 120_000);
  if (byTime) return Number(byTime.id);
  return Number(fights[pull.pullNumberAll - 1]?.id) || null;
}

export async function ownFight(code: string, pull: Pull): Promise<OwnFight | null> {
  // o report ainda pode receber pulls (log ao vivo): cache por dia
  const d = await query<any>(REPORT_FIGHTS_QUERY, { code, encounter: pull.encounterId }, `own-${code}-${pull.encounterId}-${today()}`);
  const report = d?.reportData?.report;
  const fightId = matchFight(report, pull);
  if (fightId == null) return null;
  return { fightId, actors: (report.masterData?.actors ?? []).map((a: any) => ({ id: Number(a.id), name: String(a.name), server: String(a.server ?? '') })) };
}
