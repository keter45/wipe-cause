// "Ignorar eventos após N mortes": o corte é feito no wipe-core (as estatísticas param de
// contar na N-ésima morte de cada pull). Aqui fica só a preferência do usuário.

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
