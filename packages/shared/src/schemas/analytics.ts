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
