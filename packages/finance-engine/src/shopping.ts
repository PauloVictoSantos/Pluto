// Modelos da lista de compras (doc. "Modelos da lista de compras"). Funcoes puras.

/** Peso mensal do historico: meia-vida de ~4 meses. */
export const LAMBDA = 0.85;
/** Forca do prior da categoria (Bayes empirico). */
export const PRIOR_K = 2;

export interface ListedMonth {
  bought: boolean;
  /** 0 = lista do mes anterior ao que esta sendo montado. */
  monthsAgo: number;
}

export interface Posterior {
  a: number;
  b: number;
  p: number;
  /** Limites do intervalo de ~90% (aproximacao normal). */
  low: number;
  high: number;
}

/** Beta-Binomial com decaimento e prior da categoria: alpha0 = m*k, beta0 = (1-m)*k. */
export function posterior(history: readonly ListedMonth[], m: number, k = PRIOR_K, lambda = LAMBDA): Posterior {
  const prior = Math.min(0.98, Math.max(0.02, m));
  let a = prior * k, b = (1 - prior) * k;
  for (const h of history) {
    const w = lambda ** h.monthsAgo;
    if (h.bought) a += w;
    else b += w;
  }
  const p = a / (a + b), sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return { a, b, p, low: Math.max(0, p - 1.645 * sd), high: Math.min(1, p + 1.645 * sd) };
}

export type SuggestionClass = 'essential' | 'maybe' | 'rarely';

/** Limite inferior > 0,6: essencial. Limite superior < 0,3: "voce costuma nao comprar". Resto: talvez. */
export function classify(post: Posterior): SuggestionClass {
  if (post.low > 0.6) return 'essential';
  if (post.high < 0.3) return 'rarely';
  return 'maybe';
}

/** Amostra Gamma(shape, 1) (Marsaglia-Tsang), base da amostra Beta. */
function gamma(shape: number, rand: () => number): number {
  if (shape < 1) return gamma(shape + 1, rand) * rand() ** (1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      // Normal padrao por Box-Muller.
      x = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = 1 - rand();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/** Thompson sampling: theta ~ Beta(a, b). Item incerto ainda tem chance de ser sugerido. */
export function sampleBeta(a: number, b: number, rand: () => number): number {
  const x = gamma(a, rand), y = gamma(b, rand);
  return x / (x + y);
}

/** Mediana ponderada (pesos lambda^monthsAgo) das quantidades compradas. */
export function weightedMedian(values: readonly { value: number; weight: number }[]): number | null {
  const xs = values.filter((v) => v.weight > 0).sort((a, b) => a.value - b.value);
  if (!xs.length) return null;
  const half = xs.reduce((s, v) => s + v.weight, 0) / 2;
  let acc = 0;
  for (const v of xs) {
    acc += v.weight;
    if (acc >= half) return v.value;
  }
  return xs[xs.length - 1]!.value;
}

/** Preco de referencia por media movel exponencial (alfa = 0,3), em ordem cronologica. */
export function emaPrice(pricesChrono: readonly number[], alpha = 0.3): number | null {
  if (!pricesChrono.length) return null;
  return Math.round(pricesChrono.slice(1).reduce((ref, p) => alpha * p + (1 - alpha) * ref, pricesChrono[0]!));
}

/**
 * Inflacao da cesta (Laspeyres) contra o mes-base: so itens com preco nos dois meses, quantidades
 * do mes-base. null sem itens em comum.
 */
export function laspeyres(base: ReadonlyMap<string, { price: number; qty: number }>, current: ReadonlyMap<string, number>): number | null {
  let num = 0, den = 0;
  for (const [id, b] of base) {
    const p = current.get(id);
    if (p === undefined) continue;
    num += p * b.qty;
    den += b.price * b.qty;
  }
  return den > 0 ? (100 * num) / den : null;
}

/**
 * Regras de associacao entre itens das cestas mensais: Y e sugerido quando X esta na lista, lift > 1,5
 * e os dois apareceram juntos em pelo menos 3 meses.
 */
export function associations(baskets: readonly ReadonlySet<string>[], minTogether = 3, minLift = 1.5): { x: string; y: string; lift: number; together: number }[] {
  const n = baskets.length;
  if (!n) return [];
  const count = new Map<string, number>();
  const pair = new Map<string, number>();
  for (const basket of baskets) {
    const items = [...basket];
    for (const i of items) count.set(i, (count.get(i) ?? 0) + 1);
    for (const x of items) for (const y of items) if (x !== y) pair.set(`${x}\u0000${y}`, (pair.get(`${x}\u0000${y}`) ?? 0) + 1);
  }
  const out: { x: string; y: string; lift: number; together: number }[] = [];
  for (const [k, together] of pair) {
    if (together < minTogether) continue;
    const [x, y] = k.split('\u0000') as [string, string];
    const lift = (together / count.get(x)!) / (count.get(y)! / n);
    if (lift > minLift) out.push({ x, y, lift, together });
  }
  return out;
}
