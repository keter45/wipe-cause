// Noites da guilda no Warcraft Logs: os reports da guilda (de quem subiu log) agrupados por
// noite. Vários reports da mesma noite viram uma análise só (`wcl:A,B`); o núcleo fica com
// uma cópia de cada pull, vinda do report mais completo.

import { invoke } from '@tauri-apps/api/core';
import { WCL_SOURCE } from './api';
import type { Pull } from '../types';
import { WCL_DIFFICULTY } from './wcl';
import type { WclGuild, WclUser } from './wclApi';

export interface GuildFight {
  id: number;
  encounterID: number;
  name: string;
  difficulty: number;
  kill: boolean;
  startTime: number;
  endTime: number;
}

export interface GuildReport {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  owner: string;
  zone: string | null;
  fights: GuildFight[];
}

export interface NightBoss {
  encounterId: number;
  name: string;
  /** dificuldade do WCL (3 normal, 4 heroico, 5 mítico) */
  difficulty: number;
  pulls: number;
  kills: number;
}

export interface GuildNight {
  /** reports da noite, o mais completo primeiro */
  reports: GuildReport[];
  startTime: number;
  endTime: number;
  bosses: NightBoss[];
  /** algum report recebeu eventos há pouco (log ao vivo) */
  live: boolean;
  /** caminho da análise: `wcl:A,B` */
  path: string;
}

/** Dificuldade do WCL para Mítica+. */
const MYTHIC_PLUS = 10;
/** Reports que se sobrepõem (com folga) são da mesma noite. */
const NIGHT_GAP_MS = 45 * 60_000;
/** Mesmo pull em dois reports: começam com poucos segundos de diferença. */
const SAME_PULL_MS = 20_000;
/** Report com evento há menos que isso = raid acontecendo agora. */
export const LIVE_MS = 15 * 60_000;

