import { z } from 'zod';

// Planejamento automatico do mes (doc. Melhorias, passo 9): gerado sozinho todo dia 1, com dados
// reais e categorizados; toda sobra recebe um destino e cada decisao vem com a explicacao.

const Money = z.number().int();
export const PLAN_DESTINATIONS = ['reserva', 'divida', 'meta', 'investimento'] as const;
export const PLAN_DESTINATION_LABEL: Record<(typeof PLAN_DESTINATIONS)[number], string> = {
  reserva: 'Reserva de emergência',
  divida: 'Adiantar dívida',
  meta: 'Meta',
  investimento: 'Investimento',
};

export const MonthlyPlanSchema = z.object({
  month: z.string(),
  generatedAt: z.string(),
  /** auto: job do dia 1; manual: o usuario pediu na tela. */
  trigger: z.enum(['auto', 'manual']),
  /** Mes anterior: quanto entrou e saiu (por categoria). */
  previous: z.object({ month: z.string(), incomeMinor: Money, expensesMinor: Money, byCategory: z.array(z.object({ categoryKey: z.string(), amountMinor: Money })) }),
  incomeMinor: Money,
  /** De onde veio a renda prevista. */
  incomeSource: z.enum(['perfil', 'media']),
  /** Compromissos com data: gastos fixos, parcelamentos e emprestimos (faturas entram pelos gastos de cada categoria). */
  commitments: z.array(z.object({ kind: z.string(), name: z.string(), amountMinor: Money, due: z.string().nullable() })),
  commitmentsMinor: Money,
  /** Sobra prevista = renda - compromissos. */
  surplusMinor: Money,
  /** Limites por categoria (media de 3 meses ajustada a sobra). */
  limits: z.array(z.object({ categoryKey: z.string(), averageMinor: Money, limitMinor: Money })),
  limitsMinor: Money,
  /** O que sobra depois dos limites: vai inteiro para os destinos. */
  freeMinor: Money,
  destinations: z.array(z.object({ kind: z.enum(PLAN_DESTINATIONS), refId: z.string().nullable(), label: z.string(), amountMinor: Money, why: z.string() })),
  /** Resumo curto (IA com consentimento; senao, texto montado com os mesmos numeros). */
  summary: z.string(),
  adjusted: z.boolean(),
});
export type MonthlyPlan = z.infer<typeof MonthlyPlanSchema>;

/** Ajuste do usuario: vale para aquele mes. O investimento absorve a diferenca (R$ 0,00 sem destino). */
export const AdjustMonthlyPlanSchema = z.object({
  limits: z.array(z.object({ categoryKey: z.string(), limitMinor: Money.min(0) })).max(60).optional(),
  destinations: z.array(z.object({ kind: z.enum(PLAN_DESTINATIONS), refId: z.string().nullable(), label: z.string().max(80), amountMinor: Money.min(0) })).max(30).optional(),
});
export type AdjustMonthlyPlan = z.input<typeof AdjustMonthlyPlanSchema>;
