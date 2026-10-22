// Metas do agente (doc. Pluton 3.2 e 5.4): score de prioridade e alocacao da capacidade de poupanca.

export const GOAL_SCORE_WEIGHTS = { U: 0.3, E: 0.25, F: 0.2, R: 0.15, A: 0.1 } as const;

export type GoalReason = 'renda' | 'trabalho' | 'saude' | 'moradia' | 'educacao' | 'desejo';
export type GoalKind = 'purchase' | 'fixed' | 'debt_payoff' | 'experience';

/** E: saude, moradia, trabalho e renda = 1; educacao 0,8; desejo 0,2. Reserva e quitacao sao essenciais. */
export function essentiality(kind: GoalKind, reason: GoalReason | null): number {
  if (kind === 'fixed' || kind === 'debt_payoff') return 1;
  if (!reason) return 0.2;
  return reason === 'desejo' ? 0.2 : reason === 'educacao' ? 0.8 : 1;
}

/** F: impacto financeiro positivo (quitar juros, gerar renda, proteger com reserva). */
export function financialImpact(kind: GoalKind, reason: GoalReason | null): number {
  if (kind === 'debt_payoff' || reason === 'renda') return 1;
  if (kind === 'fixed') return 0.6;
  if (reason === 'trabalho') return 0.5;
  return 0;
}

/**
 * U: urgencia declarada (1 a 5) e validada. Desejo nao e urgente por definicao: limitado a 0,5
 * (o agente pergunta "o que acontece se esperar 6 meses?" e nao aceita urgencia cheia para desejo).
 */
export function validatedUrgency(urgency: number, kind: GoalKind, reason: GoalReason | null): number {
  const u = Math.min(1, Math.max(0, (urgency - 1) / 4));
  return kind !== 'fixed' && kind !== 'debt_payoff' && (reason === 'desejo' || !reason) ? Math.min(u, 0.5) : u;
}

/** S = 0,30U + 0,25E + 0,20F + 0,15R + 0,10A (todos de 0 a 1). */
export function priorityScore(f: { U: number; E: number; F: number; R: number; A: number }): number {
  const w = GOAL_SCORE_WEIGHTS;
  return Math.round((w.U * f.U + w.E * f.E + w.F * f.F + w.R * f.R + w.A * f.A) * 1000) / 1000;
}

/** A (viabilidade): fracao do aporte necessario que a capacidade livre cobre. */
export const viability = (freeMinor: number, requiredMinor: number) => (requiredMinor <= 0 ? 1 : Math.min(1, Math.max(0, freeMinor / requiredMinor)));

export interface AllocInput {
  id: string;
  score: number;
  requiredMinor: number;
}

/**
 * Metas ordenadas por S; a capacidade de poupanca vai da maior para a menor ate acabar (MT-04: a
 * soma nunca passa da capacidade). Empate: menor aporte primeiro (fecha mais metas).
 */
export function allocateCapacity<T extends AllocInput>(goals: readonly T[], capacityMinor: number) {
  let left = Math.max(0, capacityMinor);
  const out = [...goals]
    .sort((a, b) => b.score - a.score || a.requiredMinor - b.requiredMinor)
    .map((g) => {
      const allocatedMinor = Math.min(left, Math.max(0, g.requiredMinor));
      left -= allocatedMinor;
      return { ...g, allocatedMinor, waiting: allocatedMinor < g.requiredMinor };
    });
  return { goals: out, freeMinor: left };
}
