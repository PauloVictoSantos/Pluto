import {
  AccountSchema,
  TransactionPageSchema,
  TransactionQuerySchema,
  TransactionSummaryQuerySchema,
  TransactionSummarySchema,
  type Account,
  type Transaction,
} from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ObjectId, type Filter } from 'mongodb';
import { z } from 'zod';
import type { AppContext } from '../../context';
import type { AccountDoc, TransactionDoc } from '../../db/collections';
import { AppError } from '../../lib/errors';
import { escapeRegex, normalizeDescription } from '../../lib/text';
import { requireAuth, userOf } from '../../plugins/auth';

const toAccountDTO = (a: AccountDoc): Account => ({
  id: a._id.toHexString(),
  connectionId: a.connectionId.toHexString(),
  type: a.type,
  name: a.name,
  numberMasked: a.numberMasked,
  balanceMinor: a.balanceMinor,
  currency: a.currency,
  creditLimitMinor: a.creditLimitMinor,
  availableCreditMinor: a.availableCreditMinor,
  closingDay: a.closingDay,
  dueDay: a.dueDay,
});

const toTransactionDTO = (t: TransactionDoc): Transaction => ({
  id: t._id.toHexString(),
  accountId: t.accountId.toHexString(),
  date: t.date,
  description: t.description,
  merchant: t.merchant,
  amountMinor: t.amountMinor,
  currency: 'BRL',
  type: t.type,
  status: t.status,
  categoryId: t.categoryId?.toHexString() ?? null,
  categorySource: t.categorySource,
  providerCategory: t.pluggyCategory,
  installment: t.installment,
  tags: t.tags,
  hidden: t.hidden,
  notes: t.notes,
});

// Cursor opaco: data + _id da ultima transacao da pagina (ordem date desc, _id desc).
const encodeCursor = (t: TransactionDoc) => Buffer.from(JSON.stringify([t.date.toISOString(), t._id.toHexString()])).toString('base64url');
function decodeCursor(c: string): { date: Date; id: ObjectId } {
  try {
    const [d, id] = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as [string, string];
    const date = new Date(d);
    if (Number.isNaN(date.getTime()) || !ObjectId.isValid(id)) throw new Error();
    return { date, id: new ObjectId(id) };
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor inválido');
  }
}

export const financeRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));

  app.get('/accounts', { schema: { response: { 200: z.array(AccountSchema) } } }, async (req) =>
    (await ctx.col.accounts.find({ userId: userOf(req).id }).sort({ type: 1, name: 1 }).toArray()).map(toAccountDTO),
  );

  app.get(
    '/transactions/summary',
    { schema: { querystring: TransactionSummaryQuerySchema, response: { 200: TransactionSummarySchema } } },
    async (req) => {
      const { from, to } = req.query;
      const [r] = await ctx.col.transactions
        .aggregate<{ income: number; expenses: number; count: number }>([
          { $match: { userId: userOf(req).id, deletedAt: null, date: { $gte: from, ...(to ? { $lte: to } : {}) } } },
          {
            $group: {
              _id: null,
              income: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amountMinor', 0] } },
              expenses: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amountMinor', 0] } },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();
      return { incomeMinor: r?.income ?? 0, expensesMinor: -(r?.expenses ?? 0), count: r?.count ?? 0 };
    },
  );

  app.get('/transactions', { schema: { querystring: TransactionQuerySchema, response: { 200: TransactionPageSchema } } }, async (req) => {
    const q = req.query;
    // userId sempre do token (secao 6.3); valores do usuario nunca viram operadores.
    const filter: Filter<TransactionDoc> = { userId: userOf(req).id, deletedAt: null };
    if (q.accountId) filter.accountId = new ObjectId(q.accountId);
    if (q.categoryId) filter.categoryId = new ObjectId(q.categoryId);
    if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (q.q) {
      const term = normalizeDescription(q.q);
      if (term) filter.descriptionNorm = { $regex: escapeRegex(term) };
    }
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filter.$or = [{ date: { $lt: c.date } }, { date: c.date, _id: { $lt: c.id } }];
    }

    const docs = await ctx.col.transactions.find(filter).sort({ date: -1, _id: -1 }).limit(q.limit + 1).toArray();
    const page = docs.slice(0, q.limit);
    return { items: page.map(toTransactionDTO), nextCursor: docs.length > q.limit ? encodeCursor(page[page.length - 1]!) : null };
  });
};
