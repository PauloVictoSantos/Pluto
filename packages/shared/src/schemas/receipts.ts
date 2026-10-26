import { z } from 'zod';

// Scanner de cupom fiscal (doc. Melhorias, passo 10): primeiro o QR Code da NFC-e (itens oficiais
// na SEFAZ); sem QR legivel, a foto vai para a IA com visao (so com consentimento). A imagem nunca e
// salva: so os dados confirmados pelo usuario.

const Money = z.number().int().min(0).max(100_000_000);

export const ReceiptItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  qty: z.number().positive().max(9999),
  unitPriceMinor: Money,
  totalMinor: Money,
});
export type ReceiptItem = z.infer<typeof ReceiptItemSchema>;

export const ReceiptDraftSchema = z.object({
  store: z.string().trim().max(80).nullable(),
  /** AAAA-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  items: z.array(ReceiptItemSchema).max(300),
  totalMinor: Money,
  source: z.enum(['sefaz', 'ia']),
  /** Chave de acesso da NFC-e (44 digitos), quando veio do QR: evita importar o mesmo cupom duas vezes. */
  accessKey: z.string().regex(/^\d{44}$/).nullable(),
});
export type ReceiptDraft = z.infer<typeof ReceiptDraftSchema>;

/** Leitura: o texto do QR (URL da NFC-e) ou, sem QR, a foto (base64, so em memoria). */
export const ScanReceiptSchema = z
  .object({
    qr: z.string().trim().min(10).max(1000).optional(),
    image: z.object({ mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), base64: z.string().min(100).max(4_000_000) }).optional(),
  })
  .refine((b) => !!b.qr !== !!b.image, 'Envie o QR Code ou a foto');

export const ReceiptSchema = ReceiptDraftSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  /** Transacao do banco ligada a esta compra (null ate ela chegar pelo Open Finance). */
  transactionId: z.string().nullable(),
  /** Itens da lista de compras riscados por este cupom. */
  checkedOff: z.array(z.string()),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const ShoppingInsightSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  /** A cada quantos dias costuma comprar (null com uma compra so). */
  everyDays: z.number().int().nullable(),
  lastDaysAgo: z.number().int(),
  /** Hora de comprar de novo (passou ~90% do intervalo). */
  due: z.boolean(),
  avgUnitPriceMinor: z.number().int(),
  cheapest: z.object({ store: z.string(), unitPriceMinor: z.number().int() }).nullable(),
  purchases: z.number().int(),
});
export const ShoppingInsightsSchema = z.array(ShoppingInsightSchema);
export type ShoppingInsight = z.infer<typeof ShoppingInsightSchema>;
