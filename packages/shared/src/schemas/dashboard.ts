import { z } from 'zod';
import { INVESTMENT_TYPES, INVOICE_STATUSES } from '../constants';

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM');
export const MonthQuerySchema = z.object({ month: Month.optional() });

const MonthTotals = z.object({
  month: z.string(),
  incomeMinor: z.number().int(),
  expensesMinor: z.number().int(),
  /** Saida liquida para investimentos no mes (negativo = resgate). */
  investedMinor: z.number().int(),
});

export const DashboardSummarySchema = z.object({
  /** Soma de contas corrente e poupanca. */
  balanceMinor: z.number().int(),
  lastSyncAt: z.coerce.date().nullable(),
  banks: z.array(
    z.object({
      connectionId: z.string(),
      institutionName: z.string(),
      primaryColor: z.string().nullable(),
      balanceMinor: z.number().int(),
      status: z.string(),
      needsAction: z.boolean(),
    }),
  ),
  current: MonthTotals,
  previous: MonthTotals,
  /** Ultimos 6 meses, do mais antigo ao atual (meses sem movimento vem zerados). */
  monthly: z.array(MonthTotals),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

/**
 * Series diarias dos ultimos 30 dias para os sparklines (um ponto por dia, do mais antigo a hoje).
 * Investido e saldo das contas sao reconstruidos a partir do valor de hoje e das movimentacoes (sem
 * rendimento no meio do caminho).
 */
export const DashboardSeriesSchema = z.object({
  days: z.array(z.string()),
  incomeMinor: z.array(z.number().int()),
  expensesMinor: z.array(z.number().int()),
  /** Receitas - despesas acumuladas no periodo. */
  netMinor: z.array(z.number().int()),
  investedMinor: z.array(z.number().int()),
  banks: z.array(z.object({ connectionId: z.string(), balanceMinor: z.array(z.number().int()) })),
});
export type DashboardSeries = z.infer<typeof DashboardSeriesSchema>;

export const SpendingSchema = z.object({
  month: z.string(),
  totalMinor: z.number().int(),
  categories: z.array(z.object({ key: z.string(), spentMinor: z.number().int(), count: z.number().int() })),
});
export type Spending = z.infer<typeof SpendingSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  cardName: z.string(),
  institutionName: z.string(),
  closingDate: z.coerce.date().nullable(),
  dueDate: z.coerce.date(),
  totalMinor: z.number().int(),
  paidMinor: z.number().int(),
  status: z.enum(INVOICE_STATUSES),
});
export type Invoice = z.infer<typeof InvoiceSchema>;
export const InvoiceQuerySchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

export const CardSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  institutionName: z.string(),
  name: z.string(),
  numberMasked: z.string().nullable(),
  brand: z.string().nullable(),
  creditLimitMinor: z.number().int().nullable(),
  availableCreditMinor: z.number().int().nullable(),
  usedMinor: z.number().int().nullable(),
  /** Fatura em andamento (saldo atual do cartao no Pluggy). */
  currentBillMinor: z.number().int(),
  closingDay: z.number().int().nullable(),
  dueDay: z.number().int().nullable(),
  /** Ultima fatura fechada informada pelo Pluggy. */
  invoice: InvoiceSchema.nullable(),
});
export type Card = z.infer<typeof CardSchema>;

export const InvestmentsSchema = z.object({
  totalMinor: z.number().int(),
  appliedMinor: z.number().int(),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(INVESTMENT_TYPES),
      subtype: z.string().nullable(),
      institutionName: z.string(),
      appliedMinor: z.number().int(),
      currentValueMinor: z.number().int(),
      dueDate: z.coerce.date().nullable(),
      rateInfo: z.string().nullable(),
    }),
  ),
  allocation: z.array(z.object({ type: z.enum(INVESTMENT_TYPES), valueMinor: z.number().int() })),
});
export type Investments = z.infer<typeof InvestmentsSchema>;

// Orcamentos (RN-20..22) e metas (RN-23)
export const BudgetSchema = z.object({
  month: z.string(),
  items: z.array(z.object({ categoryKey: z.string(), limitMinor: z.number().int().nonnegative() })),
});
export type Budget = z.infer<typeof BudgetSchema>;
export const PutBudgetSchema = z.object({
  month: Month,
  items: z.array(z.object({ categoryKey: z.string().max(40), limitMinor: z.number().int().nonnegative().max(1e12) })).max(60),
});

export const GoalSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  targetMinor: z.number().int(),
  savedMinor: z.number().int(),
  /** AAAA-MM-DD */
  deadline: z.string(),
  monthlyContributionMinor: z.number().int(),
  /** 1 (mais importante) a 5 (RN-M02); metas antigas valem 3. */
  priority: z.number().int().min(1).max(5),
  /** Metas v2 do Plutao (MT-03); metas antigas valem "ativa". */
  status: z.enum(['ativa', 'pausada', 'concluida', 'cancelada']),
  kind: z.enum(['purchase', 'fixed', 'debt_payoff', 'experience']).nullable(),
  /** Score de prioridade S (0 a 1); null em metas antigas. */
  score: z.number().nullable(),
});
export type Goal = z.infer<typeof GoalSchema>;
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CreateGoalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  icon: z.string().max(30).default('target'),
  targetMinor: z.number().int().positive().max(1e12),
  savedMinor: z.number().int().nonnegative().max(1e12).default(0),
  /** RN-M02: prazo no futuro. */
  deadline: Day.refine((d) => d > new Date().toISOString().slice(0, 10), 'O prazo precisa ser uma data futura'),
  priority: z.number().int().min(1).max(5).default(3),
});
// Sem .partial() do CreateGoalSchema: no Zod v4 os defaults continuariam valendo e um PATCH
// parcial zeraria savedMinor/icon.
export const UpdateGoalSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  icon: z.string().max(30).optional(),
  targetMinor: z.number().int().positive().max(1e12).optional(),
  savedMinor: z.number().int().nonnegative().max(1e12).optional(),
  deadline: Day.optional(),
  /** Soma ao valor guardado ("Guardar dinheiro"). Registro manual: o Pluto nao move dinheiro. */
  addMinor: z.number().int().min(-1e12).max(1e12).optional(),
  monthlyContributionMinor: z.number().int().nonnegative().max(1e12).optional(),
  priority: z.number().int().min(1).max(5).optional(),
});

