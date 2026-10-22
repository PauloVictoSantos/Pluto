import { z } from 'zod';

// Limite de gasto variavel do mes (doc. Pluton 3.3), gerenciado pelo agente: recalculado no dia 1 e a
// cada mudanca de renda, fixo, divida ou meta. A sobrescrita manual vale so para o mes (LG-04).

export const SpendingLimitSchema = z.object({
  month: z.string(),
  /** Calculado pelo motor (LG-01). */
  computedMinor: z.number().int(),
  /** Sobrescrita manual deste mes. */
  overrideMinor: z.number().int().nullable(),
  /** O que vale: a sobrescrita, se houver, senao o calculado. */
  limitMinor: z.number().int(),
  /** Gasto variavel do mes ate agora (sem fixos vinculados ao extrato nem parcelas). */
  spentMinor: z.number().int(),
  remainingMinor: z.number().int(),
  usedPct: z.number(),
  /** LG-06: quanto cabe por semana e por dia daqui ate o fim do mes. */
  weekMinor: z.number().int(),
  dayMinor: z.number().int(),
  weeksLeft: z.number().int(),
  breakdown: z.object({
    incomeMinor: z.number().int(),
    fixedMinor: z.number().int(),
    goalsMinor: z.number().int(),
    marginMinor: z.number().int(),
    /** Quanto o plano passa da renda (limite zerado). */
    deficitMinor: z.number().int(),
  }),
  /** Gasto variavel tipico: percentil 80 dos ultimos 6 meses fechados (null sem historico). */
  typicalMinor: z.number().int().nullable(),
  /** sem-renda: renda nao informada e nao deu para estimar. */
  status: z.enum(['ok', 'atencao', 'estourado', 'sem-renda']),
  computedAt: z.string(),
});
export type SpendingLimit = z.infer<typeof SpendingLimitSchema>;

export const OverrideLimitSchema = z.object({ amountMinor: z.number().int().min(0).max(1e10).nullable() });
