import { remainingInstallments } from '@pluto/finance-engine';
import type { ObligationItem, Obligations } from '@pluto/shared';
import type { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import { monthOf, tzOffsetMs } from '../../lib/time';
import { listFixed } from './fixed';
import { listLoans } from './loans';

// Dividas do mes numa lista so (doc. Melhorias, passo 5): faturas de cartao + parcelamentos +
// gastos fixos + emprestimos. Chat, metas e planejamento leem daqui, entao mostram o mesmo numero.
// O que ja esta dentro de uma fatura (parcela no cartao, fixo pago no cartao) aparece na lista, mas
// nao soma de novo no total do mes.

const DAY = 86_400_000;
const ymdIn = (d: Date, tz: string) => new Date(d.getTime() + tzOffsetMs(d, tz)).toISOString().slice(0, 10);

export async function listObligations(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<Obligations> {
  const tz = (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
  const month = monthOf(now, tz), today = ymdIn(now, tz);
  const items: ObligationItem[] = [];
  const base = { dueDate: null, dueDay: null, remainingMinor: null, remainingInstallments: null, inInvoice: false, overdue: false };

  // 1. Faturas de cartao em aberto (vencidas ha ate 40 dias ou vencendo nos proximos 40).
  const cards = await ctx.col.accounts.find({ userId, type: 'CREDIT_CARD' }).toArray();
  const cardIds = new Set(cards.map((c) => c._id.toHexString()));
  const invoices = await ctx.col.invoices
    .find({ userId, status: { $ne: 'PAID' }, dueDate: { $gte: new Date(now.getTime() - 40 * DAY), $lt: new Date(now.getTime() + 40 * DAY) } })
    .sort({ dueDate: 1 })
    .toArray();
  for (const card of cards) {
    const open = invoices.filter((i) => i.accountId.equals(card._id) && i.totalMinor > i.paidMinor);
    for (const i of open) {
      const due = ymdIn(i.dueDate, tz);
      items.push({ ...base, kind: 'fatura', name: `Fatura ${card.name}`, monthMinor: i.totalMinor - i.paidMinor, dueDate: due, dueDay: +due.slice(8), overdue: due < today });
    }
    // Sem fatura fechada no Pluggy: vale o que ja foi gasto no cartao (fatura atual).
    if (!open.length && card.balanceMinor > 0) items.push({ ...base, kind: 'fatura', name: `Fatura ${card.name}`, monthMinor: card.balanceMinor, dueDay: card.dueDay });
  }

  // 2. Parcelamentos vistos no extrato (ultima parcela de cada compra nos ultimos 70 dias).
  const inst = await ctx.col.transactions
    .aggregate<{ _id: string; n: number; total: number; amountMinor: number; label: string; accountId: ObjectId }>([
      { $match: { userId, deletedAt: null, 'installment.groupId': { $exists: true }, date: { $gte: new Date(now.getTime() - 70 * DAY) } } },
      { $sort: { 'installment.n': -1, date: -1 } },
      { $group: { _id: '$installment.groupId', n: { $first: '$installment.n' }, total: { $first: '$installment.total' }, amountMinor: { $first: '$amountMinor' }, label: { $first: { $ifNull: ['$merchant', '$description'] } }, accountId: { $first: '$accountId' } } },
    ])
    .toArray();
  for (const i of inst) {
    const left = remainingInstallments(i), parcel = Math.abs(i.amountMinor);
    if (left <= 0) continue;
    items.push({ ...base, kind: 'parcelamento', name: i.label, monthMinor: parcel, remainingMinor: parcel * left, remainingInstallments: left, inInvoice: cardIds.has(i.accountId.toHexString()) });
  }

  // 3. Gastos fixos e Contas a pagar (parcelas de terceiros); 4. emprestimos com juros.
  const [fixed, loans] = await Promise.all([listFixed(ctx, userId, now), listLoans(ctx, userId, now)]);
  const onCard = new Set((await ctx.col.recurrences.find({ userId, onCard: true }, { projection: { key: 1 } }).toArray()).map((r) => r.key));
  for (const f of fixed.items) {
    if (f.id.startsWith('juros:')) continue; // vem de listLoans, com saldo e juros
    const third = f.source === 'divida';
    items.push({
      ...base,
      kind: third ? 'parcelamento' : 'fixo',
      name: f.name,
      monthMinor: f.monthlyMinor,
      dueDay: f.recurrence === 'weekly' ? null : f.dueDay,
      remainingInstallments: f.installment ? Math.max(0, f.installment.total - f.installment.n) : null,
      remainingMinor: f.installment ? Math.max(0, f.installment.total - f.installment.n + 1) * f.monthlyMinor : null,
      inInvoice: !!f.matchKey && onCard.has(f.matchKey),
    });
  }
  for (const l of loans.items.filter((x) => x.balanceMinor > 0))
    items.push({ ...base, kind: 'emprestimo', name: l.creditor, monthMinor: l.installmentMinor ?? 0, dueDay: l.dueDay, remainingMinor: l.balanceMinor });

  const counted = items.filter((i) => !i.inInvoice);
  const sum = (k: ObligationItem['kind']) => counted.filter((i) => i.kind === k).reduce((t, i) => t + i.monthMinor, 0);
  const byKind = { fatura: sum('fatura'), parcelamento: sum('parcelamento'), fixo: sum('fixo'), emprestimo: sum('emprestimo') };
  return {
    month,
    items,
    monthTotalMinor: byKind.fatura + byKind.parcelamento + byKind.fixo + byKind.emprestimo,
    byKind,
    remainingTotalMinor: items.reduce((t, i) => t + (i.remainingMinor ?? 0), 0),
  };
}
