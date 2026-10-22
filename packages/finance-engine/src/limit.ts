import { roundHalfEven } from './finmath';

// Limite de gasto variavel do mes (doc. Pluton 3.3). Funcoes puras; o backend junta os dados.

export interface LimitInputs {
  incomeMinor: number;
  /** Fixos + parcelas de dividas (equivalente mensal). */
  fixedMinor: number;
  /** Aportes mensais planejados das metas ativas. */
  goalsMinor: number;
  /** 0 a 15 (LG-02). */
  safetyMarginPct: number;
}

/**
 * LG-01: renda - fixos - parcelas - aportes - margem. Nunca negativo: o que falta vira deficit
 * (o plano nao fecha e o agente precisa propor cortes).
 */
export function spendingLimit(i: LimitInputs) {
  const marginMinor = roundHalfEven((i.incomeMinor * i.safetyMarginPct) / 100);
  const raw = i.incomeMinor - i.fixedMinor - i.goalsMinor - marginMinor;
  return { limitMinor: Math.max(0, raw), marginMinor, deficitMinor: Math.max(0, -raw) };
}

/**
 * LG-06: o que sobra do limite dividido pelas semanas que faltam (a semana atual conta inteira),
 * para nao concentrar o gasto no comeco do mes.
 */
export function weeklyAllowance(remainingMinor: number, daysLeftIncludingToday: number) {
  const weeksLeft = Math.max(1, Math.ceil(daysLeftIncludingToday / 7));
  const days = Math.max(1, daysLeftIncludingToday);
  return { weeksLeft, weekMinor: Math.max(0, Math.floor(remainingMinor / weeksLeft)), dayMinor: Math.max(0, Math.floor(remainingMinor / days)) };
}

/** LG-05: maior faixa de consumo atingida (0,5 / 0,8 / 1) ou null. */
export function usageThreshold(spentMinor: number, limitMinor: number): 0.5 | 0.8 | 1 | null {
  if (limitMinor <= 0) return spentMinor > 0 ? 1 : null;
  const r = spentMinor / limitMinor;
  return r >= 1 ? 1 : r >= 0.8 ? 0.8 : r >= 0.5 ? 0.5 : null;
}
