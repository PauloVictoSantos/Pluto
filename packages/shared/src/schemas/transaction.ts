import { z } from 'zod';
import { CATEGORY_BY_KEY } from '../categories';
import { CATEGORY_SOURCES, TRANSACTION_STATUSES, TRANSACTION_TYPES } from '../constants';

// Secao 4.5 - schema compartilhado entre API e cliente.
export const TransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  date: z.coerce.date(),
  description: z.string(),
  merchant: z.string().nullable(),
  amountMinor: z.number().int(),
  currency: z.literal('BRL'),
  type: z.enum(TRANSACTION_TYPES),
  status: z.enum(TRANSACTION_STATUSES),
  categoryId: z.string().nullable(),
  categorySource: z.enum(CATEGORY_SOURCES).nullable(),
  /** Categoria informada pelo Pluggy (em ingles). */
  providerCategory: z.string().nullable(),
  /** Categoria do Pluto (ver CATEGORIES), derivada da do Pluggy ate o pipeline RN-10. */
  categoryKey: z.string(),
  installment: z
    .object({ n: z.number().int().positive(), total: z.number().int().positive(), groupId: z.string() })
    .nullable(),
  tags: z.array(z.string()),
  hidden: z.boolean(),
  notes: z.string().nullable(),
  /** false quando o banco so informa a data: o horario exibido nao e real (RN-D03). */
  hasTime: z.boolean().default(true),
  /** Faz parte de uma serie recorrente (assinatura, conta fixa, salario). */
  recurring: z.boolean().default(false),
  /** O banco informou quem recebeu/pagou: regras valem para o mesmo destinatario (RN-D02). */
  hasCounterparty: z.boolean().default(false),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const TransactionPageSchema = z.object({
  items: z.array(TransactionSchema),
  nextCursor: z.string().nullable(),
});
export type TransactionPage = z.infer<typeof TransactionPageSchema>;

export const TransactionSummaryQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date().optional(),
});

/** Totais do periodo. TRANSFER e CARD_PAYMENT ficam de fora (RN-13, RN-14). */
export const TransactionSummarySchema = z.object({
  incomeMinor: z.number().int(),
  expensesMinor: z.number().int(),
  count: z.number().int(),
});
export type TransactionSummary = z.infer<typeof TransactionSummarySchema>;

export const TransactionQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  accountId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  categoryId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type TransactionQuery = z.infer<typeof TransactionQuerySchema>;

const CategoryKey = z.string().refine((k) => k in CATEGORY_BY_KEY, 'Categoria inválida');

/**
 * Categoria escolhida pelo usuario (RN-12). Com applyToSimilar, vira regra: as transacoes do
 * mesmo destinatario/descricao, no mesmo sentido (entrada ou saida), passam a usar a categoria,
 * inclusive as que chegarem nas proximas sincronizacoes.
 */
export const SetCategorySchema = z.object({
  categoryKey: CategoryKey,
  applyToSimilar: z.boolean().default(false),
});
export type SetCategory = z.infer<typeof SetCategorySchema>;

export const SetCategoryResultSchema = z.object({ updated: z.number().int(), ruleId: z.string().nullable() });

/** Quantas transacoes seriam afetadas por uma regra a partir desta transacao. */
export const SimilarSchema = z.object({
  matchKey: z.string(),
  count: z.number().int(),
  /** true: a regra vale para o mesmo destinatario (CPF/CNPJ/conta), nao so para o mesmo texto. */
  byCounterparty: z.boolean().default(false),
  /** Nome exibido do destinatario/descricao. */
  label: z.string().default(''),
});

export const CategoryRuleSchema = z.object({
  id: z.string(),
  matchKey: z.string(),
  /** Nome exibido: para regras por destinatario, matchKey e um hash. */
  label: z.string(),
  byCounterparty: z.boolean().default(false),
  direction: z.enum(['in', 'out']),
  categoryKey: z.string(),
  createdAt: z.coerce.date(),
});
export type CategoryRule = z.infer<typeof CategoryRuleSchema>;
