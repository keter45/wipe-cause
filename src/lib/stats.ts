// Estatísticas simples, num lugar só: mediana, quantis e média. Antes cada tela tinha a sua
// (mediana "de cima" numa, média dos dois do meio noutra), e o mesmo número mudava de tela para tela.

const sorted = (xs: number[]) => xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);

/** Quantil `q` (0 a 1) com interpolação linear; null com a lista vazia. */
export function quantile(xs: number[], q: number): number | null {
  const v = sorted(xs);
  if (!v.length) return null;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
}

/** Mediana (com lista par, a média dos dois do meio); null com a lista vazia. */
export const median = (xs: number[]) => quantile(xs, 0.5);

/**
 * Quantil pelo posto mais próximo (sem interpolar: sempre um valor da lista), para listas
 * pequenas de tempos e cargas em que o valor tem de existir. A lista não pode ser vazia.
 * É o das referências dos tops (context.ts, decisions.ts) e do modelo da simulação (simProfile.ts),
 * calibrados com ele.
 */
export function nearestRank(xs: number[], q: number): number {
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(q * v.length))];
}

/** Média; null com a lista vazia. */
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Os intervalos [a0, a1] e [b0, b1] se encontram (com `slack` de folga dos dois lados). */
export const overlaps = (a0: number, a1: number, b0: number, b1: number, slack = 0) => a0 <= b1 + slack && b0 <= a1 + slack;
