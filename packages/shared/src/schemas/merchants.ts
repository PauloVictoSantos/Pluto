import { z } from 'zod';
import { CATEGORY_BY_KEY } from '../categories';

// Estabelecimentos agrupados: descricoes diferentes do mesmo lugar ("UBER *TRIP SP", "UBER TRIP HELP")
// viram um grupo ("Uber") com uma categoria. A IA propoe; o usuario edita, junta e separa.

export const MerchantGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryKey: z.string().nullable(),
  /** ai: proposto pela IA (pode mudar); user: editado pelo usuario (vale como regra dele). */
  source: z.enum(['ai', 'user']),
  /** Descricoes (normalizadas) que pertencem ao grupo. */
  keys: z.array(z.string()),
  transactions: z.number().int(),
});
export type MerchantGroup = z.infer<typeof MerchantGroupSchema>;

export const MerchantGroupsSchema = z.object({
  groups: z.array(MerchantGroupSchema),
  /** IA ligada (chave do Gemini e "IA" nas configuracoes). */
  aiAvailable: z.boolean(),
  /** Descricoes de estabelecimento ainda sem grupo. */
  ungrouped: z.number().int(),
});

const SpendCategory = z.string().refine((k) => ['essential', 'lifestyle'].includes(CATEGORY_BY_KEY[k]?.group ?? ''), 'Escolha uma categoria de gasto');

export const UpdateMerchantGroupSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  categoryKey: SpendCategory.nullable().optional(),
});
export const MergeMerchantGroupSchema = z.object({ intoId: z.string().regex(/^[a-f0-9]{24}$/) });
export const RemoveMerchantKeySchema = z.object({ key: z.string().min(1).max(200) });
