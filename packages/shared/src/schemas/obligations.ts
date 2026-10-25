import { z } from 'zod';

// Dividas do mes numa lista so (doc. Melhorias, passo 5): faturas de cartao, parcelamentos, gastos
// fixos e emprestimos. A mesma lista alimenta o chat, as metas e o planejamento.

const Money = z.number().int();

export const ObligationItemSchema = z.object({
  kind: z.enum(['fatura', 'parcelamento', 'fixo', 'emprestimo']),
  name: z.string(),
  /** O que pesa neste mes. */
  monthMinor: Money,
  /** AAAA-MM-DD do vencimento (fatura) ou null quando so ha o dia. */
  dueDate: z.string().nullable(),
  dueDay: z.number().int().nullable(),
  /** Parcelamento e emprestimo: quanto falta pagar no total. */
  remainingMinor: Money.nullable(),
  /** Parcelamento: parcelas que faltam. */
  remainingInstallments: z.number().int().nullable(),
  /** Ja esta dentro de uma fatura listada (parcela ou fixo no cartao): fora do total do mes. */
  inInvoice: z.boolean(),
  overdue: z.boolean(),
});
export type ObligationItem = z.infer<typeof ObligationItemSchema>;

export const ObligationsSchema = z.object({
  month: z.string(),
  items: z.array(ObligationItemSchema),
  /** Soma do mes sem contar duas vezes o que ja esta na fatura. */
  monthTotalMinor: Money,
  byKind: z.object({ fatura: Money, parcelamento: Money, fixo: Money, emprestimo: Money }),
  /** Saldo devedor total de parcelamentos e emprestimos. */
  remainingTotalMinor: Money,
});
export type Obligations = z.infer<typeof ObligationsSchema>;
