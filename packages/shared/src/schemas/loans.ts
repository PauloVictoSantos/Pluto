import { z } from 'zod';

// Dividas com juros do agente Plutao (doc. Pluton, tabela debts): emprestimo, financiamento,
// rotativo, cheque especial. Diferente de Contas a pagar (compras parceladas sem juros).
// Saldo e parcela ficam criptografados no banco.

export const LOAN_KINDS = ['emprestimo', 'financiamento', 'cartao-rotativo', 'cheque-especial', 'outro'] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];
export const LOAN_KIND_LABEL: Record<LoanKind, string> = {
  emprestimo: 'Empréstimo',
  financiamento: 'Financiamento',
  'cartao-rotativo': 'Rotativo do cartão',
  'cheque-especial': 'Cheque especial',
  outro: 'Outra dívida',
};

export const LoanSchema = z.object({
  id: z.string(),
  creditor: z.string(),
  kind: z.enum(LOAN_KINDS),
  /** Saldo estimado hoje (o informado, menos as parcelas pagas desde entao). */
  balanceMinor: z.number().int(),
  /** Mes (AAAA-MM) em que o usuario informou o saldo. */
  balanceAsOf: z.string(),
  monthlyRate: z.number(),
  /** A taxa foi calculada a partir da parcela e do prazo (o usuario nao informou). */
  rateInferred: z.boolean(),
  installmentMinor: z.number().int().nullable(),
  installmentsLeft: z.number().int().nullable(),
  dueDay: z.number().int(),
  /** Meses ate quitar no ritmo atual; null = a parcela nao cobre os juros. */
  payoffMonths: z.number().int().nullable(),
  totalInterestMinor: z.number().int().nullable(),
  monthlyInterestMinor: z.number().int(),
  /** Ultimo mes de pagamento previsto. */
  endsOn: z.string().nullable(),
  /** Acima de 2% a.m. (MT-07): vem antes de qualquer meta de compra. */
  highInterest: z.boolean(),
  /** Posicao na ordem de quitacao (maior taxa primeiro), comecando em 1. */
  payoffRank: z.number().int(),
});
export type Loan = z.infer<typeof LoanSchema>;

export const LoansSchema = z.object({
  items: z.array(LoanSchema),
  balanceMinor: z.number().int(),
  monthlyInstallmentsMinor: z.number().int(),
  /** Juros que ainda serao pagos nas dividas com fim previsto. */
  totalInterestMinor: z.number().int(),
  /** Juros do mes somados (inclui as sem fim previsto). */
  monthlyInterestMinor: z.number().int(),
  /** Parcelas / renda (indicador de endividamento, saudavel <= 30%); null sem renda. */
  incomeShare: z.number().nullable(),
});

const Rate = z.number().min(0).max(0.5);

const LoanFields = z.object({
  creditor: z.string().trim().min(1, 'Com quem é a dívida?').max(60),
  kind: z.enum(LOAN_KINDS),
  balanceMinor: z.number().int().positive('Informe quanto falta pagar').max(1e11),
  /** Taxa ao mes (0,035 = 3,5%); opcional se houver parcela e prazo. */
  monthlyRate: Rate.nullable().optional(),
  installmentMinor: z.number().int().positive().max(1e10).nullable().optional(),
  installmentsLeft: z.number().int().min(1).max(600).nullable().optional(),
  dueDay: z.number().int().min(1).max(31),
});

/** Sem taxa, so da para calcular com parcela e prazo. */
export function loanTermsError(b: { monthlyRate?: number | null; installmentMinor?: number | null; installmentsLeft?: number | null }): string | null {
  if (b.monthlyRate == null && !(b.installmentMinor && b.installmentsLeft)) return 'Informe a taxa de juros ou a parcela e quantas faltam';
  return null;
}

export const CreateLoanSchema = LoanFields.superRefine((b, ctx) => {
  const e = loanTermsError(b);
  if (e) ctx.addIssue({ code: 'custom', path: ['monthlyRate'], message: e });
});
export type CreateLoan = z.input<typeof CreateLoanSchema>;

export const UpdateLoanSchema = LoanFields.partial().refine((b) => Object.keys(b).length > 0, 'Nada para atualizar');
export type UpdateLoan = z.input<typeof UpdateLoanSchema>;

export const LoanExtraQuerySchema = z.object({ amountMinor: z.coerce.number().int().positive().max(1e11) });
export const LoanExtraSchema = z.object({
  /** Juros evitados ate o fim; null se a divida nao tem fim previsto. */
  interestSavedMinor: z.number().int().nullable(),
  monthsSaved: z.number().int().nullable(),
  /** Juros a menos ja no proximo mes. */
  monthlyInterestSavedMinor: z.number().int(),
});
