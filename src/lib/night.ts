// Resumo da noite: causas dos wipes, placar dos players (vilões e mocinhos) e downtime.
// Tudo derivado do LogReport; nenhum dado novo do núcleo.

import type { Pull } from '../types';
import { analyzePull, lowestBossHp } from './verdict';
import { PERSONAL_BLAME } from './blame';
import { scorePull } from './score';

/** Intervalo entre trys acima disso vira "pausa" (break, troca de boss, reset de estratégia). */
export const BREAK_MS = 10 * 60_000;

/** Boss + dificuldade: a unidade dos resumos (causas e placar não se misturam entre bosses). */
export const bossKey = (p: Pull) => `${p.encounterName} · ${p.difficultyName}`;

export interface BossGroup {
  key: string;
  pulls: Pull[];
}

/** Pulls por boss, na ordem em que o boss apareceu na noite. */
export function groupByBoss(pulls: Pull[]): BossGroup[] {
  const m = new Map<string, Pull[]>();
  for (const p of pulls) m.set(bossKey(p), [...(m.get(bossKey(p)) ?? []), p]);
  return [...m.entries()].map(([key, ps]) => ({ key, pulls: ps }));
}

/** Peso de cada erro de mecânica pela severidade da regra. */
const SEVERITY_WEIGHT: Record<string, number> = { wipe: 3, major: 2, minor: 0.5, none: 0 };


export interface Gap {
  after: Pull;
  before: Pull;
  ms: number;
  isBreak: boolean;
}

export interface Cause {
  key: string;
  name: string;
  /** wipes em que foi o gatilho */
  triggers: number;
  /** mortes atribuídas à mecânica */
  deaths: number;
  /** falhas somadas nas regras do boss */
  failures: number;
}

export interface PlayerNight {
  guid: string;
  name: string;
  class: string | null;
  role: string | null;
  pulls: number;
  deaths: number;
  /** mortes entre as decisivas do pull (antes da cascata) */
  decisiveDeaths: number;
  /** erros de mecânica (hits evitáveis, stacks, alcance...) */
  mechanicErrors: number;
  mechanicErrorsWeighted: number;
  /** mortes decisivas sem defensivo tendo um disponível */
  deathsNoDefensive: number;
  interrupts: number;
  /** pulls em que casts interrompíveis passaram e o player, que podia, não cortou nada */
  idleInterruptPulls: number;
  /** ajudas em mecânica (soaks) */
  assists: number;
  /** pulls sem morte decisiva e sem erro de mecânica */
  cleanPulls: number;
  avgDps: number;
  avgHps: number;
  villainScore: number;
  heroScore: number;
  /** nota média (0-100) nos pulls em que jogou */
  avgScore: number;
}

