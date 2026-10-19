import { mad, mean, median } from './stats';

// Padroes de gasto (doc. "Modelos de despesas"). Funcoes puras.

// ---------------------------------------------------------------------------------------------
// Testes estatisticos

/** P(X >= k) para X ~ Poisson(lambda), somando a cauda em escala logaritmica. */
export function poissonUpper(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  // 1 - P(X <= k-1)
  let term = Math.exp(-lambda), cdf = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

/** Benjamini-Hochberg: quais hipoteses sao significativas controlando a taxa de falsas descobertas em q. */
export function benjaminiHochberg(p: readonly number[], q = 0.05): boolean[] {
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  let cut = -1;
  order.forEach(([v], rank) => {
    if (v <= ((rank + 1) / p.length) * q) cut = rank;
  });
  const out = Array<boolean>(p.length).fill(false);
  for (let r = 0; r <= cut; r++) out[order[r]![1]] = true;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Quando voce gasta: mapa dia x faixa horaria

export const BANDS = 6;
/** Faixas de 4 horas: 0 = 0h-4h ... 5 = 20h-24h. */
export const bandOf = (hour: number) => Math.min(BANDS - 1, Math.floor(hour / 4));

export interface SpendEvent {
  dow: number;
  band: number;
  amount: number;
}

export interface Cell {
  dow: number;
  band: number;
  count: number;
  /** Compras por semana na celula. */
  rate: number;
  ticket: number;
  /** Gasto esperado por semana = taxa x ticket mediano. */
  expected: number;
  pValue: number;
  /** Taxa significativamente maior que a media das celulas (Poisson + BH). */
  peak: boolean;
}

/**
 * 42 celulas com taxa N/W, ticket mediano e gasto esperado. Uma celula so e "pico" se a contagem for
 * improvavel sob a taxa media (Poisson, p < 0,05 depois de Benjamini-Hochberg nas 42 celulas).
 */
export function heatmap(events: readonly SpendEvent[], weeks: number): Cell[] {
  const cells: { dow: number; band: number; amounts: number[] }[] = [];
  for (let dow = 0; dow < 7; dow++) for (let band = 0; band < BANDS; band++) cells.push({ dow, band, amounts: [] });
  for (const e of events) cells[e.dow * BANDS + e.band]!.amounts.push(e.amount);
  const mu = events.length / cells.length;
  const p = cells.map((c) => poissonUpper(c.amounts.length, mu));
  const sig = benjaminiHochberg(p);
  return cells.map((c, i) => {
    const ticket = c.amounts.length ? median(c.amounts) : 0, rate = weeks > 0 ? c.amounts.length / weeks : 0;
    return { dow: c.dow, band: c.band, count: c.amounts.length, rate, ticket, expected: rate * ticket, pValue: p[i]!, peak: sig[i]! && c.amounts.length > mu };
  });
}

// ---------------------------------------------------------------------------------------------
// Anomalias e mudanca de patamar

/**
 * z-score modificado (Iglewicz-Hoaglin): M = 0,6745 (x - mediana) / MAD. Com MAD zero (metade dos
 * valores iguais), usa o desvio absoluto medio x 1,2533. null com menos de 8 valores de referencia.
 */
export function modifiedZ(x: number, reference: readonly number[]): number | null {
  if (reference.length < 8) return null;
  const med = median(reference);
  const m = mad(reference);
  if (m > 0) return (0.6745 * (x - med)) / m;
  const meanAD = mean(reference.map((v) => Math.abs(v - med)));
  return meanAD > 0 ? (x - med) / (1.253314 * meanAD) : x === med ? 0 : Infinity;
}
export const isAnomaly = (z: number | null) => z !== null && Math.abs(z) > 3.5;

export interface Shift {
  /** Semanas desde o inicio da subida (0 = esta semana). */
  weeksAgo: number;
  baseline: number;
  recent: number;
}

/**
 * CUSUM superior sobre totais semanais: referencia = semanas antes das ultimas `watch`; sigma robusto
 * = 1,4826 MAD, k = 0,5 sigma, h = 5 sigma. Retorna a mudanca de patamar mais recente, ou null.
 */
export function cusumShift(weekly: readonly number[], watch = 8): Shift | null {
  if (weekly.length < watch + 8) return null;
  const ref = weekly.slice(0, weekly.length - watch), recent = weekly.slice(-watch);
  const base = median(ref), sigma = 1.4826 * mad(ref) || 0.1 * Math.abs(base) || 1;
  const k = 0.5 * sigma, h = 5 * sigma;
  let s = 0, start = -1;
  for (let t = 0; t < recent.length; t++) {
    const prev = s;
    s = Math.max(0, s + recent[t]! - base - k);
    if (prev === 0 && s > 0) start = t;
    if (s === 0) start = -1;
    if (s > h && start >= 0) {
      const since = recent.slice(start);
      return { weeksAgo: recent.length - 1 - start, baseline: base, recent: median(since) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Categorizacao aprendida: Naive Bayes multinomial

export interface NBModel {
  classes: Map<string, { docs: number; words: number; counts: Map<string, number> }>;
  vocab: Set<string>;
  docs: number;
}

export function trainNB(examples: readonly { tokens: readonly string[]; label: string }[]): NBModel {
  const model: NBModel = { classes: new Map(), vocab: new Set(), docs: examples.length };
  for (const ex of examples) {
    const c = model.classes.get(ex.label) ?? { docs: 0, words: 0, counts: new Map() };
    c.docs++;
    for (const w of ex.tokens) {
      c.counts.set(w, (c.counts.get(w) ?? 0) + 1);
      c.words++;
      model.vocab.add(w);
    }
    model.classes.set(ex.label, c);
  }
  return model;
}

/** P(c | d) proporcional a P(c) x prod (n_wc + 1) / (n_c + |V|); normalizado (softmax em log). */
export function predictNB(model: NBModel, tokens: readonly string[]): { label: string; p: number }[] {
  const V = model.vocab.size || 1;
  const logs = [...model.classes].map(([label, c]) => ({
    label,
    log: Math.log(c.docs / model.docs) + tokens.reduce((s, w) => s + Math.log(((c.counts.get(w) ?? 0) + 1) / (c.words + V)), 0),
  }));
  const max = Math.max(...logs.map((l) => l.log));
  const exp = logs.map((l) => ({ label: l.label, e: Math.exp(l.log - max) }));
  const z = exp.reduce((s, x) => s + x.e, 0);
  return exp.map((x) => ({ label: x.label, p: x.e / z })).sort((a, b) => b.p - a.p);
}

/** F1 macro: media do F1 de cada classe. */
export function f1Macro(pairs: readonly { truth: string; pred: string }[]): number {
  const labels = [...new Set(pairs.flatMap((p) => [p.truth, p.pred]))];
  if (!labels.length) return 0;
  const f1s = labels.map((l) => {
    const tp = pairs.filter((p) => p.pred === l && p.truth === l).length;
    const fp = pairs.filter((p) => p.pred === l && p.truth !== l).length;
    const fn = pairs.filter((p) => p.pred !== l && p.truth === l).length;
    return tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
  });
  return mean(f1s);
}

// ---------------------------------------------------------------------------------------------
// Tendencia por categoria: suavizacao exponencial de Holt

export function holtFit(y: readonly number[], alpha: number, beta: number): { level: number; trend: number; oneStep: number[] } {
  let level = y[0]!, trend = y.length > 1 ? y[1]! - y[0]! : 0;
  const oneStep: number[] = [];
  for (let t = 1; t < y.length; t++) {
    oneStep.push(level + trend);
    const prev = level;
    level = alpha * y[t]! + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return { level, trend, oneStep };
}

/**
 * Holt com alfa e beta por busca em grade (menor erro um passo a frente) e MASE contra a linha de base
 * ingenua ("igual ao mes passado"). Modelo so vale com MASE < 1 (RN-I04).
 */
export function holtForecast(y: readonly number[], horizon = 1): { forecast: number; alpha: number; beta: number; mase: number } | null {
  if (y.length < 4) return null;
  const grid = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  let best: { alpha: number; beta: number; err: number } | null = null;
  for (const alpha of grid)
    for (const beta of grid) {
      const { oneStep } = holtFit(y, alpha, beta);
      const err = oneStep.slice(1).reduce((s, f, i) => s + Math.abs(y[i + 2]! - f), 0);
      if (!best || err < best.err) best = { alpha, beta, err };
    }
  const { level, trend, oneStep } = holtFit(y, best!.alpha, best!.beta);
  // Erro do modelo x erro de "igual ao mes passado", nos mesmos pontos.
  const model = oneStep.slice(1).reduce((s, f, i) => s + Math.abs(y[i + 2]! - f), 0);
  const naive = y.slice(2).reduce((s, v, i) => s + Math.abs(v - y[i + 1]!), 0);
  return { forecast: Math.max(0, level + horizon * trend), alpha: best!.alpha, beta: best!.beta, mase: naive > 0 ? model / naive : model > 0 ? Infinity : 0 };
}
