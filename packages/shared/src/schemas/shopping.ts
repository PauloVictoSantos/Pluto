import { z } from 'zod';

// Lista de compras do mes (doc. "Lista de compras", RN-L01..L08).

export const SHOPPING_CATEGORIES = [
  { key: 'hortifruti', label: 'Hortifrúti', icon: 'apple' },
  { key: 'acougue', label: 'Açougue e peixaria', icon: 'utensils' },
  { key: 'laticinios', label: 'Laticínios e frios', icon: 'milk' },
  { key: 'padaria', label: 'Padaria', icon: 'wheat' },
  { key: 'mercearia', label: 'Mercearia', icon: 'shopping-cart' },
  { key: 'bebidas', label: 'Bebidas', icon: 'cup-soda' },
  { key: 'limpeza', label: 'Limpeza', icon: 'sparkles' },
  { key: 'higiene', label: 'Higiene', icon: 'droplet' },
  { key: 'pet', label: 'Pet', icon: 'heart' },
  { key: 'bebe', label: 'Bebê', icon: 'user' },
  { key: 'outros', label: 'Outros', icon: 'list-checks' },
] as const;
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number]['key'];
export const SHOPPING_CATEGORY_KEYS = SHOPPING_CATEGORIES.map((c) => c.key) as [ShoppingCategory, ...ShoppingCategory[]];
export const shoppingCategoryOf = (key: string) => SHOPPING_CATEGORIES.find((c) => c.key === key) ?? SHOPPING_CATEGORIES[SHOPPING_CATEGORIES.length - 1]!;

export const UNITS = ['un', 'kg', 'g', 'L', 'ml', 'pct', 'dz', 'cx'] as const;
export type Unit = (typeof UNITS)[number];

/**
 * Nome comparavel de item: minusculas, sem acento e sem espacos repetidos. "Leite Integral" e
 * "leite  integral" sao o mesmo texto; "leite integral 1L" x "leite" fica com o Gemini.
 */
export const normalizeItemName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const Name = z.string().trim().min(1, 'Digite o nome do item').max(60);
const Qty = z.number().positive().max(999);

export const ShoppingItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(SHOPPING_CATEGORY_KEYS),
  unit: z.enum(UNITS),
});
export type ShoppingItem = z.infer<typeof ShoppingItemSchema>;

export const SuggestionClassSchema = z.enum(['essential', 'maybe']);

export const ShoppingEntrySchema = ShoppingItemSchema.omit({ id: true }).extend({
  itemId: z.string(),
  qty: z.number(),
  bought: z.boolean(),
  boughtAt: z.coerce.date().nullable(),
  /** Preco pago pela linha toda (opcional, RN-L03). */
  priceMinor: z.number().int().nullable(),
  suggested: z.boolean(),
  class: SuggestionClassSchema.nullable(),
  /** O "porque" da sugestao (RN-G06). */
  reason: z.string().nullable(),
  /** Preco de referencia da linha (media movel exponencial do preco unitario x quantidade). */
  refPriceMinor: z.number().int().nullable(),
});
export type ShoppingEntry = z.infer<typeof ShoppingEntrySchema>;

export const ShoppingSuggestionSchema = ShoppingItemSchema.omit({ id: true }).extend({
  itemId: z.string(),
  qty: z.number(),
  reason: z.string(),
  /** history: historico do item; together: costuma ir junto de um item da lista; explore: Thompson sampling. */
  source: z.enum(['history', 'together', 'explore']),
});
export type ShoppingSuggestion = z.infer<typeof ShoppingSuggestionSchema>;

export const ShoppingListSchema = z.object({
  month: z.string(),
  status: z.enum(['open', 'closed']),
  /** Dias ate o fechamento automatico (dia 1, 00:05). */
  closesInDays: z.number().int(),
  entries: z.array(ShoppingEntrySchema),
  suggestions: z.array(ShoppingSuggestionSchema),
  /** "Voce costuma nao comprar": nao sao sugeridos este mes. */
  rarely: z.array(z.object({ itemId: z.string(), name: z.string(), reason: z.string() })),
  /** Faixa do que falta comprar, so com itens que tem preco (RN-M05). */
  estimate: z.object({ lowMinor: z.number().int(), highMinor: z.number().int(), pricedItems: z.number().int(), totalItems: z.number().int() }).nullable(),
  /** Inflacao pessoal da cesta (Laspeyres) desde o mes-base. */
  basket: z.object({ pct: z.number(), sinceMonth: z.string(), items: z.number().int() }).nullable(),
  /** Compra de mercado no banco: pergunta o que foi comprado (nunca marca sozinho, RN-L07). */
  marketPrompt: z.object({ transactionId: z.string(), date: z.coerce.date(), amountMinor: z.number().int(), label: z.string() }).nullable(),
  /** Meses de historico fechados (o aprendizado completo comeca no 4o). */
  closedMonths: z.number().int(),
});
export type ShoppingList = z.infer<typeof ShoppingListSchema>;

export const ResolveItemSchema = z.object({ raw: Name });
export const ResolveItemResultSchema = z.object({
  /** Item do catalogo que corresponde ao nome digitado (exato ou pelo nome proposto). */
  item: ShoppingItemSchema.nullable(),
  /** Proposta de item canonico quando o nome nao e conhecido: o usuario confirma. */
  proposal: z.object({ name: z.string(), category: z.enum(SHOPPING_CATEGORY_KEYS), unit: z.enum(UNITS) }).nullable(),
  source: z.enum(['catalog', 'gemini', 'local']),
});
export type ResolveItemResult = z.infer<typeof ResolveItemResultSchema>;

/** Adiciona por nome digitado (com o item canonico confirmado) ou por itemId (sugestao/catalogo). */
export const AddEntrySchema = z
  .object({
    raw: Name.optional(),
    itemId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
    qty: Qty.default(1),
    confirm: z.object({ name: Name, category: z.enum(SHOPPING_CATEGORY_KEYS), unit: z.enum(UNITS) }).optional(),
  })
  .refine((b) => !!b.raw !== !!b.itemId, 'Informe o nome ou o item');

export const UpdateEntrySchema = z.object({
  bought: z.boolean().optional(),
  priceMinor: z.number().int().min(0).max(10_000_000).nullable().optional(),
  qty: Qty.optional(),
  /** Remover (true) ou desfazer a remocao (false). */
  removed: z.boolean().optional(),
});

export const MarketAnswerSchema = z.object({
  transactionId: z.string().regex(/^[a-f0-9]{24}$/),
  itemIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(200),
});

export const ClosedListSchema = z.object({
  month: z.string(),
  entries: z.array(ShoppingEntrySchema),
});
export const ListHistorySchema = z.array(z.object({ month: z.string(), bought: z.number().int(), total: z.number().int() }));
export const CopyEntriesSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), itemIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(200) });
export const CatalogSchema = z.array(ShoppingItemSchema);
