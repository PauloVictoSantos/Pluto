import { z } from 'zod';

/** Serie recorrente (assinatura, conta fixa, salario) detectada nas transacoes. */
export const RecurringSchema = z.object({
  /** Como a serie foi agrupada: pelo destinatario (CPF/CNPJ/conta) ou pela descricao. */
  key: z.enum(['destinatario', 'descricao']),
  direction: z.enum(['in', 'out']),
  label: z.string(),
  categoryKey: z.string(),
  /** Periodo em dias: 7, 14, 30 ou 365. */
  period: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(365)]),
  /** Valor tipico (mediana), com sinal. */
  amountMinor: z.number().int(),
  count: z.number().int(),
  lastDate: z.coerce.date(),
  nextDate: z.coerce.date(),
});
export type Recurring = z.infer<typeof RecurringSchema>;

/** Compra parcelada com parcelas ainda por vir. */
export const PendingInstallmentsSchema = z.object({
  groupId: z.string(),
  label: z.string(),
  categoryKey: z.string(),
  n: z.number().int(),
  total: z.number().int(),
  remaining: z.number().int(),
  /** Valor de cada parcela, com sinal. */
  amountMinor: z.number().int(),
  remainingMinor: z.number().int(),
  lastDate: z.coerce.date(),
});

/** Compromissos ja conhecidos: entram na projecao como certos. */
export const CommitmentsSchema = z.object({
  recurring: z.array(RecurringSchema),
  installments: z.array(PendingInstallmentsSchema),
});
export type Commitments = z.infer<typeof CommitmentsSchema>;

const Money = z.number().int();
const RangeSchema = z.object({ p10: Money, p50: Money, p90: Money });

/**
 * Saldo no fim do mes (Visao geral). status:
 * - ready: modelo ligado (venceu a linha de base no backtest, RN-I04)
 * - learning: historico curto (needWeeks semanas faltando)
 * - baseline: o modelo nao venceu "igual ao mes passado"; so o conhecido e mostrado
 */
export const ForecastSchema = z.object({
  month: z.string(),
  status: z.enum(['ready', 'learning', 'baseline']),
  needWeeks: z.number().int(),
  daysLeft: z.number().int(),
  balanceMinor: Money,
  /** Saldo final: faixa P10-P90 (RN-M05). null fora do status ready. */
  range: RangeSchema.nullable(),
  /** P(saldo final >= 0). */
  probPositive: z.number().nullable(),
  /** O que ja se sabe ate o fim do mes (valores positivos). */
  known: z.object({
    incomeMinor: Money,
    invoicesMinor: Money,
    billsMinor: Money,
    recurringMinor: Money,
    installmentsMinor: Money,
  }),
  /** Gasto variavel no debito/Pix: o que ja foi e a faixa do que falta. */
  variable: z.object({ spentMinor: Money, remaining: RangeSchema.nullable() }),
  /** Controle cruzado pelo perfil do mes: se divergir mais de 25%, o alerta usa a mais conservadora. */
  crossCheck: z.object({ profileTotalMinor: Money.nullable(), modelTotalMinor: Money.nullable(), divergent: z.boolean() }),
  backtest: z.object({ n: z.number().int(), maeModelMinor: Money.nullable(), maeBaselineMinor: Money.nullable(), coverage: z.number().nullable() }),
});
export type Forecast = z.infer<typeof ForecastSchema>;

/** Orcamento sugerido (rascunho editavel; nada e aplicado sem aceite, RN-M06). */
export const BudgetSuggestionSchema = z.object({
  month: z.string(),
  status: z.enum(['ready', 'learning']),
  months: z.number().int(),
  incomeMedianMinor: Money,
  fixedMinor: Money,
  goalsMinor: Money,
  availableMinor: Money,
  /** false: nem o piso (percentil 10) de cada categoria cabe no disponivel. */
  fits: z.boolean(),
  lines: z.array(z.object({ categoryKey: z.string(), q10Minor: Money, q60Minor: Money, cv: z.number(), limitMinor: Money })),
});
export type BudgetSuggestion = z.infer<typeof BudgetSuggestionSchema>;

/** Chance de cada meta cumprir o prazo e o aporte necessario. */
export const GoalInsightSchema = z.object({
  goalId: z.string(),
  months: z.number().int(),
  requiredMonthlyMinor: Money,
  /** null: menos de 3 meses de historico. */
  chance: z.number().nullable(),
  /** Quanto guardar a mais por mes para 85% de chance (null: nao alcanca ou ja passa de 85%). */
  extraFor85Minor: Money.nullable(),
  /** Categoria de estilo de vida com maior gasto, para sugerir de onde tirar. */
  cutCategory: z.string().nullable(),
});
export const GoalInsightsSchema = z.object({ months: z.number().int(), goals: z.array(GoalInsightSchema) });
export type GoalInsights = z.infer<typeof GoalInsightsSchema>;

