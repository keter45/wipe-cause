// "Ignorar eventos após N mortes": o corte é feito no wipe-core (as estatísticas param de
// contar na N-ésima morte de cada pull). Aqui fica só a preferência do usuário.

import { KEYS, ls } from './storage';

export const DEFAULT_DEATH_CUTOFF = 4;
export function savedDeathCutoff(): number {
  const v = ls.get(KEYS.deathCutoff);
  return v == null ? DEFAULT_DEATH_CUTOFF : Math.max(0, Number(v) || 0);
}

export const saveDeathCutoff = (n: number) => ls.set(KEYS.deathCutoff, String(n));
