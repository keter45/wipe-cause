// "Ignorar eventos após N mortes": depois de umas 3-4 mortes o wipe já está decidido e o
// resto é cascata. Recorta cada pull no momento da N-ésima morte, usando as linhas do tempo
// que o núcleo manda (hits, stacks, falhas, casts), sem reanalisar o log.

import type { Death, MechanicResult, PlayerStats, Pull, PullTrigger } from '../types';

export const DEFAULT_DEATH_CUTOFF = 4;
const KEY = 'wipe-cause:death-cutoff';

export function savedDeathCutoff(): number {
  try {
    const v = localStorage.getItem(KEY);
    return v == null ? DEFAULT_DEATH_CUTOFF : Math.max(0, Number(v) || 0);
  } catch {
    return DEFAULT_DEATH_CUTOFF;
  }
}

export function saveDeathCutoff(n: number) {
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    /* sem storage */
  }
}

/** Momento da N-ésima morte do pull; null = sem corte (N = 0 ou menos de N mortes). */
export function cutoffTime(deaths: Death[], n: number): number | null {
  if (n <= 0) return null;
  const ts = deaths.map((d) => d.t).sort((a, b) => a - b);
  return ts.length >= n ? ts[n - 1] : null;
}

const PER_HIT = new Set(['avoidable_damage', 'tank_range', 'positioning']);
const COLLECTIVE = new Set(['soak', 'tank_soak', 'interrupt', 'enrage', 'hp_balance']);

function render(template: string, player: string, count: number, lethal: number | null): string {
  return template
    .replaceAll('{player}', player.split('-')[0])
    .replaceAll('{count}', String(count))
    .replaceAll('{stacks}', String(count))
    .replaceAll('{lethal_stacks}', lethal != null ? String(lethal) : '');
}

function cutMechanic(m: MechanicResult, cut: number): MechanicResult {
  const upTo = <T,>(xs: T[], t: (x: T) => number) => xs.filter((x) => t(x) <= cut);
  const players = m.players.flatMap((p) => {
    if (!p.timeline) return [p]; // relatório sem linha do tempo: mantém
    const tl = upTo(p.timeline, (e) => e[0]);
    if (!tl.length) return [];
    const isStack = m.kind === 'stack_limit' && !p.credit;
    const count = isStack ? Math.max(...tl.map((e) => e[1])) : tl.reduce((n, e) => n + e[1], 0);
    if (!p.credit) {
      if (isStack && count < (m.warnStacks ?? m.lethalStacks ?? Infinity)) return [];
      if (PER_HIT.has(m.kind) && count <= m.tolerance) return [];
    }
    return [
      {
        ...p,
        count,
        amount: tl.reduce((n, e) => n + e[2], 0),
        firstT: tl[0][0],
        timeline: tl,
        message: p.credit ? '' : render(m.messageTemplate, p.name, count, m.lethalStacks),
      },
    ];
  });
  const blamed = players.filter((p) => !p.credit);
  const failures = COLLECTIVE.has(m.kind)
    ? m.failTimes
      ? upTo(m.failTimes, (t) => t).length
      : m.failures
    : m.kind === 'stack_limit'
      ? blamed.length
      : blamed.reduce((n, p) => n + Math.max(0, p.count - m.tolerance), 0);
  return {
    ...m,
    players,
    failures,
    summary: COLLECTIVE.has(m.kind) ? render(m.messageTemplate, '', failures, m.lethalStacks) : '',
    events: upTo(m.events, (e) => e.t),
  };
}

/** Mesma regra do núcleo: a mais cedo entre as mecânicas com 2+ mortes; senão a causa da 1ª. */
export function pullTrigger(deaths: Death[]): PullTrigger | null {
  const groups: PullTrigger[] = [];
  for (const d of deaths) {
    if (!d.causedBy) continue;
    const t = d.causedBy.failT ?? d.t;
    const g = groups.find((x) => x.key === d.causedBy!.key);
    if (g) {
      g.deaths++;
      g.t = Math.min(g.t, t);
    } else groups.push({ key: d.causedBy.key, name: d.causedBy.name, t, deaths: 1 });
  }
  const multi = groups.filter((g) => g.deaths >= 2).sort((a, b) => a.t - b.t)[0];
  if (multi) return multi;
  const first = [...deaths].sort((a, b) => a.t - b.t)[0];
  return (first?.causedBy && groups.find((g) => g.key === first.causedBy!.key)) || null;
}

/** Pull recortado na N-ésima morte. As mortes continuam todas (a UI esmaece as ignoradas). */
export function applyCutoff(p: Pull, n: number): Pull {
  const cut = cutoffTime(p.deaths, n);
  if (cut == null) return { ...p, cutoffT: null };
  const kept = p.deaths.filter((d) => d.t <= cut);
  const players: PlayerStats[] = p.players.map((ps) => {
    const log = ps.interruptLog.filter((u) => u.t <= cut);
    return { ...ps, interruptLog: log, interrupts: log.filter((u) => u.targetSpellId != null).length, interruptAttempts: log.length };
  });
  return {
    ...p,
    cutoffT: cut,
    players,
    // falhas primeiro, como no núcleo
    mechanics: p.mechanics.map((m) => cutMechanic(m, cut)).sort((a, b) => Number(a.failures === 0) - Number(b.failures === 0)),
    enemySpells: p.enemySpells.map((e) => ({
      ...e,
      casts: e.castTimes ? e.castTimes.filter((t) => t <= cut).length : e.casts,
      interrupted: e.interruptTimes ? e.interruptTimes.filter((t) => t <= cut).length : e.interrupted,
    })),
    trigger: pullTrigger(kept),
  };
}
