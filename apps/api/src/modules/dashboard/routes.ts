import {
  CardSchema,
  DashboardSummarySchema,
  InvestmentsSchema,
  InvoiceQuerySchema,
  InvoiceSchema,
  MonthQuerySchema,
  SpendingSchema,
  type Invoice,
} from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppContext } from '../../context';
import type { AccountDoc, ConnectionDoc, InvoiceDoc } from '../../db/collections';
import { addMonth, monthOf, monthRange, monthStart } from '../../lib/time';
import { requireAuth, userOf } from '../../plugins/auth';

// Secao 7: GET /dashboard/spending, /dashboard/investments + resumo da visao geral, cartoes e faturas.
// Regras: TRANSFER e CARD_PAYMENT nao entram em receitas/despesas (RN-13, RN-14); mes no fuso do usuario (RN-20).

export const dashboardRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));
  const { col } = ctx;

  const tzOf = async (userId: ObjectId) =>
    (await col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';

  const connectionsOf = async (userId: ObjectId) =>
    new Map((await col.connections.find({ userId }).toArray()).map((c) => [c._id.toHexString(), c] as const));

  app.get('/dashboard/summary', { schema: { response: { 200: DashboardSummarySchema } } }, async (req) => {
    const userId = userOf(req).id, tz = await tzOf(userId);
    const conns = await connectionsOf(userId);
    const active = (c: ConnectionDoc | undefined) => !!c && !c.removedAt;
    const accounts = (await col.accounts.find({ userId, type: { $in: ['CHECKING', 'SAVINGS'] } }).toArray()).filter((a) =>
      active(conns.get(a.connectionId.toHexString())),
    );

    const byConn = new Map<string, number>();
    accounts.forEach((a) => byConn.set(a.connectionId.toHexString(), (byConn.get(a.connectionId.toHexString()) ?? 0) + a.balanceMinor));
    const banks = [...conns.values()]
      .filter((c) => active(c))
      .map((c) => ({
        connectionId: c._id.toHexString(),
        institutionName: c.institutionName,
        primaryColor: c.primaryColor,
        balanceMinor: byConn.get(c._id.toHexString()) ?? 0,
        status: c.status,
        needsAction: c.needsAction,
      }));

    const current = monthOf(new Date(), tz);
    const first = addMonth(current, -5);
    const rows = await col.transactions
      .aggregate<{ _id: string; income: number; expenses: number; invested: number }>([
        { $match: { userId, deletedAt: null, date: { $gte: monthStart(first, tz) } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: tz } },
            income: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amountMinor', 0] } },
            expenses: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amountMinor', 0] } },
            invested: { $sum: { $cond: [{ $eq: ['$type', 'INVESTMENT'] }, '$amountMinor', 0] } },
          },
        },
      ])
      .toArray();
    const byMonth = new Map(rows.map((r) => [r._id, r]));
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const month = addMonth(first, i), r = byMonth.get(month);
      return { month, incomeMinor: r?.income ?? 0, expensesMinor: -(r?.expenses ?? 0), investedMinor: -(r?.invested ?? 0) };
    });
    const lastSync = [...conns.values()].map((c) => c.lastSyncAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      balanceMinor: accounts.reduce((s, a) => s + a.balanceMinor, 0),
      lastSyncAt: lastSync ?? null,
      banks,
      current: monthly[5]!,
      previous: monthly[4]!,
      monthly,
    };
  });

  app.get('/dashboard/spending', { schema: { querystring: MonthQuerySchema, response: { 200: SpendingSchema } } }, async (req) => {
    const userId = userOf(req).id, tz = await tzOf(userId);
    const month = req.query.month ?? monthOf(new Date(), tz);
    const { from, to } = monthRange(month, tz);
    const rows = await col.transactions
      .aggregate<{ _id: string | null; spent: number; count: number }>([
        { $match: { userId, deletedAt: null, type: 'EXPENSE', date: { $gte: from, $lt: to } } },
        { $group: { _id: '$categoryKey', spent: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
      ])
      .toArray();
    const categories = rows
      .map((r) => ({ key: r._id ?? 'outros', spentMinor: -r.spent, count: r.count }))
      .filter((c) => c.spentMinor > 0)
      .sort((a, b) => b.spentMinor - a.spentMinor);
    return { month, totalMinor: categories.reduce((s, c) => s + c.spentMinor, 0), categories };
  });

  const toInvoice = (i: InvoiceDoc, acc: AccountDoc | undefined, conn: ConnectionDoc | undefined): Invoice => ({
    id: i._id.toHexString(),
    accountId: i.accountId.toHexString(),
    cardName: acc?.name ?? 'Cartão',
    institutionName: conn?.institutionName ?? '',
    closingDate: i.closingDate,
    dueDate: i.dueDate,
    totalMinor: i.totalMinor,
    paidMinor: i.paidMinor,
    status: i.status,
  });

  app.get('/cards', { schema: { response: { 200: z.array(CardSchema) } } }, async (req) => {
    const userId = userOf(req).id;
    const conns = await connectionsOf(userId);
    const cards = (await col.accounts.find({ userId, type: 'CREDIT_CARD' }).sort({ name: 1 }).toArray()).filter(
      (a) => !conns.get(a.connectionId.toHexString())?.removedAt,
    );
    const latest = await col.invoices
      .aggregate<InvoiceDoc>([
        { $match: { userId, accountId: { $in: cards.map((c) => c._id) } } },
        { $sort: { dueDate: -1 } },
        { $group: { _id: '$accountId', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
      ])
      .toArray();
    const invByAcc = new Map(latest.map((i) => [i.accountId.toHexString(), i]));
    return cards.map((a) => {
      const conn = conns.get(a.connectionId.toHexString()), inv = invByAcc.get(a._id.toHexString());
      const used = a.creditLimitMinor != null && a.availableCreditMinor != null ? a.creditLimitMinor - a.availableCreditMinor : null;
      return {
        id: a._id.toHexString(),
        connectionId: a.connectionId.toHexString(),
        institutionName: conn?.institutionName ?? '',
        name: a.name,
        numberMasked: a.numberMasked,
        brand: a.brand ?? null,
        creditLimitMinor: a.creditLimitMinor,
        availableCreditMinor: a.availableCreditMinor,
        usedMinor: used,
        currentBillMinor: a.balanceMinor,
        closingDay: a.closingDay,
        dueDay: a.dueDay,
        invoice: inv ? toInvoice(inv, a, conn) : null,
      };
    });
  });

  app.get('/invoices', { schema: { querystring: InvoiceQuerySchema, response: { 200: z.array(InvoiceSchema) } } }, async (req) => {
    const userId = userOf(req).id, { from, to } = req.query;
    const conns = await connectionsOf(userId);
    const accounts = new Map((await col.accounts.find({ userId, type: 'CREDIT_CARD' }).toArray()).map((a) => [a._id.toHexString(), a]));
    const list = await col.invoices
      .find({ userId, ...(from || to ? { dueDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) } } : {}) })
      .sort({ dueDate: 1 })
      .limit(500)
      .toArray();
    return list.map((i) => {
      const acc = accounts.get(i.accountId.toHexString());
      return toInvoice(i, acc, acc ? conns.get(acc.connectionId.toHexString()) : undefined);
    });
  });

  app.get('/dashboard/investments', { schema: { response: { 200: InvestmentsSchema } } }, async (req) => {
    const userId = userOf(req).id;
    const conns = await connectionsOf(userId);
    const list = (await col.investments.find({ userId }).sort({ currentValueMinor: -1 }).toArray()).filter(
      (i) => !conns.get(i.connectionId.toHexString())?.removedAt,
    );
    const alloc = new Map<string, number>();
    list.forEach((i) => alloc.set(i.type, (alloc.get(i.type) ?? 0) + i.currentValueMinor));
    return {
      totalMinor: list.reduce((s, i) => s + i.currentValueMinor, 0),
      appliedMinor: list.reduce((s, i) => s + i.appliedMinor, 0),
      items: list.map((i) => ({
        id: i._id.toHexString(),
        name: i.name,
        type: i.type,
        subtype: i.subtype,
        institutionName: conns.get(i.connectionId.toHexString())?.institutionName ?? '',
        appliedMinor: i.appliedMinor,
        currentValueMinor: i.currentValueMinor,
        dueDate: i.dueDate,
        rateInfo: i.rateInfo,
      })),
      allocation: [...alloc.entries()].map(([type, valueMinor]) => ({ type: type as never, valueMinor })).sort((a, b) => b.valueMinor - a.valueMinor),
    };
  });
};
