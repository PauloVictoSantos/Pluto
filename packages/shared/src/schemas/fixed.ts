import { z } from 'zod';
import { CATEGORY_BY_KEY } from '../categories';

// Gastos fixos do agente Plutao (doc. Pluton 3.1). Cadastrados na tela ou pelo chat (mesmo endpoint,
// GF-01); valor variavel guarda media dos ultimos 3 meses + desvio (GF-04); parcelas de dividas
// aparecem como fixos temporarios com data de fim (GF-06), so leitura (edita-se em Contas a pagar).

export const FIXED_RECURRENCES = ['weekly', 'monthly', 'yearly'] as const;
export type FixedRecurrence = (typeof FIXED_RECURRENCES)[number];
export const FIXED_RECURRENCE_LABEL: Record<FixedRecurrence, string> = { weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };

/** Equivalente mensal: semanal x 52/12, anual / 12. */
export const monthlyEquivalent = (amountMinor: number, recurrence: FixedRecurrence) =>
  Math.round(recurrence === 'weekly' ? (amountMinor * 52) / 12 : recurrence === 'yearly' ? amountMinor / 12 : amountMinor);

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM');
const SpendCategory = z.string().refine((k) => ['essential', 'lifestyle'].includes(CATEGORY_BY_KEY[k]?.group ?? ''), 'Escolha uma categoria de gasto');

export const FixedExpenseSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryKey: z.string(),
  amountMinor: z.number().int(),
  /** Valor variavel (luz, agua): amountMinor e a media dos ultimos 3 meses. */
  isVariable: z.boolean(),
  /** Desvio padrao do valor variavel nos ultimos 3 meses. */
  amountStdMinor: z.number().int().nullable(),
  /** Dia do vencimento (semanal: 1 = domingo ... 7 = sabado). */
  dueDay: z.number().int(),
  /** Mes do vencimento (so anual). */
  dueMonth: z.number().int().nullable(),
  recurrence: z.enum(FIXED_RECURRENCES),
  /** Ultimo mes (AAAA-MM) de um fixo temporario. */
  endsOn: z.string().nullable(),
  /** manual/chat: cadastrado pelo usuario; divida: parcela ou mensalidade de Contas a pagar. */
  source: z.enum(['manual', 'chat', 'divida']),
  /** Descricao das transacoes que alimentam a media do valor variavel. */
  matchKey: z.string().nullable(),
  monthlyMinor: z.number().int(),
  /** Parcela "3 de 12" (so dividas). */
  installment: z.object({ n: z.number().int(), total: z.number().int() }).nullable(),
});
export type FixedExpense = z.infer<typeof FixedExpenseSchema>;

export const FixedSuggestionSchema = z.object({
  matchKey: z.string(),
  name: z.string(),
  categoryKey: z.string(),
  amountMinor: z.number().int(),
  recurrence: z.enum(FIXED_RECURRENCES),
  dueDay: z.number().int(),
});
export type FixedSuggestion = z.infer<typeof FixedSuggestionSchema>;

export const FixedExpensesSchema = z.object({
  items: z.array(FixedExpenseSchema),
  /** Recorrencias detectadas no extrato que ainda nao viraram fixo. */
  suggestions: z.array(FixedSuggestionSchema),
  /** Soma mensal dos fixos ativos (cadastrados + dividas). */
  monthlyTotalMinor: z.number().int(),
  /** Renda liquida do perfil (ou a sugerida). */
  incomeMinor: z.number().int().nullable(),
  /** Fixos / renda (0-1+), null sem renda. */
  incomeShare: z.number().nullable(),
});

const FixedFields = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao gasto').max(60),
  categoryKey: SpendCategory,
  amountMinor: z.number().int().positive('Informe o valor').max(1e10),
  isVariable: z.boolean(),
  dueDay: z.number().int().min(1).max(31),
  dueMonth: z.number().int().min(1).max(12).nullable().optional(),
  recurrence: z.enum(FIXED_RECURRENCES),
  endsOn: Month.nullable().optional(),
  matchKey: z.string().trim().min(1).max(200).nullable().optional(),
});

/** Vencimento coerente com a recorrencia (no update, o servidor checa o resultado ja mesclado). */
export function fixedDueError(b: { recurrence: FixedRecurrence; dueDay: number; dueMonth?: number | null }): { path: string; message: string } | null {
  if (b.recurrence === 'weekly' && b.dueDay > 7) return { path: 'dueDay', message: 'No semanal, use 1 (domingo) a 7 (sábado)' };
  if (b.recurrence === 'yearly' && !b.dueMonth) return { path: 'dueMonth', message: 'Informe o mês do vencimento anual' };
  return null;
}

export const CreateFixedExpenseSchema = FixedFields.extend({ isVariable: z.boolean().default(false), source: z.enum(['manual', 'chat']).default('manual') }).superRefine((b, ctx) => {
  const e = fixedDueError(b);
  if (e) ctx.addIssue({ code: 'custom', path: [e.path], message: e.message });
});
export type CreateFixedExpense = z.input<typeof CreateFixedExpenseSchema>;

export const UpdateFixedExpenseSchema = FixedFields.partial().refine((b) => Object.keys(b).length > 0, 'Nada para atualizar');
export type UpdateFixedExpense = z.input<typeof UpdateFixedExpenseSchema>;