/** Ordem recomendada de pagamento e custo de atrasar 30 dias (Contas a pagar). */
export const PaymentPlanSchema = z.object({
  availableMinor: Money,
  totalDueMinor: Money,
  short: z.boolean(),
  /** Juros do rotativo usados no calculo (o Open Finance nao informa a taxa da fatura). */
  revolvingRateMonthly: z.number(),
  items: z.array(
    z.object({
      kind: z.enum(['invoice', 'bill']),
      id: z.string(),
      label: z.string(),
      dueDate: z.string(),
      amountMinor: Money,
      /** Custo de atrasar 30 dias, por real. */
      costPerReal: z.number(),
      cost30Minor: Money,
      /** Quanto cabe pagar com o saldo atual, nesta ordem. */
      payMinor: Money,
    }),
  ),
});
export type PaymentPlan = z.infer<typeof PaymentPlanSchema>;

/** Saude financeira (300 a 850) calculada com os dados do usuario; nao e score de birô. */
export const HEALTH_PERIODS = ['month', '3m', '12m'] as const;
export const FinancialHealthQuerySchema = z.object({ period: z.enum(HEALTH_PERIODS).default('month') });
export const FinancialHealthSchema = z.object({
  period: z.enum(HEALTH_PERIODS),
  score: z.number().int(),
  /** Nota do periodo anterior de mesmo tamanho (null sem historico). */
  prevScore: z.number().int().nullable(),
  band: z.object({ label: z.string(), from: z.number().int(), to: z.number().int() }),
  onTime: z.object({ pct: z.number().nullable(), paid: z.number().int(), due: z.number().int() }),
  limitUse: z.object({ pct: z.number().nullable(), usedMinor: Money, limitMinor: Money, trend: z.enum(['up', 'down', 'flat']).nullable() }),
  negatives: z.object({ count: z.number().int(), overdue: z.number().int(), fees: z.number().int() }),
  historyMonths: z.number().int(),
  installments: z.object({ count: z.number().int(), monthlyMinor: Money, incomeMinor: Money }),
  purchases: z.number().int(),
});
export type FinancialHealth = z.infer<typeof FinancialHealthSchema>;

/** Categorizacao aprendida: ligada so com F1 macro >= 0,85 nas correcoes reservadas (RN-I04). */
export const CategorizerStatusSchema = z.object({
  enabled: z.boolean(),
  examples: z.number().int(),
  f1: z.number().nullable(),
  applied: z.number().int(),
  suggested: z.number().int(),
});

/** Padroes de gasto (Relatorios). Pico so com 8 semanas e significancia (RN-D04). */
export const PatternsSchema = z.object({
  status: z.enum(['ready', 'learning']),
  weeks: z.number().int(),
  needWeeks: z.number().int(),
  /** 42 celulas: dia da semana (0 = domingo) x faixa de 4 horas (0 = 0h-4h). */
  cells: z.array(
    z.object({
      dow: z.number().int(),
      band: z.number().int(),
      count: z.number().int(),
      ratePerWeek: z.number(),
      ticketMinor: Money,
      expectedMinor: Money,
      peak: z.boolean(),
    }),
  ),
  /** Frase-conclusao do mapa (null sem pico significativo). */
  conclusion: z.string().nullable(),
  /** Transacoes sem horario real ficam fora do mapa (RN-D03). */
  untimedShare: z.number(),
  byDay: z.array(z.object({ dow: z.number().int(), weeklyMinor: Money })),
  /** Ate 5 categorias + "outras", em barras ordenadas. */
  categories: z.array(z.object({ categoryKey: z.string(), totalMinor: Money, share: z.number() })),
  /** Mudancas de patamar (CUSUM) nas ultimas semanas. */
  shifts: z.array(z.object({ categoryKey: z.string(), weeksAgo: z.number().int(), baselineWeeklyMinor: Money, recentWeeklyMinor: Money })),
  /** Proximo mes por categoria (Holt); nextMonthMinor null quando nao vence "igual ao mes passado". */
  trend: z.array(z.object({ categoryKey: z.string(), lastMonthMinor: Money, nextMonthMinor: Money.nullable(), mase: z.number().nullable() })),
  /** O que explica a variacao do ultimo mes fechado contra o anterior. */
  variation: z
    .object({ month: z.string(), prevMonth: z.string(), totalDeltaMinor: Money, drivers: z.array(z.object({ categoryKey: z.string(), deltaMinor: Money })) })
    .nullable(),
  /** Sazonalidade anual so com 24 meses de historico. */
  seasonalityNeedMonths: z.number().int(),
  categorizer: CategorizerStatusSchema,
});
export type Patterns = z.infer<typeof PatternsSchema>;
