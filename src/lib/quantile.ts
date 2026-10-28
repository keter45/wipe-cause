/** Quantil `q` (0 a 1) com interpolação linear; null com a lista vazia. */
export function quantile(xs: number[], q: number): number | null {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
}
