import { z } from 'zod';

// Cobrancas por boleto (Stripe). Cada parcela vira um boleto registrado; o destino diz o que
// fazer com o dinheiro quando ela for paga.

export const CHARGE_DESTINATIONS = ['GOAL', 'INVESTMENT', 'CHARGE'] as const;
export type ChargeDestination = (typeof CHARGE_DESTINATIONS)[number];

/**
 * SCHEDULED: vence daqui a mais de 60 dias (limite do boleto no Stripe); e emitida depois.
 * OPEN: boleto emitido, aguardando pagamento. PAID: pago. EXPIRED: venceu sem pagamento.
 * CANCELED: cancelada pelo usuario. FAILED: o Stripe recusou a emissao.
 */
export const INSTALLMENT_STATUSES = ['SCHEDULED', 'OPEN', 'PAID', 'EXPIRED', 'CANCELED', 'FAILED'] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

/** Boleto vence em ate 60 dias a partir da emissao (regra do Stripe). */
export const BOLETO_MAX_DAYS = 60;

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const digits = (s: string) => s.replace(/\D/g, '');

export const PayerSchema = z.object({
  name: z.string().trim().min(3, 'Informe o nome completo').max(120),
  /** CPF (11) ou CNPJ (14) so com digitos. */
  taxId: z
    .string()
    .transform(digits)
    .refine((v) => v.length === 11 || v.length === 14, 'CPF ou CNPJ inválido'),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(254),
  phone: z.string().trim().max(30).nullable().default(null),
  address: z.object({
    postalCode: z
      .string()
      .transform(digits)
      .refine((v) => v.length === 8, 'CEP inválido'),
    line1: z.string().trim().min(3, 'Informe rua e número').max(140),
    city: z.string().trim().min(2, 'Informe a cidade').max(80),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'UF com 2 letras'),
  }),
});
export type Payer = z.infer<typeof PayerSchema>;

export const CreateChargeSchema = z
  .object({
    destination: z.enum(CHARGE_DESTINATIONS),
    goalId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null),
    description: z.string().trim().max(120).default(''),
    payer: PayerSchema,
    totalMinor: z.number().int().min(500, 'Mínimo de R$ 5,00').max(100_000_000),
    installments: z.number().int().min(1).max(12),
    firstDueDate: Ymd,
  })
  .refine((c) => c.destination !== 'GOAL' || !!c.goalId, { message: 'Escolha a meta', path: ['goalId'] })
  .refine((c) => Math.floor(c.totalMinor / c.installments) >= 500, { message: 'Cada parcela precisa ter pelo menos R$ 5,00', path: ['installments'] });
export type CreateCharge = z.infer<typeof CreateChargeSchema>;

export const InstallmentSchema = z.object({
  n: z.number().int(),
  amountMinor: z.number().int(),
  dueDate: Ymd,
  status: z.enum(INSTALLMENT_STATUSES),
  /** Linha digitavel (47 digitos). */
  number: z.string().nullable(),
  pdfUrl: z.string().nullable(),
  voucherUrl: z.string().nullable(),
  /** Quando uma parcela SCHEDULED sera emitida. */
  issueOn: Ymd.nullable(),
  paidAt: z.coerce.date().nullable(),
  /** BOLETO: pago no banco. MANUAL: voce encerrou o boleto dizendo que recebeu por fora (Pix, dinheiro). */
  paidVia: z.enum(['BOLETO', 'MANUAL']).nullable(),
  /** Ultimo envio do boleto por e-mail (Resend). */
  sentAt: z.coerce.date().nullable(),
  /** O pagador foi avisado por e-mail de que o boleto foi cancelado. */
  cancelNotifiedAt: z.coerce.date().nullable(),
  error: z.string().nullable(),
});
export type Installment = z.infer<typeof InstallmentSchema>;

export const ChargeSchema = z.object({
  id: z.string(),
  destination: z.enum(CHARGE_DESTINATIONS),
  goalId: z.string().nullable(),
  goalName: z.string().nullable(),
  description: z.string(),
  payerName: z.string(),
  payerEmail: z.string(),
  payerPhone: z.string().nullable(),
  totalMinor: z.number().int(),
  paidMinor: z.number().int(),
  installments: z.array(InstallmentSchema),
  createdAt: z.coerce.date(),
});
export type Charge = z.infer<typeof ChargeSchema>;

/**
 * Encerrar uma parcela antes do pagamento pelo banco:
 * CANCEL: nao vai ser paga (o boleto e invalidado no Stripe).
 * RECEIVED: foi paga por fora; o boleto e invalidado e a parcela conta como paga (entra na meta).
 */
export const CloseInstallmentSchema = z.object({ outcome: z.enum(['CANCEL', 'RECEIVED']) });

/** Linha digitavel (47) -> codigo de barras (44), para desenhar o boleto. */
export function boletoBarcode(line: string): string | null {
  const l = digits(line);
  if (l.length !== 47) return null;
  return l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
}

/** "00190.00009 01234.567890 ..." para exibir. */
export function formatBoletoLine(line: string): string {
  const l = digits(line);
  if (l.length !== 47) return line;
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}
