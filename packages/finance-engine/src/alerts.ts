// Alertas inteligentes (doc. "Alertas inteligentes e avaliacao"). Funcoes puras.

/** Variaveis do alerta para P(util | x): tipo, faixa horaria, grupo da categoria e valor. */
export interface AlertFeatures {
  type: string;
  hour: number;
  group: string;
  amountMinor: number;
}

export interface Logistic {
  weights: Map<string, number>;
  bias: number;
  n: number;
}

const featureKeys = (x: AlertFeatures): [string, number][] => [
  [`type:${x.type}`, 1],
  [`band:${Math.floor(x.hour / 4)}`, 1],
  [`group:${x.group}`, 1],
  // Escala logaritmica: R$ 10 e R$ 1.000 nao podem pesar 100 vezes diferente.
  ['log_value', Math.log10(1 + Math.max(0, x.amountMinor) / 100) / 4],
];

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Regressao logistica com L2, treinada pelos botoes "util" (1) e "nao util" (0) de cada alerta
 * (RN-A04). Gradiente descendente; poucos exemplos e poucas variaveis, um usuario.
 */
export function trainLogistic(samples: readonly { x: AlertFeatures; useful: boolean }[], opts: { epochs?: number; lr?: number; l2?: number } = {}): Logistic {
  const epochs = opts.epochs ?? 300, lr = opts.lr ?? 0.3, l2 = opts.l2 ?? 0.05;
  const weights = new Map<string, number>();
  let bias = 0;
  for (let e = 0; e < epochs; e++) {
    for (const s of samples) {
      const f = featureKeys(s.x);
      const err = sigmoid(bias + f.reduce((z, [k, v]) => z + (weights.get(k) ?? 0) * v, 0)) - (s.useful ? 1 : 0);
      bias -= lr * err;
      for (const [k, v] of f) {
        const w = weights.get(k) ?? 0;
        weights.set(k, w - lr * (err * v + l2 * w));
      }
    }
  }
  return { weights, bias, n: samples.length };
}

/** P(util | x). Comeca em 0,5 para todos: com menos de 5 respostas o modelo nao opina. */
export function pUseful(model: Logistic | null, x: AlertFeatures): number {
  if (!model || model.n < 5) return 0.5;
  return sigmoid(model.bias + featureKeys(x).reduce((z, [k, v]) => z + (model.weights.get(k) ?? 0) * v, 0));
}

/** A = P(evento) x impacto em reais x peso da prioridade x P(util | x). */
export const alertScore = (pEvent: number, impactMinor: number, priorityWeight: number, useful: number) =>
  pEvent * (Math.max(0, impactMinor) / 100) * priorityWeight * useful;

/** Limiar tau (em reais ponderados): sobe 50% se a taxa de "nao util" passar de 30% em 2 semanas. */
export function threshold(base: number, recent: readonly boolean[]): number {
  if (recent.length < 5) return base;
  const notUseful = recent.filter((u) => !u).length / recent.length;
  return notUseful > 0.3 ? base * 1.5 : base;
}

/** Silencio entre start e end (ex.: 22:00-07:00), atravessando a meia-noite. */
export function inQuietHours(hhmm: string, start: string, end: string): boolean {
  return start <= end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}

export interface Candidate {
  type: string;
  target: string;
  score: number;
  /** Vencimento no proprio dia: pode furar o silencio (RN-A01). */
  dueToday?: boolean;
}

/**
 * Quais candidatos vao para push/e-mail agora: os de maior pontuacao acima de tau, ate completar 3 no dia
 * (RN-A01); no silencio, so vencimento do dia. O resto fica no painel.
 */
export function pickPush<T extends Candidate>(cands: readonly T[], opts: { tau: number; sentToday: number; quiet: boolean; max?: number }): T[] {
  const room = Math.max(0, (opts.max ?? 3) - opts.sentToday);
  return [...cands]
    .filter((c) => c.score >= opts.tau && (!opts.quiet || c.dueToday))
    .sort((a, b) => b.score - a.score)
    .slice(0, room);
}