/** Pulls únicos (boss + dificuldade + horário), do report mais completo primeiro. */
export function uniquePulls(reports: GuildReport[]): { encounterId: number; name: string; difficulty: number; kill: boolean; start: number; durationMs: number }[] {
  const out: { encounterId: number; name: string; difficulty: number; kill: boolean; start: number; durationMs: number }[] = [];
  for (const r of reports) {
    for (const f of r.fights) {
      const start = r.startTime + f.startTime;
      if (out.some((p) => p.encounterId === f.encounterID && p.difficulty === f.difficulty && Math.abs(p.start - start) < SAME_PULL_MS)) continue;
      out.push({ encounterId: f.encounterID, name: f.name, difficulty: f.difficulty, kill: f.kill, start, durationMs: f.endTime - f.startTime });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function groupNights(reports: GuildReport[], now = Date.now()): GuildNight[] {
  // o app é para raid: fights de M+ (dificuldade 10 no WCL) ficam de fora
  const raidOnly = reports.map((r) => ({ ...r, fights: r.fights.filter((f) => f.difficulty !== MYTHIC_PLUS) }));
  const withBosses = raidOnly.filter((r) => r.fights.length > 0).sort((a, b) => a.startTime - b.startTime);
  const groups: GuildReport[][] = [];
  for (const r of withBosses) {
    const g = groups[groups.length - 1];
    const end = g ? Math.max(...g.map((x) => x.endTime)) : 0;
    if (g && r.startTime <= end + NIGHT_GAP_MS) g.push(r);
    else groups.push([r]);
  }
  return groups
    .map((g) => {
      const sorted = [...g].sort((a, b) => b.fights.length - a.fights.length || a.code.localeCompare(b.code));
      const bosses: NightBoss[] = [];
      for (const p of uniquePulls(sorted)) {
        let b = bosses.find((x) => x.encounterId === p.encounterId && x.difficulty === p.difficulty);
        if (!b) bosses.push((b = { encounterId: p.encounterId, name: p.name, difficulty: p.difficulty, pulls: 0, kills: 0 }));
        b.pulls++;
        if (p.kill) b.kills++;
      }
      const endTime = Math.max(...g.map((r) => r.endTime));
      return {
        reports: sorted,
        startTime: Math.min(...g.map((r) => r.startTime)),
        endTime,
        bosses,
        live: now - endTime < LIVE_MS,
        path: WCL_SOURCE + sorted.map((r) => r.code).join(','),
      };
    })
    .reverse();
}

const REPORTS_QUERY = `query GuildReports($guild: Int!, $start: Float!) {
  reportData { reports(guildID: $guild, startTime: $start, limit: 50) {
    data { code title startTime endTime owner { name } zone { name }
      fights(killType: Encounters) { id encounterID name difficulty kill startTime endTime } }
  } }
}`;

/** Reports da guilda dos últimos `days` dias (com o login, inclui os não listados). */
export async function fetchGuildReports(guild: WclGuild, days = 30): Promise<GuildReport[]> {
  const start = Date.now() - days * 86_400_000;
  const d = await invoke<any>('wcl_query', { query: REPORTS_QUERY, variables: { guild: guild.id, start }, cacheKey: null });
  return (d?.reportData?.reports?.data ?? []).map(toReport);
}

const GUILD_KEY = 'wipe-cause:wcl-guild';
/** Guilda escolhida (quem está em mais de uma). */
export function savedGuildId(): number | null {
  try {
    return Number(localStorage.getItem(GUILD_KEY)) || null;
  } catch {
    return null;
  }
}
export function saveGuildId(id: number) {
  try {
    localStorage.setItem(GUILD_KEY, String(id));
  } catch {
    /* sem storage */
  }
}

// ---------------------------------------------------------------- o report de uma noite do log local

/** Pull do log e fight do report são o mesmo: mesmo boss e dificuldade, começo a até isto. */
const MATCH_MS = 120_000;
/** Busca reports desde algumas horas antes do primeiro pull até algumas depois do último. */
const AROUND_MS = 3 * 3_600_000;

/** Pulls de raide do log local que o report tem (mesmo boss, dificuldade e horário). */
export function matchedPulls(report: GuildReport, pulls: Pull[]): number {
  let n = 0;
  for (const p of pulls) {
    if (p.dungeon) continue;
    const diff = WCL_DIFFICULTY[p.difficultyId];
    if (report.fights.some((f) => f.encounterID === p.encounterId && (!diff || f.difficulty === diff) && Math.abs(report.startTime + f.startTime - p.startMs) <= MATCH_MS)) n++;
  }
  return n;
}

/**
 * O report do Warcraft Logs desta noite: o que tem mais pulls do log local (com pelo menos 2, ou o
 * único pull de raide do log). null = nenhum report bate.
 */
export function pickNightReport(reports: GuildReport[], pulls: Pull[]): { report: GuildReport; matched: number } | null {
  const raid = pulls.filter((p) => !p.dungeon).length;
  if (!raid) return null;
  let best: { report: GuildReport; matched: number } | null = null;
  for (const r of reports) {
    const matched = matchedPulls(r, pulls);
    if (!best || matched > best.matched || (matched === best.matched && r.fights.length > best.report.fights.length)) best = { report: r, matched };
  }
  return best && best.matched >= Math.min(2, raid) ? best : null;
}

const AROUND_QUERY = `query Around($guild: Int, $user: Int, $start: Float!, $end: Float!) {
  reportData { reports(guildID: $guild, userID: $user, startTime: $start, endTime: $end, limit: 25) {
    data { code title startTime endTime owner { name } zone { name }
      fights(killType: Encounters) { id encounterID name difficulty kill startTime endTime } }
  } }
}`;

/**
 * Procura o report desta noite no Warcraft Logs: os das guildas do login e os que o próprio
 * usuário subiu, perto do horário dos pulls, e fica com o que casa com mais deles.
 */
export async function findNightReport(pulls: Pull[], user: WclUser | null): Promise<{ report: GuildReport; matched: number } | null> {
  const raid = pulls.filter((p) => !p.dungeon);
  if (!raid.length) return null;
  const start = Math.min(...raid.map((p) => p.startMs)) - AROUND_MS;
  const end = Math.max(...raid.map((p) => p.startMs)) + AROUND_MS;
  const asks: Record<string, number | null>[] = [...(user?.guilds ?? []).map((g) => ({ guild: g.id, user: null })), ...(user ? [{ guild: null, user: user.id }] : [])];
  const seen = new Map<string, GuildReport>();
  for (const ask of asks) {
    const d = await invoke<any>('wcl_query', { query: AROUND_QUERY, variables: { ...ask, start, end }, cacheKey: null }).catch(() => null);
    for (const r of d?.reportData?.reports?.data ?? []) seen.set(String(r.code), toReport(r));
  }
  return pickNightReport([...seen.values()], pulls);
}

function toReport(r: any): GuildReport {
  return {
    code: String(r.code),
    title: String(r.title ?? ''),
    startTime: Number(r.startTime),
    endTime: Number(r.endTime),
    owner: String(r.owner?.name ?? ''),
    zone: r.zone?.name ?? null,
    fights: (r.fights ?? []).map((f: any) => ({
      id: Number(f.id),
      encounterID: Number(f.encounterID),
      name: String(f.name),
      difficulty: Number(f.difficulty),
      kill: !!f.kill,
      startTime: Number(f.startTime),
      endTime: Number(f.endTime),
    })),
  };
}
