import { healthBand, healthScore, median } from '@pluto/finance-engine';
import { scheduleIn, type FinancialHealth } from '@pluto/shared';
import type { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import { monthOf, tzOffsetMs } from '../../lib/time';

// Saude financeira (Visao geral): pagamentos em dia, uso do limite e parcelas abertas, com os pesos de
// finance-engine/health. Tudo dos dados reais do usuario.

const DAY = 86_400_000;
const LENGTH: Record<FinancialHealth['period'], number> = { month: 30, '3m': 91, '12m': 365 };

export async function financialHealth(ctx: AppContext, userId: ObjectId, period: FinancialHealth['period'], now = new Date()): Promise<FinancialHealth> {
  const { col } = ctx;
  const tz = (await col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
  const ymd = (d: Date) => new Date(d.getTime() + tzOffsetMs(d, tz)).toISOString().slice(0, 10);
  const span = LENGTH[period] * DAY;
  const removed = new Set((await col.connections.find({ userId, removedAt: { $ne: null } }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id)));
  const cards = (await col.accounts.find({ userId, type: 'CREDIT_CARD' }).toArray()).filter((a) => !removed.has(String(a.connectionId)));
  const cardIds = cards.map((c) => c._id);

  // Uso do limite (hoje): fatura em aberto / limite. Tendencia: fatura atual x ultima fechada.
  const limitMinor = cards.reduce((s, c) => s + (c.creditLimitMinor ?? 0), 0);
  const usedMinor = cards.reduce((s, c) => s + (c.creditLimitMinor != null && c.availableCreditMinor != null ? c.creditLimitMinor - c.availableCreditMinor : Math.max(0, c.balanceMinor)), 0);
  const lastInvoices = await col.invoices.find({ userId, accountId: { $in: cardIds }, dueDate: { $lt: now } }).sort({ dueDate: -1 }).limit(cards.length || 1).toArray();
  const lastTotal = lastInvoices.reduce((s, i) => s + i.totalMinor, 0);
  const currentBill = cards.reduce((s, c) => s + Math.max(0, c.balanceMinor), 0);
  const limitUse = limitMinor > 0 ? usedMinor / limitMinor : null;

  const incomeRows = await col.transactions
    .aggregate<{ _id: string; total: number }>([
      { $match: { userId, deletedAt: null, type: 'INCOME', date: { $gte: new Date(now.getTime() - 95 * DAY) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: tz } }, total: { $sum: '$amountMinor' } } },
    ])
    .toArray();
  const incomeMinor = incomeRows.length ? Math.round(median(incomeRows.map((r) => r.total))) : 0;

  /** Indicadores de uma janela [from, to). */
  const windowOf = async (from: Date, to: Date) => {
    const invoices = await col.invoices.find({ userId, accountId: { $in: cardIds }, dueDate: { $gte: from, $lt: to < now ? to : now } }).toArray();
    // CLOSED: o Open Finance nao informa o pagamento de faturas antigas; sem sinal de atraso.
    const invPaid = invoices.filter((i) => i.status === 'PAID' || i.status === 'CLOSED').length;
    const bills = await col.bills.find({ userId, dueDate: { $gte: ymd(from), $lt: ymd(to < now ? to : now) } }).toArray();
    const billOnTime = bills.filter((b) => b.status === 'paid' && (!b.paidAt || ymd(b.paidAt) <= b.dueDate)).length;
    const due = invoices.length + bills.length;
    const overdue = invoices.filter((i) => i.status === 'OVERDUE').length + bills.filter((b) => b.status === 'overdue').length;
    const fees = await col.transactions.countDocuments({ userId, deletedAt: null, categoryKey: 'taxas', date: { $gte: from, $lt: to } });
    // Parcelas abertas no fim da janela: compras parceladas com parcelas por vir + dividas manuais.
    const groups = await col.transactions
      .aggregate<{ _id: string; n: number; total: number; amountMinor: number }>([
        { $match: { userId, deletedAt: null, 'installment.groupId': { $exists: true }, date: { $gte: new Date(to.getTime() - 40 * DAY), $lt: to } } },
        { $sort: { 'installment.n': -1 } },
        { $group: { _id: '$installment.groupId', n: { $first: '$installment.n' }, total: { $first: '$installment.total' }, amountMinor: { $first: '$amountMinor' } } },
      ])
      .toArray();
    const open = groups.filter((g) => g.n < g.total);
    const month = monthOf(to < now ? to : now, tz);
    const manual = (await col.commitments.find({ userId, active: true }).toArray()).map((c) => scheduleIn(c, month)).filter((s) => !!s);
    const monthlyMinor = open.reduce((s, g) => s + Math.abs(g.amountMinor), 0) + manual.reduce((s, x) => s + x.amountMinor, 0);
    const purchases = await col.transactions.countDocuments({ userId, deletedAt: null, type: 'EXPENSE', accountId: { $in: cardIds }, date: { $gte: from, $lt: to } });
    const onTimeRate = due ? (invPaid + billOnTime) / due : null;
    return {
      onTime: { pct: onTimeRate, paid: invPaid + billOnTime, due },
      negatives: { count: overdue + fees, overdue, fees },
      installments: { count: open.length + manual.length, monthlyMinor },
      purchases,
      score: healthScore({ onTimeRate, limitUse, installmentsRatio: incomeMinor > 0 ? monthlyMinor / incomeMinor : null }),
    };
  };

  const cur = await windowOf(new Date(now.getTime() - span), now);
  const first = await col.transactions.findOne({ userId, deletedAt: null }, { sort: { date: 1 }, projection: { date: 1 } });
  const historyMonths = first ? Math.floor((now.getTime() - first.date.getTime()) / (30.44 * DAY)) : 0;
  // Periodo anterior so com historico cobrindo a janela inteira.
  const prevFrom = new Date(now.getTime() - 2 * span);
  const prev = first && first.date <= prevFrom ? await windowOf(prevFrom, new Date(now.getTime() - span)) : null;
  const band = healthBand(cur.score);
  return {
    period,
    score: cur.score,
    prevScore: prev?.score ?? null,
    band: { label: band.label, from: band.from, to: band.to },
    onTime: cur.onTime,
    limitUse: {
      pct: limitUse,
      usedMinor,
      limitMinor,
      trend: lastInvoices.length ? (currentBill > lastTotal * 1.05 ? 'up' : currentBill < lastTotal * 0.95 ? 'down' : 'flat') : null,
    },
    negatives: cur.negatives,
    historyMonths,
    installments: { ...cur.installments, incomeMinor },
    purchases: cur.purchases,
  };
}
