import { BillSchema, CreateBillSchema, UpdateBillSchema, parseBoletoLine, type Bill } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppContext } from '../../context';
import type { BillDoc } from '../../db/collections';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { tzOffsetMs } from '../../lib/time';
import { requireAuth, userOf } from '../../plugins/auth';
import { splitPayment, syncDebtBills, unsplitPayment } from '../debts/service';

// Boletos a pagar (doc. "bills"): cadastro manual ou pela linha digitavel. Beneficiario, valor e linha
// ficam cifrados. Vencido pelo job diario; pago so por acao do usuario ou conciliacao confirmada (RN-M03).

const DAY = 86_400_000;
const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });
const todayIn = (tz: string, now = new Date()) => new Date(now.getTime() + tzOffsetMs(now, tz)).toISOString().slice(0, 10);
const tzOf = async (ctx: AppContext, userId: ObjectId) =>
  (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';

/** Job diario: boleto pendente com vencimento passado vira vencido (RN-M03). Idempotente. */
export async function markOverdueBills(ctx: AppContext, now = new Date()): Promise<number> {
  let n = 0;
  for (const userId of await ctx.col.bills.distinct('userId', { status: 'pending' })) {
    const today = todayIn(await tzOf(ctx, userId), now);
    n += (await ctx.col.bills.updateMany({ userId, status: 'pending', dueDate: { $lt: today } }, { $set: { status: 'overdue', updatedAt: now } })).modifiedCount;
  }
  return n;
}

export const billRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));
  const { col, crypto } = ctx;

  const toBill = (d: BillDoc, match: Bill['match'] = null): Bill => ({
    id: d._id.toHexString(),
    payee: crypto.decrypt(d.payeeEnc),
    amountMinor: Number(crypto.decrypt(d.amountEnc)),
    dueDate: d.dueDate,
    status: d.status,
    line: d.lineEnc ? crypto.decrypt(d.lineEnc) : null,
    fine: d.fine,
    monthlyInterest: d.monthlyInterest,
    paidAt: d.paidAt,
    paidTransactionId: d.paidTransactionId?.toHexString() ?? null,
    sourceId: d.sourceId?.toHexString() ?? null,
    items: (d.items ?? []).map(({ label, categoryKey, amountMinor, n, total }) => ({ label, categoryKey, amountMinor, n, total })),
    match,
  });

  /**
   * Transacao que parece ser o pagamento: saida do mesmo valor entre 10 dias antes e 5 depois do
   * vencimento, ainda nao usada por outro boleto. So sugere; o usuario confirma.
   */
  const matchFor = async (userId: ObjectId, bill: Bill, used: Set<string>): Promise<Bill['match']> => {
    const due = Date.parse(`${bill.dueDate}T12:00:00Z`);
    const txs = await col.transactions
      .find(
        { userId, deletedAt: null, amountMinor: -bill.amountMinor, date: { $gte: new Date(due - 10 * DAY), $lte: new Date(due + 5 * DAY) } },
        { projection: { date: 1, merchant: 1, description: 1 }, sort: { date: -1 }, limit: 5 },
      )
      .toArray();
    const t = txs.find((x) => !used.has(x._id.toHexString()));
    return t ? { transactionId: t._id.toHexString(), date: t.date, label: t.merchant ?? t.description } : null;
  };

  app.get('/bills', { schema: { response: { 200: z.array(BillSchema) } } }, async (req) => {
    const userId = userOf(req).id;
    // Boletos do mes das dividas manuais (cartao de terceiro etc.) entram aqui tambem.
    await syncDebtBills(ctx, userId);
    const docs = await col.bills.find({ userId }).sort({ dueDate: 1 }).limit(300).toArray();
    const used = new Set(docs.map((d) => d.paidTransactionId?.toHexString()).filter((x): x is string => !!x));
    const out: Bill[] = [];
    for (const d of docs) {
      const bill = toBill(d);
      if (bill.status !== 'paid') {
        bill.match = await matchFor(userId, bill, used);
        if (bill.match) used.add(bill.match.transactionId);
      }
      out.push(bill);
    }
    return out;
  });

  app.post('/bills', { schema: { body: CreateBillSchema, response: { 201: BillSchema } } }, async (req, reply) => {
    const userId = userOf(req).id, b = req.body, now = new Date();
    const parsed = b.line ? parseBoletoLine(b.line) : null;
    const amountMinor = b.amountMinor ?? parsed?.amountMinor ?? null;
    const dueDate = b.dueDate ?? parsed?.dueDate ?? null;
    if (!amountMinor) throw new AppError(422, 'AMOUNT_REQUIRED', 'Informe o valor do boleto.');
    if (!dueDate) throw new AppError(422, 'DUE_DATE_REQUIRED', 'Informe o vencimento do boleto.');
    const today = todayIn(await tzOf(ctx, userId), now);
    const doc: BillDoc = {
      _id: new ObjectId(),
      userId,
      payeeEnc: crypto.encrypt(b.payee),
      amountEnc: crypto.encrypt(String(amountMinor)),
      dueDate,
      status: dueDate < today ? 'overdue' : 'pending',
      lineEnc: b.line ? crypto.encrypt(b.line.replace(/\D/g, '')) : null,
      fine: b.fine,
      monthlyInterest: b.monthlyInterest,
      paidAt: null,
      paidTransactionId: null,
      createdAt: now,
      updatedAt: now,
    };
    await col.bills.insertOne(doc);
    await audit(col, 'bill.created', userId, { billId: doc._id.toHexString() }, req.ip);
    return reply.status(201).send(toBill(doc));
  });

  app.patch('/bills/:id', { schema: { params: IdParam, body: UpdateBillSchema, response: { 200: BillSchema } } }, async (req) => {
    const userId = userOf(req).id, now = new Date(), b = req.body;
    const doc = await col.bills.findOne({ _id: new ObjectId(req.params.id), userId });
    if (!doc) throw notFound('Boleto');
    const set: Partial<BillDoc> = { updatedAt: now };
    if (b.payee) set.payeeEnc = crypto.encrypt(b.payee);
    if (b.amountMinor) set.amountEnc = crypto.encrypt(String(b.amountMinor));
    if (b.dueDate) set.dueDate = b.dueDate;
    if (b.status === 'paid') {
      // Conciliacao: a transacao precisa ser do usuario e do mesmo valor (RN-M03).
      if (b.transactionId) {
        const amount = b.amountMinor ?? Number(crypto.decrypt(doc.amountEnc));
        const tx = await col.transactions.findOne({ _id: new ObjectId(b.transactionId), userId, deletedAt: null, amountMinor: -amount });
        if (!tx) throw new AppError(422, 'TRANSACTION_MISMATCH', 'Essa transação não é do mesmo valor do boleto.');
        set.paidTransactionId = tx._id;
      }
      set.status = 'paid';
      set.paidAt = now;
    } else if (b.status === 'pending') {
      const today = todayIn(await tzOf(ctx, userId), now);
      set.status = (b.dueDate ?? doc.dueDate) < today ? 'overdue' : 'pending';
      set.paidAt = null;
      set.paidTransactionId = null;
    } else if (b.dueDate && doc.status !== 'paid') {
      set.status = b.dueDate < todayIn(await tzOf(ctx, userId), now) ? 'overdue' : 'pending';
    }
    const updated = await col.bills.findOneAndUpdate({ _id: doc._id, userId }, { $set: set }, { returnDocument: 'after' });
    // Boleto de divida: o pagamento conciliado e dividido entre as compras (cada uma na sua categoria).
    if (b.status === 'paid' && set.paidTransactionId && doc.items?.length) {
      const tx = await col.transactions.findOne({ _id: set.paidTransactionId });
      if (tx) await splitPayment(ctx, tx, doc.items, now);
    }
    if (b.status === 'pending' && doc.paidTransactionId) await unsplitPayment(ctx, doc.paidTransactionId, now);
    await audit(col, 'bill.updated', userId, { billId: doc._id.toHexString(), status: set.status ?? doc.status, reconciled: !!b.transactionId }, req.ip);
    return toBill(updated!);
  });

  /** Cadastro errado. Boleto pago fica no historico (RN-G07). */
  app.delete('/bills/:id', { schema: { params: IdParam } }, async (req, reply) => {
    const userId = userOf(req).id;
    const r = await col.bills.deleteOne({ _id: new ObjectId(req.params.id), userId, status: { $ne: 'paid' }, sourceId: { $in: [null] } });
    if (!r.deletedCount) throw notFound('Boleto em aberto');
    await audit(col, 'bill.deleted', userId, { billId: req.params.id }, req.ip);
    return reply.status(204).send();
  });
};
