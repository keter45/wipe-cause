// Mortes na progressão: quais mortes viraram wipe e os melhores pulls de cada noite (usados nos
// destaques da prog, em trends.ts). Cálculo puro; o card está em ProgDeathCards.

import type { Death, Pull, Role } from '../types';
import { WIPE_KILLING_BLOWS, wipeDeaths } from './deathSeverity';
import { pullProgress } from './phases';

/** Só as primeiras mortes de cada pull entram. */
export const EARLY_DEATHS = 3;
/** Fração das melhores tentativas de cada noite. */
export const BEST_FRACTION = 0.2;
/** Mínimo de pulls entre os melhores para o player entrar no destaque dos melhores pulls. */
export const MIN_BEST_PLAYED = 10;
/** Mínimo de pulls no intervalo para entrar no card das mortes que viraram wipe. */
export const MIN_PULLS = 50;
/** A morte virou wipe se o pull acabou até este tempo depois dela. */
export const DECISIVE_MS = 25_000;
export const DECISIVE_TOP = 8;

export interface DecisiveCause {
  spellId: number | null;
  /** null = golpe sem nome (a tela escreve "Desconhecida") */
  name: string | null;
  count: number;
}

export interface DecisiveRow {
  guid: string;
  name: string;
  class: string | null;
  role: Role | null;
  pulls: number;
  decisive: number;
  rate: number;
  /** "1 a cada N pulls" */
  every: number;
  cause: DecisiveCause | null;
}

export interface ProgDeaths {
  decisive: DecisiveRow[];
  totalPulls: number;
}

/**
 * Mortes que contam: primeiro sai o que não conta (depois da call de wipe, wipe de mecânica e golpe
 * que sempre é wipe), depois ficam as 3 primeiras do pull.
 */
export function countedEarlyDeaths(p: Pull): Death[] {
  const wipe = wipeDeaths(p.deaths);
  const blows = WIPE_KILLING_BLOWS[p.encounterId] ?? [];
  return [...p.deaths]
    .sort((a, b) => a.t - b.t)
    .filter((d) => {
      if (d.ignored || wipe.has(d)) return false;
      const blow = d.killingBlow?.spellName.toLowerCase();
      return !(blow && blows.includes(blow));
    })
    .slice(0, EARLY_DEATHS);
}

/** Os 20% pulls que chegaram mais longe na noite (pelo menos 1). */
export function bestPulls(night: Pull[], phases: number): Pull[] {
  if (night.length === 0) return [];
  const n = Math.max(1, Math.ceil(night.length * BEST_FRACTION));
  return night
    .map((p, i) => ({ p, i, v: pullProgress(p, phases) }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, n)
    .map((x) => x.p);
}

const isUnknown = (name: string | undefined) => !name || name.trim() === '' || name.trim().toLowerCase() === 'unknown';

interface Acc {
  guid: string;
  name: string;
  class: string | null;
  role: Role | null;
  pulls: number;
  decisive: number;
  causes: Map<string, DecisiveCause>;
}

export function computeProgDeaths(nights: Pull[][]): ProgDeaths {
  const all = nights.flat();
  const accs = new Map<string, Acc>();
  const get = (guid: string, name: string, cls: string | null, role: Role | null): Acc => {
    let a = accs.get(guid);
    if (!a) accs.set(guid, (a = { guid, name, class: cls, role, pulls: 0, decisive: 0, causes: new Map() }));
    a.class ||= cls;
    a.role ??= role;
    return a;
  };

  for (const p of all) {
    for (const x of p.players) get(x.guid, x.name, x.class, x.role).pulls++;
    for (const d of countedEarlyDeaths(p)) {
      const a = get(d.guid, d.name, d.class, d.role);
      // morte decisiva: o pull acabou (wipe) até 25s depois dela
      if (!p.success && p.durationMs - d.t <= DECISIVE_MS) {
        a.decisive++;
        const blow = d.killingBlow;
        const unknown = !blow || isUnknown(blow.spellName);
        const key = unknown ? '' : blow.spellName.toLowerCase();
        const c = a.causes.get(key) ?? { spellId: unknown ? null : blow.spellId, name: unknown ? null : blow.spellName, count: 0 };
        c.count++;
        a.causes.set(key, c);
      }
    }
  }

  const decisive: DecisiveRow[] = [];
  for (const a of accs.values()) {
    if (a.pulls < MIN_PULLS || a.decisive === 0) continue;
    const rate = a.decisive / a.pulls;
    const cause = [...a.causes.values()].sort((x, y) => y.count - x.count || (x.name ?? '').localeCompare(y.name ?? ''))[0] ?? null;
    decisive.push({ guid: a.guid, name: a.name, class: a.class, role: a.role, pulls: a.pulls, decisive: a.decisive, rate, every: Math.max(1, Math.round(1 / rate)), cause });
  }
  decisive.sort((x, y) => y.rate - x.rate || y.decisive - x.decisive || x.name.localeCompare(y.name));
  return { decisive: decisive.slice(0, DECISIVE_TOP), totalPulls: all.length };
}
