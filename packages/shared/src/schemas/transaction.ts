import { z } from 'zod';
import { CATEGORY_SOURCES, TRANSACTION_STATUSES, TRANSACTION_TYPES } from '../constants';

// Secao 4.5 - schema compartilhado entre API e cliente.
export const TransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  date: z.coerce.date(),
  description: z.string(),
  amountMinor: z.number().int(),
  currency: z.literal('BRL'),
  type: z.enum(TRANSACTION_TYPES),
  categoryId: z.string().nullable(),
  categorySource: z.enum(CATEGORY_SOURCES).nullable(),
  status: z.enum(TRANSACTION_STATUSES),
  installment: z
    .object({ n: z.number().int().positive(), total: z.number().int().positive(), groupId: z.string() })
    .nullable(),
});
export type Transaction = z.infer<typeof TransactionSchema>;
