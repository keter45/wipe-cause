// Top players da spec no Warcraft Logs (API v2, GraphQL). As consultas saem pelo backend,
// que guarda o client ID/secret no cofre do sistema e faz cache das respostas.
//
// Fluxo: rankings da spec no boss (com setup) -> escolhe quem tem ilvl parecido (e tempo de
// kill parecido, se já matamos) -> baixa os casts e o dano por habilidade daquele fight e
// monta um "player" no mesmo formato do nosso log, para a mesma comparação da aba.

import { invoke } from '@tauri-apps/api/core';
import type { BuffTrace, GearItem, PlayerStats, Pull, Setup, SpellAmount, SpellCasts } from '../types';
import { buffTraces, type AuraChange } from './decisions';
import type { Sample } from './performance';
import { SPEC_NAMES } from './specs';
import { WCL_DIFFICULTY } from './wcl';
import { messagesOf } from '../i18n';
import { wclMsg } from './wcl.i18n';

export interface WclGuild {
  id: number;
  name: string;
  serverSlug: string;
  serverName: string;
  /** "US", "EU"... */
  region: string;
}

export interface WclUser {
  id: number;
  name: string;
  guilds: WclGuild[];
}

export interface WclConfig {
  /** dá para consultar a API (login ou client próprio) */
  configured: boolean;
  clientId: string | null;
  /** quem entrou com a conta do Warcraft Logs */
  user?: WclUser | null;
  /** esta versão tem o login com a conta */
  loginAvailable?: boolean;
}

export const wclGetConfig = () => invoke<WclConfig>('wcl_get_config');
export const wclSetConfig = (clientId: string, clientSecret: string) => invoke<void>('wcl_set_config', { clientId, clientSecret });
export const wclLogin = () => invoke<WclUser>('wcl_login');
export const wclLogout = () => invoke<void>('wcl_logout');

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
export function pickTops(list: TopRanking[], myIlvl: number | null, myKillMs: number | null, n = TOPS_SHOWN): TopRanking[] {
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
  if (myKillMs != null) pool = [...pool].sort((a, b) => Math.abs(a.durationMs - myKillMs) - Math.abs(b.durationMs - myKillMs)).slice(0, n * 2);
  return [...pool].sort((a, b) => b.amount - a.amount).slice(0, n);
}

// Todos os parses: o filtro de buffs externos do WCL tira também quem jogou com Augmentation, e toda
// raid de topo tem um. Só o Power Infusion de outra pessoa tira um top da lista (withoutExternalPI).
const RANKINGS_QUERY = `query Rankings($id: Int!, $difficulty: Int!, $className: String!, $specName: String!, $metric: CharacterRankingMetricType, $page: Int) {
  worldData { encounter(id: $id) { characterRankings(difficulty: $difficulty, className: $className, specName: $specName, metric: $metric, page: $page, includeCombatantInfo: true) } }
}`;

const today = () => new Date().toISOString().slice(0, 10);

