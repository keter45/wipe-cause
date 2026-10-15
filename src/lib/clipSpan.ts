// Trecho do replay que vira clipe: o padrão (em volta do erro) e o escolhido pelo usuário. Fica fora
// do replayClip.tsx porque o ReplayView também usa (e o replayClip importa o ReplayView).

import type { ReplayRef } from '../types';

/** O maior trecho (ms) do clipe automático. */
const MAX_SPAN_MS = 12_000;
/** O maior trecho (ms) que o usuário pode escolher (o tamanho do WebP cresce com ele). */
export const MAX_CUSTOM_SPAN_MS = 30_000;
/** O menor trecho (ms). */
export const MIN_SPAN_MS = 1_000;
/** Trecho em volta do erro: tanto antes e tanto depois (clipe de um momento só). */
const BEFORE_MS = 7_000;
const AFTER_MS = 3_000;
/** No resumo da try, cada momento é mais curto. */
const RECAP_BEFORE_MS = 5_000;
const RECAP_AFTER_MS = 2_500;

/** O trecho do clipe dentro do replay: em volta do erro, no máximo 12 s (no resumo, mais curto). */
export function clipSpan(r: ReplayRef, t: number, recap = false): [number, number] {
  let from = Math.max(r.from, t - (recap ? RECAP_BEFORE_MS : BEFORE_MS));
  let to = Math.min(r.to, t + (recap ? RECAP_AFTER_MS : AFTER_MS));
  if (to - from > MAX_SPAN_MS) from = to - MAX_SPAN_MS;
  if (to <= from) to = Math.min(r.to, from + 1000);
  return [from, to];
}

/**
 * Trecho escolhido pelo usuário, dentro do replay (`bounds`), com pelo menos 1 s e no máximo 30 s.
 * `moved` diz qual ponta o usuário mexeu: a outra é que se ajusta.
 */
export function fitClipRange([from, to]: [number, number], [lo, hi]: [number, number], moved: 'from' | 'to'): [number, number] {
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  from = clamp(from);
  to = clamp(to);
  if (moved === 'from') {
    if (to - from < MIN_SPAN_MS) to = clamp(from + MIN_SPAN_MS);
    if (to - from > MAX_CUSTOM_SPAN_MS) to = from + MAX_CUSTOM_SPAN_MS;
    if (to - from < MIN_SPAN_MS) from = clamp(to - MIN_SPAN_MS);
  } else {
    if (to - from < MIN_SPAN_MS) from = clamp(to - MIN_SPAN_MS);
    if (to - from > MAX_CUSTOM_SPAN_MS) from = to - MAX_CUSTOM_SPAN_MS;
    if (to - from < MIN_SPAN_MS) to = clamp(from + MIN_SPAN_MS);
  }
  return [from, to];
}

/** "1:23.4" (ou "83.4", em segundos) em ms; null se não der para ler. */
export function parseClock(text: string): number | null {
  const s = text.trim().replace(',', '.');
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const sec = Number(m[2]);
  if (m[1] != null && sec >= 60) return null;
  return Math.round(((m[1] ? Number(m[1]) * 60 : 0) + sec) * 1000);
}

/** ms em "1:23.4". */
export function clockText(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
