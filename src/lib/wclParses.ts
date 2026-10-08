// Parse do Warcraft Logs de cada player, na métrica do papel dele: DPS para dps e tanks,
// HPS para healers (cada ranking no seu). O WCL só ranqueia kills: num wipe mostramos o
// histórico do player naquele boss (mediana e melhor parse), marcado como histórico.

import { invoke } from '@tauri-apps/api/core';
import type { PlayerStats, Pull } from '../types';
import { ownFight } from './wclApi';
import { WCL_DIFFICULTY } from './wcl';
import { messagesOf } from '../i18n';
import { wclMsg } from './wcl.i18n';
import { noteKey } from './notes';

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

// ---- parses de kill salvos: o parse de um fight não muda o bastante para pedir de novo, e a nota do
// player (score.ts) lê daqui sem esperar a API. Ficam no navegador do app, por boss + início do pull,
// pelo nome do player (o guid muda entre o log do PC e o Warcraft Logs).

type PullRef = Pick<Pull, 'encounterId' | 'startMs' | 'difficultyId'>;
const PARSES_KEY = 'wipe-cause:parses:';

/** O que fica salvo por kill: a dificuldade (para comparar com kills iguais) e o parse de cada player. */
interface SavedKill {
  difficultyId: number;
  byName: Record<string, PlayerParse>;
}

/** Parse como o site mostra: inteiro. */
export const wholeParse = (x: number | null | undefined) => (x == null ? null : Math.round(x));

const rounded = (p: PlayerParse): PlayerParse => ({ ...p, percent: wholeParse(p.percent), bracketPercent: wholeParse(p.bracketPercent), best: wholeParse(p.best) });

function readSaved(key: string): SavedKill | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedKill | Record<string, PlayerParse>;
    // formato antigo: só o parse de cada player, sem a dificuldade
    const saved: { difficultyId?: number; byName: Record<string, PlayerParse> } = 'byName' in v && typeof v.byName === 'object' ? (v as SavedKill) : { byName: v as Record<string, PlayerParse> };
    return { difficultyId: saved.difficultyId ?? -1, byName: Object.fromEntries(Object.entries(saved.byName).map(([k, p]) => [k, rounded(p)])) };
  } catch {
    return null;
  }
}

/** Parses salvos do kill (nome do player -> parse); null = ainda não buscados. */
export function storedKillParses(p: PullRef): Record<string, PlayerParse> | null {
  return readSaved(PARSES_KEY + noteKey(p))?.byName ?? null;
}

function saveKillParses(p: PullRef, byName: Record<string, PlayerParse>) {
  try {
    localStorage.setItem(PARSES_KEY + noteKey(p), JSON.stringify({ difficultyId: p.difficultyId, byName } satisfies SavedKill));
  } catch {
    /* sem storage: vale só nesta sessão */
  }
}

export interface OwnParses {
  /** o kill anterior dele neste boss e dificuldade */
  previous: { percent: number; startMs: number } | null;
  /** média dos kills anteriores dele (com parse) */
  avg: number | null;
  kills: number;
}

/** O parse do player nos kills anteriores do mesmo boss e dificuldade (os que o app já salvou). */
export function ownPreviousParses(p: PullRef, name: string): OwnParses {
  const prefix = `${PARSES_KEY}${p.encounterId}:`;
  const before: { percent: number; startMs: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const startMs = Number(key.slice(prefix.length));
      if (!(startMs < p.startMs)) continue;
      const saved = readSaved(key);
      const percent = saved?.difficultyId === p.difficultyId ? saved.byName[name]?.percent : null;
      if (percent != null) before.push({ percent, startMs });
    }
  } catch {
    /* sem storage */
  }
  before.sort((a, b) => a.startMs - b.startMs);
  return {
    previous: before[before.length - 1] ?? null,
    avg: before.length ? Math.round(before.reduce((s, x) => s + x.percent, 0) / before.length) : null,
    kills: before.length,
  };
}

/** Parse do player no kill, se já buscado (0-100). Wipe não tem parse. */
export function killParseOf(p: Pull, player: PlayerStats): number | null {
  if (!p.success) return null;
  return storedKillParses(p)?.[player.name]?.percent ?? null;
}

const byGuid = (pull: Pull, byName: Record<string, PlayerParse>) =>
  new Map(pull.players.flatMap((pl) => (byName[pl.name] ? [[pl.guid, byName[pl.name]] as const] : [])));

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
  const saved = storedKillParses(pull);
  if (saved) return byGuid(pull, saved);
  const fight = await ownFight(code, pull);
  if (!fight) throw new Error(messagesOf(wclMsg).killMissing);
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
      percent: wholeParse(c.rankPercent),
      bracketPercent: wholeParse(c.bracketPercent),
      rank: c.rank,
      total: c.totalParses,
    });
  }
  saveKillParses(pull, Object.fromEntries(pull.players.flatMap((pl) => (out.has(pl.guid) ? [[pl.name, out.get(pl.guid)!]] : []))));
  return out;
}

/** Busca (e salva) o parse dos kills que ainda não têm; devolve quantos kills ganharam parse. */
export async function fetchMissingKillParses(code: string, pulls: Pull[]): Promise<number> {
  let n = 0;
  for (const p of pulls.filter((p) => p.success && !storedKillParses(p))) {
    try {
      await fetchKillParses(code, p);
      n++;
    } catch {
      /* fight não achado no report: fica para a próxima */
    }
  }
  return n;
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
    out.set(p.guid, { metric: metricFor(p.role), kind: 'history', percent: wholeParse(r.medianPerformance), best: wholeParse(best), kills: r.totalKills });
  });
  return out;
}