export async function fetchRankings(pull: Pull, specId: number, healer: boolean): Promise<TopRanking[]> {
  const spec = SPEC_NAMES[specId];
  const difficulty = WCL_DIFFICULTY[pull.difficultyId];
  if (!spec || !difficulty) throw new Error(messagesOf(wclMsg).noRankings);
  const metric = healer ? 'hps' : 'dps';
  const vars = { id: pull.encounterId, difficulty, className: spec.class, specName: spec.spec, metric };
  // rankings mudam ao longo do dia: cache diário, 2 páginas (200 parses)
  const pages = await Promise.all(
    [1, 2].map((page) =>
      query<any>(RANKINGS_QUERY, { ...vars, page }, `rank-all-${pull.encounterId}-${difficulty}-${specId}-${metric}-p${page}-${today()}`).catch((e) => {
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
// nas auras o WCL inverte: Buffs com sourceID = quem TEM a aura (o evento traz quem lançou em sourceID)
const BUFFS_QUERY = `query Buffs($code: String!, $fight: Int!, $source: Int!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], sourceID: $source, dataType: Buffs, startTime: $start, endTime: $end, limit: 10000) { data nextPageTimestamp }
  } }
}`;

const CASTS_QUERY = `query Casts($code: String!, $fight: Int!, $source: Int!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], sourceID: $source, dataType: Casts, startTime: $start, endTime: $end, limit: 10000) { data nextPageTimestamp }
  } }
}`;

const POWER_INFUSION = 10060;
const PI_QUERY = `query PI($code: String!, $fight: Int!, $target: Int!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) {
    events(fightIDs: [$fight], targetID: $target, dataType: Buffs, abilityID: ${POWER_INFUSION}, startTime: $start, endTime: $end, limit: 1000) { data }
  } }
}`;

/** O top recebeu Power Infusion de outra pessoa nessa luta? (o Priest dando PI em si mesmo vale) */
async function externalPI(top: TopRanking): Promise<boolean> {
  const key = `${top.code}-${top.fightId}`;
  const report = (await query<any>(FIGHT_QUERY, { code: top.code, fight: top.fightId }, `fight-${key}`))?.reportData?.report;
  const fight = report?.fights?.[0];
  const actors: any[] = report?.masterData?.actors ?? [];
  const actor = actors.find((a) => a.name === top.name && (!top.server || !a.server || a.server === top.server)) ?? actors.find((a) => a.name === top.name);
  if (!fight || !actor) return false; // sem como conferir: o loadTop avisa depois
  const d = await query<any>(PI_QUERY, { code: top.code, fight: top.fightId, target: actor.id, start: fight.startTime, end: fight.endTime }, `pi-${key}-${actor.id}`);
  return (d?.reportData?.report?.events?.data ?? []).some((e: any) => e.type === 'applybuff' && Number(e.abilityGameID) === POWER_INFUSION && e.sourceID !== actor.id);
}

/** Até `n` tops sem Power Infusion de outra pessoa, na ordem em que vieram. */
export async function withoutExternalPI(tops: TopRanking[], n = TOPS_SHOWN): Promise<TopRanking[]> {
  const out: TopRanking[] = [];
  for (const t of tops) {
    if (out.length >= n) break;
    if (!(await externalPI(t).catch(() => false))) out.push(t);
  }
  return out;
}

const TABLE_QUERY = `query Table($code: String!, $fight: Int!, $source: Int!, $type: TableDataType!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) { table(fightIDs: [$fight], sourceID: $source, dataType: $type, startTime: $start, endTime: $end) } }
}`;

// gráfico do site (dano/cura por intervalo, com os pets): a linha do tempo do top no modo solo
const GRAPH_QUERY = `query Graph($code: String!, $fight: Int!, $source: Int!, $type: GraphDataType!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) { graph(fightIDs: [$fight], sourceID: $source, dataType: $type, startTime: $start, endTime: $end) } }
}`;

/** Janela da linha do tempo do núcleo (TIMELINE_MS). */
const BUCKET_MS = 5_000;

/**
 * Gráfico do Warcraft Logs -> dano por janela de 5s desde o início do fight. As séries vêm em
 * "por segundo" a cada `pointInterval` ms; com uma série "Total" usa só ela, senão soma todas
 * (player e pets).
 */
export function graphTimeline(json: any, fightStart: number, durationMs: number): number[] {
  const series: any[] = json?.data?.series ?? json?.series ?? [];
  const total = series.find((x) => /^total$/i.test(String(x?.name ?? '')));
  const use = total ? [total] : series;
  const n = Math.ceil(durationMs / BUCKET_MS);
  const out = new Array<number>(n).fill(0);
  for (const se of use) {
    const interval = Number(se?.pointInterval) || 1000;
    const start = Number(se?.pointStart ?? fightStart);
    (se?.data ?? []).forEach((v: any, i: number) => {
      const [t, rate] = Array.isArray(v) ? [Number(v[0]), Number(v[1])] : [start + i * interval, Number(v)];
      const k = Math.floor((t - fightStart) / BUCKET_MS);
      if (k >= 0 && k < n && Number.isFinite(rate)) out[k] += (rate * interval) / 1000;
    });
  }
  return out.map(Math.round);
}

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
export interface TopSource extends WclFightRef {
  server: string;
  /** us, eu, kr, tw, cn */
  region: string;
  amount: number;
}

/** `buffs`: os buffs curtos que o top se deu (para comparar as decisões; o top não tem leitura de rotação). */
export type TopSample = Sample & { source: TopSource; buffs: BuffTrace[] };

/**
 * Buffs que o próprio player se deu, em mudanças de cargas (ms desde o início do fight). O
 * `refreshbuff` não muda cargas.
 */
export function auraChanges(events: any[], actorId: number, startTime: number, names: Map<number, string>): AuraChange[] {
  const out: AuraChange[] = [];
  for (const e of events) {
    if (Number(e?.sourceID) !== actorId || Number(e?.targetID) !== actorId || !e.abilityGameID) continue;
    const stacks = e.type === 'applybuff' ? Number(e.stack ?? 1) : e.type === 'applybuffstack' || e.type === 'removebuffstack' ? Number(e.stack ?? 0) : e.type === 'removebuff' ? 0 : null;
    if (stacks == null) continue;
    const id = Number(e.abilityGameID);
    out.push({ t: Number(e.timestamp) - startTime, id, name: names.get(id) ?? `Spell ${id}`, stacks });
  }
  return out;
}

/** Um player num fight do Warcraft Logs: o bastante para os links (o fight, o filtro dele e trechos). */
export interface WclFightRef {
  code: string;
  fightId: number;
  actorId: number;
  /** início do fight em ms desde o começo do report (os trechos do link contam daí) */
  fightStart: number;
  name: string;
}

export type WclView = 'damage-done' | 'healing';

/**
 * O fight filtrado no player; com `from`/`to` (ms desde o início do fight), só aquele trecho — o
 * mesmo `start`/`end` que o site grava ao selecionar um pedaço do gráfico.
 */
export function wclRangeUrl(f: WclFightRef, type: WclView, from?: number, to?: number): string {
  const q = new URLSearchParams({ fight: String(f.fightId), type, source: String(f.actorId) });
  if (from != null && to != null) {
    q.set('start', String(Math.round(f.fightStart + from)));
    q.set('end', String(Math.round(f.fightStart + to)));
  }
  return `https://www.warcraftlogs.com/reports/${f.code}?${q}`;
}

/** Nome do reino na URL do Raider.IO e do Warcraft Logs: "Moon Guard" -> "moon-guard", "Mal'Ganis" -> "malganis". */
export const realmSlug = (realm: string) => realm.toLowerCase().replace(/['’]/g, '').trim().replace(/\s+/g, '-');

export type ProfileSite = 'raiderio' | 'wcl';

/**
 * O perfil do player no Raider.IO e no Warcraft Logs (que mostra as redes dele quando ele cadastrou;
 * nenhuma API expõe isso, então o app não linka rede social). Não cobrem a China.
 */
export function profileUrls(p: { name: string; server: string; region: string }): { site: ProfileSite; url: string }[] {
  const out: { site: ProfileSite; url: string }[] = [];
  const region = p.region.toLowerCase();
  if (['us', 'eu', 'kr', 'tw'].includes(region) && p.server) {
    const path = `${region}/${realmSlug(p.server)}/${encodeURIComponent(p.name)}`;
    out.push({ site: 'raiderio', url: `https://raider.io/characters/${path}` });
    out.push({ site: 'wcl', url: `https://www.warcraftlogs.com/character/${path}` });
  }
  return out;
}

/**
 * Os dois fights lado a lado na comparação do próprio Warcraft Logs (vale para reports diferentes).
 * Com `from`/`to` (ms desde o início do fight), o mesmo trecho nos dois: `start`/`end` levam um
 * valor por log, cada um contado do começo do próprio report.
 */
export function wclCompareUrl(a: WclFightRef, b: WclFightRef, type: WclView, from?: number, to?: number): string {
  const q = new URLSearchParams({ fight: `${a.fightId},${b.fightId}`, type, source: `${a.actorId},${b.actorId}` });
  if (from != null && to != null) {
    const at = (f: WclFightRef, ms: number) => Math.round(f.fightStart + ms);
    q.set('start', `${at(a, from)},${at(b, from)}`);
    q.set('end', `${at(a, to)},${at(b, to)}`);
  }
  return `https://www.warcraftlogs.com/reports/compare/${a.code}/${b.code}?${q}`;
}
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
  if (!fight) throw new Error(messagesOf(wclMsg).topFightMissing);
  const actors: any[] = report.masterData?.actors ?? [];
  const actor = actors.find((a) => a.name === top.name && (!top.server || !a.server || a.server === top.server)) ?? actors.find((a) => a.name === top.name);
  if (!actor) throw new Error(messagesOf(wclMsg).actorMissing(top.name));
  const names = new Map<number, string>((report.masterData?.abilities ?? []).map((a: any) => [Number(a.gameID), String(a.name)]));

  const events: any[] = [];
  let start: number | null = fight.startTime;
  for (let page = 0; start != null && page < 10; page++) {
    const d = await query<any>(CASTS_QUERY, { code: top.code, fight: top.fightId, source: actor.id, start, end: fight.endTime }, `casts2-${key}-${actor.id}-${page}`);
    const ev = d?.reportData?.report?.events;
    events.push(...(ev?.data ?? []));
    start = ev?.nextPageTimestamp ?? null;
  }
  // buffs que ele se deu (procs, janelas de cooldown): sem eles, só não dá para comparar as decisões
  const buffEvents: any[] = [];
  let bstart: number | null = fight.startTime;
  for (let page = 0; bstart != null && page < 10; page++) {
    const d = await query<any>(BUFFS_QUERY, { code: top.code, fight: top.fightId, source: actor.id, start: bstart, end: fight.endTime }, `buffs-${key}-${actor.id}-${page}`).catch(() => null);
    const ev = d?.reportData?.report?.events;
    buffEvents.push(...(ev?.data ?? []));
    bstart = ev?.nextPageTimestamp ?? null;
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
  // modo solo: dano ao longo do fight e dano tomado por habilidade (falha aqui não impede a comparação)
  const range = { code: top.code, fight: top.fightId, source: actor.id, start: fight.startTime, end: fight.startTime + durationMs };
  const graph = await query<any>(GRAPH_QUERY, { ...range, type: healer ? 'Healing' : 'DamageDone' }, `graph-${key}-${actor.id}-${healer ? 'h' : 'd'}-${durationMs}`).catch(() => null);
  const timeline = graph ? graphTimeline(graph?.reportData?.report?.graph, Number(fight.startTime), durationMs) : [];
  const takenTable = await query<any>(TABLE_QUERY, { ...range, type: 'DamageTaken' }, `taken-${key}-${actor.id}-${durationMs}`).catch(() => null);
  const taken = tableAmounts(takenTable?.reportData?.report?.table).map((x) => ({ spellId: x.spellId, name: x.name, source: '', amount: x.amount, hits: 0 }));

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
    takenByAbility: taken,
    interruptLog: [],
    interrupts: 0,
    interruptAttempts: 0,
    casts,
    damageBySpell: healer ? [] : amounts,
    healingBySpell: healer ? amounts : [],
    aliveMs: durationMs,
    setup,
    // a leitura da rotação do top não vem do WCL (não herda a sua)
    rotation: undefined,
    damageTimeline: healer ? [] : timeline,
    healingTimeline: healer ? timeline : [],
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
  const castList = casts.flatMap((c) => c.times.map((t) => ({ t, id: c.spellId })));
  const buffs = buffTraces(auraChanges(buffEvents, Number(actor.id), Number(fight.startTime), names), castList, durationMs);
  return { pull, player, buffs, source: { code: top.code, fightId: top.fightId, actorId: Number(actor.id), fightStart: Number(fight.startTime), name: top.name, server: top.server, region: top.region, amount: top.amount } };
}

// ---- o próprio pull no WCL (links do WoWAnalyzer)

const REPORT_FIGHTS_QUERY = `query Fights($code: String!, $encounter: Int!) {
  reportData { report(code: $code) { startTime fights(encounterID: $encounter) { id startTime endTime difficulty kill } masterData { actors(type: "Player") { id name server } } } }
}`;

export interface OwnFight {
  fightId: number;
  /** início do fight em ms desde o começo do report */
  fightStart: number;
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
  const fightStart = Number(report.fights.find((f: any) => Number(f.id) === fightId)?.startTime) || 0;
  return { fightId, fightStart, actors: (report.masterData?.actors ?? []).map((a: any) => ({ id: Number(a.id), name: String(a.name), server: String(a.server ?? '') })) };
}
