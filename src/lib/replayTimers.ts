// Contagens do replay: quanto falta para um aviso disparar (soak, explosão, debuff de quem carrega
// algo, os orbs que sobraram no chão) e o próximo cast de um inimigo. Como é replay, o futuro está no log.

import type { BossCast, OrbTracks, UnitAuraView } from '../types';

/** Contagem de um aviso: quanto falta (ms) e que parte do aviso ainda falta (1 = começou agora, 0 = disparou). */
export interface Countdown {
  leftMs: number;
  left: number;
}

/** Aviso que começou em `from` e dispara em `at`; null fora dele. */
export function countdown(from: number, at: number, now: number): Countdown | null {
  if (now < from || now >= at) return null;
  return { leftMs: at - now, left: (at - now) / Math.max(1, at - from) };
}

/**
 * Orb no chão que um cast do boss vai explodir (sobrou até o Toxic Deluge): a contagem desde a explosão
 * anterior (ou desde que caiu) até a dele. null se ele sai do chão de outro jeito (pego, quebrado no
 * frontal, ou no fim da fase, que depende do dano da raide e não tem hora marcada).
 */
export function orbClearCountdown(orbs: Pick<OrbTracks, 'clears'>, from: number, to: number, now: number): Countdown | null {
  const clears = orbs.clears ?? [];
  if (!clears.includes(to)) return null;
  const before = clears.filter((c) => c < to).pop() ?? 0;
  return countdown(Math.max(from, before), to, now);
}

/** Antes do cast, o frontal aparece tracejado por isto (ms), com o nome e os segundos dentro. */
export const NEXT_CONE_MS = 10_000;
/** Próximo cast de um add (ícone e segundos embaixo dele): até isto (ms) à frente. */
export const NEXT_ADD_MS = 10_000;
/** Próximos casts no quadro do boss: até isto (ms) à frente. */
export const UPCOMING_MS = 20_000;

/** Próximo cast de `guid` que ainda não começou, até `horizonMs` à frente (`cones`: só frontais). Casts em ordem. */
export function nextCast(casts: BossCast[], guid: string, now: number, horizonMs: number, cones = false): BossCast | null {
  return casts.find((c) => c.guid === guid && c.t > now && c.t - now <= horizonMs && (!cones || c.cone)) ?? null;
}

/** Aura num inimigo em `t`: as stacks e o que o escudo já absorveu (null fora dela). */
export function unitAuraAt(a: UnitAuraView, t: number): { stacks: number; absorbed: number } | null {
  if (t < a.from || t >= a.to) return null;
  const last = <T extends [number, number]>(pts: T[] | undefined) => {
    let v: T | undefined;
    for (const p of pts ?? []) {
      if (p[0] > t) break;
      v = p;
    }
    return v;
  };
  return { stacks: last(a.stacks)?.[1] ?? 1, absorbed: last(a.absorbed)?.[1] ?? 0 };
}