export interface NightSummary {
  pulls: Pull[];
  wipes: number;
  kills: number;
  best: { pull: Pull; hp: number } | null;
  startMs: number;
  endMs: number;
  totalMs: number;
  combatMs: number;
  downtimeMs: number;
  gaps: Gap[];
  /** média/mediana só dos intervalos entre trys (sem as pausas) */
  avgGapMs: number;
  medianGapMs: number;
  longestGap: Gap | null;
  causes: Cause[];
  players: PlayerNight[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarizeNight(allPulls: Pull[]): NightSummary {
  const pulls = [...allPulls].sort((a, b) => a.startMs - b.startMs);
  const end = (p: Pull) => p.startMs + p.durationMs;

  // ---- tempo e downtime
  const gaps: Gap[] = [];
  for (let i = 1; i < pulls.length; i++) {
    const ms = Math.max(0, pulls[i].startMs - end(pulls[i - 1]));
    gaps.push({ after: pulls[i - 1], before: pulls[i], ms, isBreak: ms >= BREAK_MS });
  }
  const tryGaps = gaps.filter((g) => !g.isBreak).map((g) => g.ms);
  const startMs = pulls[0]?.startMs ?? 0;
  const endMs = pulls.length ? Math.max(...pulls.map(end)) : 0;
  const combatMs = pulls.reduce((n, p) => n + p.durationMs, 0);

  // ---- causas
  const causes = new Map<string, Cause>();
  const cause = (key: string, name: string) => {
    if (!causes.has(key)) causes.set(key, { key, name, triggers: 0, deaths: 0, failures: 0 });
    return causes.get(key)!;
  };
  for (const p of pulls) {
    if (p.trigger && !p.success) cause(p.trigger.key, p.trigger.name).triggers++;
    // mortes depois do corte ("ignorar após N mortes") não entram
    for (const d of p.deaths) if (d.causedBy && !d.ignored) cause(d.causedBy.key, d.causedBy.name).deaths++;
    for (const m of p.mechanics) if (m.failures > 0 && m.severity !== 'none') cause(m.key, m.name).failures += m.failures;
  }

  // ---- players
  const acc = new Map<string, PlayerNight & { dpsSum: number; hpsSum: number; scoreSum: number }>();
  for (const p of pulls) {
    const verdict = analyzePull(p);
    const scores = scorePull(p);
    const decisive = new Set(verdict.decisiveDeaths.map((d) => `${d.guid}:${d.t}`));
    const passedInterruptible = p.enemySpells.some((e) => e.interruptible && e.casts > 0);
    const errorsThisPull = new Map<string, number>();

    for (const m of p.mechanics) {
      for (const mp of m.players) {
        const a = get(mp.guid, mp.name);
        if (mp.credit) {
          if (m.kind !== 'interrupt') a.assists += mp.count; // interrupts já contam à parte
          continue;
        }
        if (!PERSONAL_BLAME.has(m.kind)) continue;
        // stack_limit conta como 1 erro (count = stacks)
        const n = m.kind === 'stack_limit' ? 1 : mp.count;
        a.mechanicErrors += n;
        a.mechanicErrorsWeighted += n * (SEVERITY_WEIGHT[m.severity] ?? 0);
        errorsThisPull.set(mp.guid, (errorsThisPull.get(mp.guid) ?? 0) + n);
      }
    }

    for (const ps of p.players) {
      const a = get(ps.guid, ps.name);
      a.class ??= ps.class;
      a.role ??= ps.role;
      a.pulls++;
      a.deaths += ps.deaths;
      a.interrupts += ps.interrupts;
      a.dpsSum += ps.dps;
      a.hpsSum += ps.hps;
      a.scoreSum += scores.get(ps.guid)?.score ?? 100;
      if (passedInterruptible && ps.canInterrupt && ps.interrupts === 0) a.idleInterruptPulls++;
      const hadDecisive = p.deaths.some((d) => d.guid === ps.guid && decisive.has(`${d.guid}:${d.t}`));
      if (!hadDecisive && !errorsThisPull.get(ps.guid)) a.cleanPulls++;
    }

    for (const d of p.deaths) {
      if (!decisive.has(`${d.guid}:${d.t}`)) continue;
      const a = get(d.guid, d.name);
      a.decisiveDeaths++;
      if (d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0) a.deathsNoDefensive++;
    }
  }

  function get(guid: string, name: string) {
    let a = acc.get(guid);
    if (!a) {
      a = {
        guid, name, class: null, role: null, pulls: 0, deaths: 0, decisiveDeaths: 0, mechanicErrors: 0,
        mechanicErrorsWeighted: 0, deathsNoDefensive: 0, interrupts: 0, idleInterruptPulls: 0, assists: 0,
        cleanPulls: 0, avgDps: 0, avgHps: 0, villainScore: 0, heroScore: 0, avgScore: 0, dpsSum: 0, hpsSum: 0, scoreSum: 0,
      };
      acc.set(guid, a);
    }
    return a;
  }

  const players: PlayerNight[] = [...acc.values()]
    .filter((a) => a.pulls > 0)
    .map(({ dpsSum, hpsSum, scoreSum, ...a }) => {
      const out: PlayerNight = { ...a, avgDps: dpsSum / a.pulls, avgHps: hpsSum / a.pulls, avgScore: scoreSum / a.pulls };
      out.villainScore = 3 * a.decisiveDeaths + a.mechanicErrorsWeighted + a.deathsNoDefensive + 0.5 * a.idleInterruptPulls;
      // pulls limpos decidem; interrupts e ajudas só desempatam
      out.heroScore = a.cleanPulls / a.pulls + (a.interrupts + a.assists) / 1e6;
      return out;
    });

  const wipes = pulls.filter((p) => !p.success);
  const best = wipes
    .map((p) => ({ pull: p, hp: lowestBossHp(p) ?? 100 }))
    .reduce<{ pull: Pull; hp: number } | null>((b, x) => (!b || x.hp < b.hp ? x : b), null);

  return {
    pulls,
    wipes: wipes.length,
    kills: pulls.length - wipes.length,
    best,
    startMs,
    endMs,
    totalMs: endMs - startMs,
    combatMs,
    downtimeMs: gaps.reduce((n, g) => n + g.ms, 0),
    gaps,
    avgGapMs: tryGaps.length ? tryGaps.reduce((a, b) => a + b, 0) / tryGaps.length : 0,
    medianGapMs: median(tryGaps),
    longestGap: gaps.reduce<Gap | null>((b, g) => (!b || g.ms > b.ms ? g : b), null),
    causes: [...causes.values()].sort((a, b) => b.triggers - a.triggers || b.deaths - a.deaths || b.failures - a.failures),
    players,
  };
}

export const topBy = <T,>(xs: T[], score: (x: T) => number, n = 3) =>
  [...xs].filter((x) => score(x) > 0).sort((a, b) => score(b) - score(a)).slice(0, n);
