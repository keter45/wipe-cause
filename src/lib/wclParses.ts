// Parse do Warcraft Logs de cada player, na métrica do papel dele: DPS para dps e tanks,
// HPS para healers (cada ranking no seu). O WCL só ranqueia kills: num wipe mostramos o
// histórico do player naquele boss (mediana e melhor parse), marcado como histórico.

import { invoke } from '@tauri-apps/api/core';
import type { PlayerStats, Pull } from '../types';
import { ownFight } from './wclApi';
import { WCL_DIFFICULTY } from './wcl';

export type ParseMetric = 'dps' | 'hps';

export interface PlayerParse {
  metric: ParseMetric;
  kind: 'kill' | 'history';
  /** kill: parse do fight; histórico: mediana no boss */
  percent: number | null;
  /** kill: parse na faixa de item level */
  bracketPercent?: number | null;
  /** histórico: melhor parse e quantos kills */
  best?: number | null;
  kills?: number;
  /** kill: posição no ranking */
  rank?: number;
  total?: number;
}

/** Healer é ranqueado por HPS; dps e tank, por DPS (como o Warcraft Logs faz por padrão). */
export const metricFor = (role: PlayerStats['role']): ParseMetric => (role === 'healer' ? 'hps' : 'dps');

/** Cores do Warcraft Logs por faixa de parse. */
export function parseColor(p: number | null | undefined): string {
  if (p == null) return 'var(--muted)';
  if (p >= 100) return '#e5cc80';
  if (p >= 99) return '#e268a8';
  if (p >= 95) return '#ff8000';
  if (p >= 75) return '#a335ee';
  if (p >= 50) return '#0070ff';
  if (p >= 25) return '#1eff00';
  return '#9d9d9d';
}

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('en');
/** Reino como o WCL escreve no slug: minúsculo, sem apóstrofo, espaços viram hífen. */
export const serverSlug = (server: string) => norm(server).replace(/['’]/g, '').replace(/\s+/g, '-');

/** "Markíno-Azralon-US" -> nome, reino e região. */
export function splitName(full: string): { name: string; server: string; region: string } {
  const [name, ...rest] = full.split('-');
  const region = rest.length > 1 && /^[A-Z]{2}$/.test(rest[rest.length - 1]) ? rest.pop()! : '';
  return { name, server: rest.join('-'), region };
}

interface RankedCharacter {
  name: string;
  server?: { name?: string };
  rankPercent?: number;
  bracketPercent?: number;
  rank?: number;
  totalParses?: number;
}

/** Players do ranking de um fight (roles.dps/tanks ou roles.healers) por nome+reino. */
export function rankingEntries(json: unknown, metric: ParseMetric): Map<string, RankedCharacter> {
  const fight = (json as { data?: { roles?: Record<string, { characters?: RankedCharacter[] }> }[] })?.data?.[0];
  const roles = fight?.roles ?? {};
  const groups = metric === 'hps' ? [roles.healers] : [roles.dps, roles.tanks];
  const out = new Map<string, RankedCharacter>();
  for (const g of groups) for (const c of g?.characters ?? []) out.set(`${norm(c.name)}|${serverSlug(c.server?.name ?? '')}`, c);
  return out;
}

const keyOf = (p: PlayerStats) => {
  const { name, server } = splitName(p.name);
  return `${norm(name)}|${serverSlug(server)}`;
};

const today = () => new Date().toISOString().slice(0, 10);

function query<T>(q: string, variables: Record<string, unknown>, cacheKey: string): Promise<T> {
  return invoke<T>('wcl_query', { query: q, variables, cacheKey });
}

const KILL_QUERY = `query Ranks($code: String!, $fight: Int!) {
  reportData { report(code: $code) {
    dps: rankings(fightIDs: [$fight], playerMetric: dps)
    hps: rankings(fightIDs: [$fight], playerMetric: hps)
  } }
}`;

/** Parse de cada player no kill (guid -> parse), cada um no ranking do seu papel. */
export async function fetchKillParses(code: string, pull: Pull): Promise<Map<string, PlayerParse>> {
  const fight = await ownFight(code, pull);
  if (!fight) throw new Error('Este kill não foi achado no report do Warcraft Logs.');
  const d = await query<any>(KILL_QUERY, { code, fight: fight.fightId }, `ranks-${code}-${fight.fightId}-${today()}`);
  const byMetric = { dps: rankingEntries(d?.reportData?.report?.dps, 'dps'), hps: rankingEntries(d?.reportData?.report?.hps, 'hps') };
  const out = new Map<string, PlayerParse>();
  for (const p of pull.players) {
    const metric = metricFor(p.role);
    const c = byMetric[metric].get(keyOf(p));
    if (!c) continue;
    out.set(p.guid, {
      metric,
      kind: 'kill',
      percent: c.rankPercent ?? null,
      bracketPercent: c.bracketPercent ?? null,
      rank: c.rank,
      total: c.totalParses,
    });
  }
  return out;
}

/** Consulta com um apelido por player (uma requisição para o raid inteiro). */
export function historyQuery(players: PlayerStats[], encounterId: number, difficulty: number): string {
  const parts = players.map((p, i) => {
    const { name, server, region } = splitName(p.name);
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `p${i}: character(name: "${esc(name)}", serverSlug: "${esc(serverSlug(server))}", serverRegion: "${esc((region || 'us').toLowerCase())}") { encounterRankings(encounterID: ${encounterId}, difficulty: ${difficulty}, metric: ${metricFor(p.role)}) }`;
  });
  return `query { characterData { ${parts.join('\n')} } }`;
}

/** Histórico de cada player no boss (wipe: não há parse do pull). */
export async function fetchHistory(pull: Pull): Promise<Map<string, PlayerParse>> {
  const difficulty = WCL_DIFFICULTY[pull.difficultyId];
  const players = pull.players.filter((p) => splitName(p.name).server);
  if (!difficulty || players.length === 0) return new Map();
  const d = await query<any>(historyQuery(players, pull.encounterId, difficulty), {}, `hist-${pull.encounterId}-${difficulty}-${pull.startMs}-${today()}`);
  const out = new Map<string, PlayerParse>();
  players.forEach((p, i) => {
    const r = d?.characterData?.[`p${i}`]?.encounterRankings;
    if (!r || !r.totalKills) return;
    const ranks: { rankPercent?: number }[] = Array.isArray(r.ranks) ? r.ranks : [];
    const best = ranks.reduce<number | null>((m, x) => (x.rankPercent != null && (m == null || x.rankPercent > m) ? x.rankPercent : m), null);
    out.set(p.guid, { metric: metricFor(p.role), kind: 'history', percent: r.medianPerformance ?? null, best, kills: r.totalKills });
  });
  return out;
}
