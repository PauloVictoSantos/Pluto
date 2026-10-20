import { z } from 'zod';

// Boletos a pagar (doc. "Metas e boletos", RN-M03): cadastro manual ou pela linha digitavel.

export const BILL_STATUSES = ['pending', 'paid', 'overdue'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Digito verificador modulo 10 (campos da linha digitavel). */
function mod10(num: string): number {
  let sum = 0;
  for (let i = num.length - 1, w = 2; i >= 0; i--, w = w === 2 ? 1 : 2) {
    const p = Number(num[i]) * w;
    sum += p > 9 ? p - 9 : p;
  }
  return (10 - (sum % 10)) % 10;
}

/** Base do fator de vencimento desde 22/02/2025 (fator 1000), quando o fator antigo chegou a 9999. */
const FACTOR_BASE = Date.UTC(2025, 1, 22);

/**
 * Le a linha digitavel. Boleto bancario (47 digitos): valor e vencimento. Arrecadacao/convenio
 * (48 digitos, contas de consumo e tributos): so o valor. null se a linha nao for valida.
 */
export function parseBoletoLine(line: string): { amountMinor: number | null; dueDate: string | null; kind: 'bank' | 'utility' } | null {
  const l = digitsOf(line);
  if (l.length === 47) {
    // Os 3 primeiros campos tem DV modulo 10: pega erro de digitacao.
    if (mod10(l.slice(0, 9)) !== +l[9]! || mod10(l.slice(10, 20)) !== +l[20]! || mod10(l.slice(21, 31)) !== +l[31]!) return null;
    const factor = +l.slice(33, 37), value = +l.slice(37, 47);
    const dueDate = factor >= 1000 ? new Date(FACTOR_BASE + (factor - 1000) * 86_400_000).toISOString().slice(0, 10) : null;
    return { amountMinor: value || null, dueDate, kind: 'bank' };
  }
  if (l.length === 48 && l[0] === '8') {
    // 4 blocos de 11 digitos + DV; o valor fica nas posicoes 4-14 do codigo de barras.
    const bar = l.slice(0, 11) + l.slice(12, 23) + l.slice(24, 35) + l.slice(36, 47);
    const effective = bar[2] === '6' || bar[2] === '7';
    return { amountMinor: effective ? +bar.slice(4, 15) || null : null, dueDate: null, kind: 'utility' };
  }
  return null;
}

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');

export const BillSchema = z.object({
  id: z.string(),
  payee: z.string(),
  amountMinor: z.number().int(),
  dueDate: z.string(),
  status: z.enum(BILL_STATUSES),
  line: z.string().nullable(),
  /** Multa (ex.: 0,02) e juros de mora ao mes (ex.: 0,01) usados no custo do atraso. */
  fine: z.number(),
  monthlyInterest: z.number(),
  paidAt: z.coerce.date().nullable(),
  /** Pago por conciliacao com uma transacao confirmada pelo usuario. */
  paidTransactionId: z.string().nullable(),
  /** Boleto gerado por uma divida manual: as compras que compoem o valor do mes. */
  sourceId: z.string().nullable().default(null),
  items: z
    .array(z.object({ label: z.string(), categoryKey: z.string(), amountMinor: z.number().int(), n: z.number().int().nullable(), total: z.number().int().nullable() }))
    .default([]),
  /** Transacao do banco que parece ser o pagamento (mesmo valor, data proxima): o usuario confirma. */
  match: z.object({ transactionId: z.string(), date: z.coerce.date(), label: z.string() }).nullable(),
});
export type Bill = z.infer<typeof BillSchema>;

export const CreateBillSchema = z
  .object({
    payee: z.string().trim().min(1, 'Para quem é o boleto?').max(80),
    line: z.string().trim().max(80).optional(),
    amountMinor: z.number().int().positive().max(1e12).optional(),
    dueDate: Day.optional(),
    fine: z.number().min(0).max(0.2).default(0.02),
    monthlyInterest: z.number().min(0).max(0.2).default(0.01),
  })
  .refine((b) => !b.line || parseBoletoLine(b.line), { message: 'Linha digitável inválida. Confira os números.', path: ['line'] });

export const UpdateBillSchema = z.object({
  /** Pago so por acao do usuario ou conciliacao confirmada (RN-M03). */
  status: z.enum(['paid', 'pending']).optional(),
  transactionId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  payee: z.string().trim().min(1).max(80).optional(),
  amountMinor: z.number().int().positive().max(1e12).optional(),
  dueDate: Day.optional(),
});
