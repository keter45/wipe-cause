// Medidas de um pull usadas na comparação com os tops do mesmo boss. O mesmo código roda no app (o
// pull do player) e no script que resume os tops (scripts/rotation/bench.mjs), para os dois lados
// serem medidos igual. Só funções puras e imports de tipo: o script carrega este arquivo direto no
// Node (--experimental-strip-types).

import type { PlayerStats, Pull, RotationResult } from '../types';

/** Janela depois de uma mecânica do boss em que se mede o tempo parado. */
export const ANCHOR_WINDOW_MS = 8000;
/** Defensivo "na mecânica": de um pouco antes do cast do boss até logo depois. */
export const DEF_BEFORE_MS = 2000;
export const DEF_AFTER_MS = 4000;
/** Cooldown usado "no pull". */
export const EARLY_MS = 15000;
/** Habilidade do inimigo castada mais vezes que isso no pull é de add (spam), não mecânica. */
export const MAX_ANCHOR_CASTS = 15;

/** Soma dos trechos parados dentro de [a, b). */
export function idleIn(idle: [number, number][] | undefined, a: number, b: number): number {
  let ms = 0;
  for (const [x, y] of idle ?? []) ms += Math.max(0, Math.min(y, b) - Math.max(x, a));
  return ms;
}

const ids = (list: { spellId: number }[]) => new Set(list.map((p) => p.spellId));

/** Casts das habilidades da rotação (as das prioridades), por habilidade. */
export function rotationCasts(p: PlayerStats, r: RotationResult) {
  const mine = new Set([...ids(r.prioritySt), ...ids(r.priorityAoe)]);
  return (p.casts ?? []).filter((c) => mine.has(c.spellId));
}

/** Casts da rotação por minuto de tempo ativo. */
export function cpm(p: PlayerStats, r: RotationResult): number {
  const n = rotationCasts(p, r).reduce((s, c) => s + c.times.length, 0);
  return r.activeMs > 0 ? n / (r.activeMs / 60000) : 0;
}

/**
 * Fatia de cada habilidade nos casts da rotação: mostra AoE x alvo único sem precisar dizer quais são
 * de AoE (o Divine Storm do Retribution está nas duas prioridades).
 */
export function castMix(p: PlayerStats, r: RotationResult): Map<number, { name: string; share: number }> {
  const casts = rotationCasts(p, r);
  const total = casts.reduce((s, c) => s + c.times.length, 0);
  const out = new Map<number, { name: string; share: number }>();
  if (!total) return out;
  for (const c of casts) {
    const prev = out.get(c.spellId);
    out.set(c.spellId, { name: c.name, share: (prev?.share ?? 0) + c.times.length / total });
  }
  return out;
}

export const downtimePct = (r: RotationResult) => (r.activeMs > 0 ? r.downtimeMs / r.activeMs : 0);

/** Primeiro cast de uma habilidade (ms do pull) ou null. */
export function firstUse(p: PlayerStats, spellId: number): number | null {
  const ts = (p.casts ?? []).filter((c) => c.spellId === spellId).flatMap((c) => c.times);
  return ts.length ? Math.min(...ts) : null;
}

/** Casts do boss que servem de marco: cada habilidade de inimigo com 1 a MAX_ANCHOR_CASTS casts. */
export function anchorTimes(pull: Pull): Map<number, { name: string; times: number[] }> {
  const out = new Map<number, { name: string; times: number[] }>();
  for (const e of pull.enemySpells) {
    const ts = [...(e.castTimes ?? [])].sort((a, b) => a - b);
    if (ts.length && ts.length <= MAX_ANCHOR_CASTS) out.set(e.spellId, { name: e.name, times: ts });
  }
  return out;
}

/** Defensivos pessoais do player perto de um momento (de DEF_BEFORE_MS antes a DEF_AFTER_MS depois). */
export function defensivesNear(p: PlayerStats, t: number) {
  return p.defensivesUsed.filter((d) => (d.source == null || d.source === p.guid) && d.t >= t - DEF_BEFORE_MS && d.t <= t + DEF_AFTER_MS);
}

/** Habilidades da rotação castadas em [a, b). */
export function castsIn(p: PlayerStats, r: RotationResult, a: number, b: number) {
  return rotationCasts(p, r)
    .map((c) => ({ spellId: c.spellId, name: c.name, n: c.times.filter((t) => t >= a && t < b).length }))
    .filter((c) => c.n > 0);
}

/** Momentos das poções de combate, pelo critério passado (o do app fica em performance.ts). */
export const potionTimes = (p: PlayerStats, isPotion: (name: string) => boolean) =>
  (p.casts ?? [])
    .filter((c) => isPotion(c.name))
    .flatMap((c) => c.times)
    .sort((a, b) => a - b);
