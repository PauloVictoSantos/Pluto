// Saude financeira (nota de 300 a 850). Calculada so com os dados do usuario; nao e score de birô.

/** Pesos faceis de ajustar (somam 1). */
export const HEALTH_WEIGHTS = { onTime: 0.45, limitUse: 0.35, installments: 0.2 } as const;
export const HEALTH_MIN = 300;
export const HEALTH_MAX = 850;

export const HEALTH_BANDS = [
  { key: 'low', label: 'Baixo', from: 300, to: 450 },
  { key: 'regular', label: 'Regular', from: 450, to: 700 },
  { key: 'good', label: 'Muito bom', from: 700, to: 780 },
  { key: 'excellent', label: 'Excelente', from: 780, to: 850 },
] as const;

export const healthBand = (score: number) => HEALTH_BANDS.find((b) => score < b.to) ?? HEALTH_BANDS[HEALTH_BANDS.length - 1]!;

export interface HealthInput {
  /** Pagamentos em dia / pagamentos devidos (null: sem pagamentos no periodo, conta como 1). */
  onTimeRate: number | null;
  /** Fatura atual / limite total dos cartoes (null: sem cartao, conta como ideal). */
  limitUse: number | null;
  /** Parcelas mensais abertas / renda mensal (null: sem renda conhecida). */
  installmentsRatio: number | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Uso do limite: ate 10% e o ideal; 100% ou mais zera. */
export const limitScore = (use: number | null) => (use === null ? 1 : use <= 0.1 ? 1 : clamp01(1 - (use - 0.1) / 0.9));
/** Parcelas: ate 10% da renda e o ideal; 40% ou mais zera. */
export const installmentsScore = (r: number | null) => (r === null ? 1 : r <= 0.1 ? 1 : clamp01(1 - (r - 0.1) / 0.3));

export function healthScore(i: HealthInput): number {
  const s =
    HEALTH_WEIGHTS.onTime * clamp01(i.onTimeRate ?? 1) + HEALTH_WEIGHTS.limitUse * limitScore(i.limitUse) + HEALTH_WEIGHTS.installments * installmentsScore(i.installmentsRatio);
  return Math.round(HEALTH_MIN + (HEALTH_MAX - HEALTH_MIN) * clamp01(s));
}
