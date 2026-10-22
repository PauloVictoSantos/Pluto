import { HIGH_INTEREST_MONTHLY, balanceAfter, debtPayoff, extraPaymentEffect, impliedMonthlyRate, payoffOrder, type DebtTerms } from '@pluto/finance-engine';
import { loanTermsError, type CreateLoan, type Loan, type UpdateLoan } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { LoanDoc } from '../../db/collections';
import { AppError, notFound } from '../../lib/errors';
import { addMonth, monthOf } from '../../lib/time';
import { readProfile, suggestIncome } from './profile';

// Dividas com juros (doc. Pluton, tabela debts). Todo numero vem do motor (finance-engine); o saldo
// informado envelhece mes a mes pela amortizacao ate o usuario atualizar.

const tzOf = async (ctx: AppContext, userId: ObjectId) =>
  (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
const monthIndex = (m: string) => +m.slice(0, 4) * 12 + +m.slice(5) - 1;

/** Valores atuais da divida: saldo e parcelas restantes projetados ate `month`. */
function current(ctx: AppContext, d: LoanDoc, month: string) {
  const balance = Number(ctx.crypto.decrypt(d.balanceEnc));
  const installmentMinor = d.installmentEnc ? Number(ctx.crypto.decrypt(d.installmentEnc)) : null;
  const rateInferred = d.monthlyRate === null;
  const monthlyRate = d.monthlyRate ?? (installmentMinor && d.installmentsLeft ? (impliedMonthlyRate(balance, installmentMinor, d.installmentsLeft) ?? 0) : 0);
  const elapsed = Math.max(0, monthIndex(month) - monthIndex(d.balanceAsOf));
  const terms: DebtTerms = { balanceMinor: balance, monthlyRate, installmentMinor };
  return {
    terms: { ...terms, balanceMinor: balanceAfter(terms, elapsed) },
    installmentsLeft: d.installmentsLeft === null ? null : Math.max(0, d.installmentsLeft - elapsed),
    rateInferred,
  };
}

export async function listLoans(ctx: AppContext, userId: ObjectId, now = new Date()) {
  const month = monthOf(now, await tzOf(ctx, userId));
  const docs = await ctx.col.loans.find({ userId, deletedAt: null }).sort({ createdAt: 1 }).toArray();
  const rows = docs.map((d) => ({ d, id: d._id.toHexString(), ...current(ctx, d, month) }));
  const rank = new Map(payoffOrder(rows.filter((r) => r.terms.balanceMinor > 0).map((r) => ({ ...r.terms, id: r.id }))).map((r, i) => [r.id, i + 1]));
  const items: Loan[] = rows.map(({ d, id, terms, installmentsLeft, rateInferred }) => {
    const p = debtPayoff(terms);
    return {
      id,
      creditor: d.creditor,
      kind: d.kind,
      balanceMinor: terms.balanceMinor,
      balanceAsOf: d.balanceAsOf,
      monthlyRate: Math.round(terms.monthlyRate * 1e6) / 1e6,
      rateInferred,
      installmentMinor: terms.installmentMinor,
      installmentsLeft,
      dueDay: d.dueDay,
      payoffMonths: p.months,
      totalInterestMinor: p.totalInterestMinor,
      monthlyInterestMinor: p.monthlyInterestMinor,
      endsOn: p.months ? addMonth(month, p.months - 1) : null,
      highInterest: terms.monthlyRate > HIGH_INTEREST_MONTHLY,
      payoffRank: rank.get(id) ?? 0,
    };
  });
  const open = items.filter((l) => l.balanceMinor > 0);
  const monthlyInstallmentsMinor = open.reduce((t, l) => t + (l.installmentMinor ?? 0), 0);
  const { profile } = await readProfile(ctx, userId);
  const incomeMinor = profile.netIncomeMinor ?? (await suggestIncome(ctx, userId, now));
  return {
    items: items.sort((a, b) => (a.payoffRank || 999) - (b.payoffRank || 999)),
    balanceMinor: open.reduce((t, l) => t + l.balanceMinor, 0),
    monthlyInstallmentsMinor,
    totalInterestMinor: open.reduce((t, l) => t + (l.totalInterestMinor ?? 0), 0),
    monthlyInterestMinor: open.reduce((t, l) => t + l.monthlyInterestMinor, 0),
    incomeShare: incomeMinor ? Math.round((monthlyInstallmentsMinor / incomeMinor) * 1000) / 1000 : null,
  };
}

/** O que vai para a auditoria: nada de saldo ou parcela. */
const auditView = (d: Pick<LoanDoc, 'creditor' | 'kind' | 'monthlyRate' | 'installmentsLeft' | 'dueDay'>) => ({
  creditor: d.creditor,
  kind: d.kind,
  monthlyRate: d.monthlyRate,
  installmentsLeft: d.installmentsLeft,
  dueDay: d.dueDay,
});

const checkTerms = (b: Parameters<typeof loanTermsError>[0]) => {
  const e = loanTermsError(b);
  if (e) throw new AppError(400, 'LOAN_TERMS', e);
};

export async function createLoan(ctx: AppContext, userId: ObjectId, b: CreateLoan) {
  checkTerms(b);
  const now = new Date();
  const doc: LoanDoc = {
    _id: new ObjectId(),
    userId,
    creditor: b.creditor,
    kind: b.kind,
    balanceEnc: ctx.crypto.encrypt(String(b.balanceMinor)),
    balanceAsOf: monthOf(now, await tzOf(ctx, userId)),
    monthlyRate: b.monthlyRate ?? null,
    installmentEnc: b.installmentMinor ? ctx.crypto.encrypt(String(b.installmentMinor)) : null,
    installmentsLeft: b.installmentsLeft ?? null,
    dueDay: b.dueDay,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await ctx.col.loans.insertOne(doc);
  return auditView(doc);
}

const own = async (ctx: AppContext, userId: ObjectId, id: string) => {
  const d = await ctx.col.loans.findOne({ _id: new ObjectId(id), userId, deletedAt: null });
  if (!d) throw notFound('Dívida');
  return d;
};

/** Atualizar "zera o relogio": o saldo projetado de hoje vira o novo saldo informado. */
export async function updateLoan(ctx: AppContext, userId: ObjectId, id: string, b: UpdateLoan) {
  const before = await own(ctx, userId, id);
  const month = monthOf(new Date(), await tzOf(ctx, userId));
  const cur = current(ctx, before, month);
  const next = {
    creditor: b.creditor ?? before.creditor,
    kind: b.kind ?? before.kind,
    balanceMinor: b.balanceMinor ?? cur.terms.balanceMinor,
    monthlyRate: b.monthlyRate !== undefined ? b.monthlyRate : before.monthlyRate,
    installmentMinor: b.installmentMinor !== undefined ? b.installmentMinor : cur.terms.installmentMinor,
    installmentsLeft: b.installmentsLeft !== undefined ? b.installmentsLeft : cur.installmentsLeft || null,
    dueDay: b.dueDay ?? before.dueDay,
  };
  checkTerms(next);
  await ctx.col.loans.updateOne(
    { _id: before._id },
    {
      $set: {
        creditor: next.creditor,
        kind: next.kind,
        balanceEnc: ctx.crypto.encrypt(String(next.balanceMinor)),
        balanceAsOf: month,
        monthlyRate: next.monthlyRate ?? null,
        installmentEnc: next.installmentMinor ? ctx.crypto.encrypt(String(next.installmentMinor)) : null,
        installmentsLeft: next.installmentsLeft ?? null,
        dueDay: next.dueDay,
        updatedAt: new Date(),
      },
    },
  );
  return { before: auditView(before), after: auditView({ ...next, monthlyRate: next.monthlyRate ?? null, installmentsLeft: next.installmentsLeft ?? null }), balanceChanged: b.balanceMinor !== undefined };
}

export async function removeLoan(ctx: AppContext, userId: ObjectId, id: string) {
  const d = await own(ctx, userId, id);
  await ctx.col.loans.updateOne({ _id: d._id }, { $set: { deletedAt: new Date() } });
  return auditView(d);
}

export async function loanExtra(ctx: AppContext, userId: ObjectId, id: string, amountMinor: number) {
  const d = await own(ctx, userId, id);
  const { terms } = current(ctx, d, monthOf(new Date(), await tzOf(ctx, userId)));
  return extraPaymentEffect(terms, amountMinor);
}
