// Saude financeira de 0 a 100 (doc. Pluton 5.2): media ponderada dos indicadores normalizados.
// Abaixo de 40 o agente entra em modo de contencao (so aprova gastos essenciais).
// Calculada so com os dados do usuario; nao e score de birô.

export const HEALTH_INDICATORS = ['commitment', 'debt', 'reserve', 'savingsRate', 'capacity'] as const;
export type HealthIndicator = (typeof HEALTH_INDICATORS)[number];

/** Pesos faceis de ajustar (somam 1). */
export const HEALTH_WEIGHTS: Record<HealthIndicator, number> = { commitment: 0.25, debt: 0.2, reserve: 0.2, savingsRate: 0.15, capacity: 0.2 };

/** Abaixo disto: modo de contencao. */
export const CONTAINMENT_BELOW = 40;

export const HEALTH_BANDS = [
  { key: 'containment', label: 'Contenção', from: 0, to: 40 },
  { key: 'attention', label: 'Atenção', from: 40, to: 60 },
  { key: 'good', label: 'Boa', from: 60, to: 80 },
  { key: 'excellent', label: 'Excelente', from: 80, to: 101 },
] as const;

export const healthBand = (score: number) => HEALTH_BANDS.find((b) => score < b.to) ?? HEALTH_BANDS[HEALTH_BANDS.length - 1]!;

/** Interpolacao linear por pontos (x crescente), presa nas pontas. */
export function piecewise(x: number, pts: readonly (readonly [number, number])[]): number {
  if (x <= pts[0]![0]) return pts[0]![1];
  for (let k = 1; k < pts.length; k++) {
    const [x1, y1] = pts[k]!, [x0, y0] = pts[k - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1]![1];
}

/**
 * Normalizacao (0 a 1). Cada curva da nota cheia na faixa saudavel do doc e zera longe dela:
 * comprometimento <= 50% (zera em 90%); endividamento <= 30% (zera em 60%); reserva >= 6 meses;
 * poupanca >= 15% da renda; capacidade (sobra / renda) > 0, cheia em 20%.
 */
export const HEALTH_CURVES: Record<HealthIndicator, readonly (readonly [number, number])[]> = {
  commitment: [[0.3, 1], [0.5, 0.75], [0.9, 0]],
  debt: [[0, 1], [0.1, 0.9], [0.3, 0.6], [0.6, 0]],
  reserve: [[0, 0], [3, 0.6], [6, 1]],
  savingsRate: [[0, 0], [0.15, 1]],
  capacity: [[-0.2, 0], [0, 0.35], [0.2, 1]],
};

/** Valores brutos; null = sem dado (o peso e redistribuido entre os outros). */
export type HealthValues = Record<HealthIndicator, number | null>;

/** Faixa saudavel de cada indicador (doc. 5.2). */
export const isHealthy = (k: HealthIndicator, v: number) =>
  k === 'commitment' ? v <= 0.5 : k === 'debt' ? v <= 0.3 : k === 'reserve' ? v >= 6 : k === 'savingsRate' ? v >= 0.15 : v > 0;

export function healthScore(v: HealthValues): { score: number | null; parts: Record<HealthIndicator, number | null> } {
  const parts = Object.fromEntries(HEALTH_INDICATORS.map((k) => [k, v[k] === null ? null : piecewise(v[k]!, HEALTH_CURVES[k])])) as Record<HealthIndicator, number | null>;
  const known = HEALTH_INDICATORS.filter((k) => parts[k] !== null);
  const w = known.reduce((s, k) => s + HEALTH_WEIGHTS[k], 0);
  // Sem renda nao da para medir quase nada: com menos da metade dos pesos, nao ha nota.
  if (w < 0.5) return { score: null, parts };
  return { score: Math.round((100 * known.reduce((s, k) => s + HEALTH_WEIGHTS[k] * parts[k]!, 0)) / w), parts };
}
