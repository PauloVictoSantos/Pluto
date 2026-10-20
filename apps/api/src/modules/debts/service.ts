import { scheduleIn, type Commitment, type DebtSource } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { BillDoc, BillItem, CommitmentDoc, DebtSourceDoc, TransactionDoc } from '../../db/collections';
import { categoryKeyForType } from '../../integrations/pluggy/mappers';
import { addMonth, monthOf, tzOffsetMs } from '../../lib/time';
import { typeFor } from '../categories/rules';

// Dividas manuais: cada forma de pagamento gera, por mes, um boleto em Contas a pagar com a soma das
// parcelas e mensalidades. Assim projecao, ordem de pagamento, avisos e conciliacao valem para elas.

const tzOf = async (ctx: AppContext, userId: ObjectId) =>
  (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';

/** "YYYY-MM" + dia -> "YYYY-MM-DD", com o dia limitado ao fim do mes (dia 31 em fevereiro vira 28/29). */
export const dueDateOf = (month: string, day: number) => {
  const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
};

const labelOf = (c: CommitmentDoc, s: NonNullable<ReturnType<typeof scheduleIn>>) =>
  s.n ? `${c.merchant} · parcela ${s.n}/${s.total}` : `${c.merchant} · mensalidade`;

export function itemsFor(commitments: readonly CommitmentDoc[], month: string): BillItem[] {
  return commitments
    .filter((c) => c.active)
    .map((c) => ({ c, s: scheduleIn(c, month) }))
    .filter((x): x is { c: CommitmentDoc; s: NonNullable<ReturnType<typeof scheduleIn>> } => !!x.s && x.s.amountMinor > 0)
    .map(({ c, s }) => ({ commitmentId: c._id, label: labelOf(c, s), categoryKey: c.categoryKey, amountMinor: s.amountMinor, n: s.n, total: s.total }));
}

/**
 * Gera ou atualiza o boleto do mes atual e do proximo de cada forma de pagamento. Boleto ja pago nao
 * muda (historico, RN-G07); pendente acompanha as compras; mes sem compras nao tem boleto.
 */
export async function syncDebtBills(ctx: AppContext, userId: ObjectId, now = new Date()) {
  const tz = await tzOf(ctx, userId);
  const month = monthOf(now, tz);
  const today = new Date(now.getTime() + tzOffsetMs(now, tz)).toISOString().slice(0, 10);
  const sources = await ctx.col.debtSources.find({ userId }).toArray();
  for (const src of sources) {
    const commitments = await ctx.col.commitments.find({ userId, sourceId: src._id }).toArray();
    for (const m of [month, addMonth(month, 1)]) {
      const items = itemsFor(commitments, m);
      const total = items.reduce((s, i) => s + i.amountMinor, 0);
      const existing = await ctx.col.bills.findOne({ userId, sourceId: src._id, month: m });
      if (existing?.status === 'paid') continue;
      if (!total) {
        if (existing) await ctx.col.bills.deleteOne({ _id: existing._id });
        continue;
      }
      const dueDate = dueDateOf(m, src.dueDay);
      const set = {
        payeeEnc: ctx.crypto.encrypt(src.name),
        amountEnc: ctx.crypto.encrypt(String(total)),
        dueDate,
        status: (dueDate < today ? 'overdue' : 'pending') as BillDoc['status'],
        items,
        updatedAt: now,
      };
      await ctx.col.bills.updateOne(
        { userId, sourceId: src._id, month: m },
        { $set: set, $setOnInsert: { lineEnc: null, fine: 0, monthlyInterest: 0, paidAt: null, paidTransactionId: null, createdAt: now } },
        { upsert: true },
      );
    }
  }
}

/**
 * Pagamento confirmado de um boleto de divida: a transacao do banco sai dos gastos ("pagamento
 * dividido") e da lugar a uma parte por compra, cada uma na sua categoria. A transacao do Pluggy nao e
 * alterada alem da categoria (RN-G04); as partes sao uma camada separada, desfeita em unsplit.
 */
export async function splitPayment(ctx: AppContext, tx: TransactionDoc, items: readonly BillItem[], now = new Date()) {
  await ctx.col.transactions.deleteMany({ splitOf: tx._id });
  const parts = items.map((it, i) => ({
    _id: new ObjectId(),
    userId: tx.userId,
    accountId: tx.accountId,
    connectionId: tx.connectionId,
    pluggyTransactionId: `split:${tx._id.toHexString()}:${i}`,
    date: tx.date,
    description: it.label,
    descriptionNorm: it.label.toLowerCase(),
    matchKey: it.label.toLowerCase(),
    merchant: it.label.split(' · ')[0] ?? it.label,
    amountMinor: -it.amountMinor,
    currency: tx.currency,
    type: typeFor(it.categoryKey, -it.amountMinor),
    status: 'POSTED' as const,
    pluggyCategory: null,
    pluggyCategoryId: null,
    pluggyBillId: null,
    categoryKey: it.categoryKey,
    installment: null,
    categoryId: null,
    categorySource: 'MANUAL' as const,
    categoryConfidence: null,
    invoiceId: null,
    tags: ['dividido'],
    notes: null,
    hidden: false,
    hasTime: tx.hasTime ?? true,
    counterpartyKey: null,
    splitOf: tx._id,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
  if (parts.length) await ctx.col.transactions.insertMany(parts as TransactionDoc[]);
  await ctx.col.transactions.updateOne(
    { _id: tx._id },
    { $set: { categoryKey: 'pago-dividido', categorySource: 'MANUAL', type: 'TRANSFER', aiSuggestion: null, updatedAt: now }, $addToSet: { tags: 'dividido' } },
  );
}

/** Desfaz a divisao: apaga as partes e devolve a categoria do Pluggy a transacao original. */
export async function unsplitPayment(ctx: AppContext, txId: ObjectId, now = new Date()) {
  await ctx.col.transactions.deleteMany({ splitOf: txId });
  const tx = await ctx.col.transactions.findOne({ _id: txId });
  if (!tx || tx.categoryKey !== 'pago-dividido') return;
  const type = tx.amountMinor > 0 ? 'INCOME' : 'EXPENSE';
  await ctx.col.transactions.updateOne(
    { _id: txId },
    { $set: { categoryKey: categoryKeyForType(type, tx.pluggyCategory, tx.amountMinor), categorySource: null, type, updatedAt: now }, $pull: { tags: 'dividido' } },
  );
}

const monthIdx = (m: string) => +m.slice(0, 4) * 12 + +m.slice(5) - 1;

export function toCommitment(c: CommitmentDoc, month: string): Commitment {
  const cur = c.active ? scheduleIn(c, month) : null;
  let remaining: number | null = null;
  if (c.kind === 'installments' && c.totalMinor && c.installments) {
    const paidBefore = Math.max(0, Math.min(c.installments, monthIdx(month) - monthIdx(c.firstMonth)));
    remaining = 0;
    for (let n = paidBefore + 1; n <= c.installments; n++) remaining += scheduleIn(c, addMonth(c.firstMonth, n - 1))!.amountMinor;
  }
  return {
    id: c._id.toHexString(),
    sourceId: c.sourceId.toHexString(),
    merchant: c.merchant,
    categoryKey: c.categoryKey,
    approvedAt: c.approvedAt,
    kind: c.kind,
    totalMinor: c.totalMinor,
    installments: c.installments,
    monthlyMinor: c.monthlyMinor,
    firstMonth: c.firstMonth,
    lastMonth: c.lastMonth,
    notes: c.notes,
    active: c.active,
    current: cur,
    remainingMinor: c.active ? remaining : null,
  };
}

export async function listDebts(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<DebtSource[]> {
  const month = monthOf(now, await tzOf(ctx, userId));
  const sources = await ctx.col.debtSources.find({ userId }).sort({ createdAt: 1 }).toArray();
  const all = await ctx.col.commitments.find({ userId }).sort({ active: -1, createdAt: 1 }).toArray();
  return sources.map((s: DebtSourceDoc) => {
    const items = all.filter((c) => c.sourceId.equals(s._id)).map((c) => toCommitment(c, month));
    return {
      id: s._id.toHexString(),
      name: s.name,
      method: s.method,
      holder: s.holder,
      bank: s.bank,
      cardProduct: s.cardProduct,
      brand: s.brand,
      last4: s.last4,
      dueDay: s.dueDay,
      notes: s.notes,
      items,
      monthTotalMinor: items.reduce((t, i) => t + (i.current?.amountMinor ?? 0), 0),
    };
  });
}
