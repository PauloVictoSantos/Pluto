// Estatistica robusta (doc. "Modelos de despesas"): gastos tem cauda longa, entao mediana, MAD e
// quantis no lugar de media e desvio padrao sempre que a decisao depender deles.

const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);

export const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

/** Desvio padrao populacional. */
export function stdDev(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Coeficiente de variacao (sigma/mu); Infinity com media zero. */
export const cv = (xs: readonly number[]) => {
  const m = Math.abs(mean(xs));
  return m === 0 ? Infinity : stdDev(xs) / m;
};

/** Quantil com interpolacao linear (tipo 7, o mesmo do R e do Excel). */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN;
  const s = sorted(xs), pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export const median = (xs: readonly number[]) => quantile(xs, 0.5);

/** Desvio absoluto mediano (sem o fator 1,4826). */
export function mad(xs: readonly number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Gerador pseudoaleatorio com semente (mulberry32): Monte Carlo reproduzivel nos testes. */
export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
