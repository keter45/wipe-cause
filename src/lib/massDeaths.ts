// "Wipe geral": muita gente morrendo ao mesmo tempo (explosão, Execution, enrage) é
// consequência do wipe, não erro de cada um — essas mortes não entram na nota do player.

import type { Death } from '../types';

/** Mais de 5 mortes juntas = wipe geral. */
export const MASS_DEATH_MIN = 6;
/** "Ao mesmo tempo": todas dentro desta janela. */
export const MASS_DEATH_WINDOW_MS = 1_500;

export const deathKey = (d: Pick<Death, 'guid' | 't'>) => `${d.guid}:${d.t}`;

/** Chaves (`guid:t`) das mortes que fazem parte de um wipe geral. */
export function massDeathKeys(deaths: Death[], min = MASS_DEATH_MIN, windowMs = MASS_DEATH_WINDOW_MS): Set<string> {
  const sorted = [...deaths].sort((a, b) => a.t - b.t);
  const out = new Set<string>();
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    // janela [t_i, t_i + window]
    if (j < i) j = i;
    while (j + 1 < sorted.length && sorted[j + 1].t - sorted[i].t <= windowMs) j++;
    if (j - i + 1 >= min) for (let k = i; k <= j; k++) out.add(deathKey(sorted[k]));
  }
  return out;
}
