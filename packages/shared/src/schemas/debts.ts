import { z } from 'zod';
import { CATEGORY_BY_KEY } from '../categories';

// Dividas manuais: compras parceladas e mensalidades pagas por uma forma de pagamento que o Open Finance
// nao ve (ex.: cartao de um parente, pago a ele por boleto). Todo mes vira um boleto em Contas a pagar.

export const DEBT_METHODS = ['third_party_card', 'boleto', 'pix'] as const;
export type DebtMethod = (typeof DEBT_METHODS)[number];
export const COMMITMENT_KINDS = ['installments', 'monthly'] as const;

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM');
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const Text = (max: number) => z.string().trim().max(max);
/** So categorias de gasto: fatura, transferencia e investimento nao sao compra. */
const ExpenseCategory = z.string().refine((k) => {
  const g = CATEGORY_BY_KEY[k]?.group;
  return g === 'essential' || g === 'lifestyle';
}, 'Escolha uma categoria de gasto');

/** Valor da parcela n de N para um total em centavos: a diferenca de arredondamento vai na 1a. */
export function installmentAmount(totalMinor: number, installments: number, n: number): number {
  const base = Math.floor(totalMinor / installments);
  return n === 1 ? totalMinor - base * (installments - 1) : base;
}

const monthIndex = (m: string) => +m.slice(0, 4) * 12 + +m.slice(5) - 1;

/** Parcela (ou mensalidade) que cai no mes, ou null se nao cai. */
export function scheduleIn(
  c: { kind: 'installments' | 'monthly'; firstMonth: string; installments: number | null; totalMinor: number | null; monthlyMinor: number | null; lastMonth: string | null },
  month: string,
): { n: number | null; total: number | null; amountMinor: number } | null {
  const i = monthIndex(month) - monthIndex(c.firstMonth);
  if (i < 0) return null;
  if (c.kind === 'installments') {
    if (!c.installments || !c.totalMinor || i >= c.installments) return null;
    return { n: i + 1, total: c.installments, amountMinor: installmentAmount(c.totalMinor, c.installments, i + 1) };
  }
  if (c.lastMonth && month > c.lastMonth) return null;
  return { n: null, total: null, amountMinor: c.monthlyMinor ?? 0 };
}

export const CommitmentSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  merchant: z.string(),
  categoryKey: z.string(),
  approvedAt: z.string(),
  kind: z.enum(COMMITMENT_KINDS),
  totalMinor: z.number().int().nullable(),
  installments: z.number().int().nullable(),
  monthlyMinor: z.number().int().nullable(),
  firstMonth: z.string(),
  lastMonth: z.string().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  /** Parcela deste mes (null: nao cai neste mes). */
  current: z.object({ n: z.number().int().nullable(), total: z.number().int().nullable(), amountMinor: z.number().int() }).nullable(),
  /** Quanto ainda falta pagar (parcelado), contando o mes atual. */
  remainingMinor: z.number().int().nullable(),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

export const DebtSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  method: z.enum(DEBT_METHODS),
  holder: z.string().nullable(),
  bank: z.string().nullable(),
  cardProduct: z.string().nullable(),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  /** Dia do mes em que voce paga (vencimento do boleto). */
  dueDay: z.number().int(),
  notes: z.string().nullable(),
  items: z.array(CommitmentSchema),
  /** Total deste mes. */
  monthTotalMinor: z.number().int(),
});
export type DebtSource = z.infer<typeof DebtSourceSchema>;

export const CreateDebtSourceSchema = z.object({
  name: Text(60).min(1, 'Dê um nome, ex.: Cartão da Melry'),
  method: z.enum(DEBT_METHODS),
  holder: Text(60).optional(),
  bank: Text(40).optional(),
  cardProduct: Text(40).optional(),
  brand: Text(20).optional(),
  /** So os 4 ultimos digitos (secao 6.6): nunca o numero inteiro. */
  last4: z.string().regex(/^\d{4}$/, 'Só os 4 últimos dígitos').optional(),
  dueDay: z.number().int().min(1).max(31),
  notes: Text(200).optional(),
});
export const UpdateDebtSourceSchema = CreateDebtSourceSchema.partial();

export const CreateCommitmentSchema = z
  .object({
    sourceId: z.string().regex(/^[a-f0-9]{24}$/),
    merchant: Text(60).min(1, 'Onde foi a compra?'),
    categoryKey: ExpenseCategory,
    approvedAt: Day,
    kind: z.enum(COMMITMENT_KINDS),
    totalMinor: z.number().int().positive().max(1e10).optional(),
    installments: z.number().int().min(1).max(120).optional(),
    monthlyMinor: z.number().int().positive().max(1e10).optional(),
    firstMonth: Month,
    lastMonth: Month.optional(),
    notes: Text(200).optional(),
  })
  .refine((c) => (c.kind === 'installments' ? !!c.totalMinor && !!c.installments : !!c.monthlyMinor), {
    message: 'Parcelado pede valor total e número de parcelas; mensalidade pede o valor do mês',
  })
  .refine((c) => !c.lastMonth || c.lastMonth >= c.firstMonth, { message: 'O último mês vem depois do primeiro', path: ['lastMonth'] });

export const UpdateCommitmentSchema = z.object({
  merchant: Text(60).min(1).optional(),
  categoryKey: ExpenseCategory.optional(),
  notes: Text(200).optional(),
  lastMonth: Month.nullable().optional(),
  /** false: encerra (deixa de cair nos proximos boletos; o historico fica). */
  active: z.boolean().optional(),
});
