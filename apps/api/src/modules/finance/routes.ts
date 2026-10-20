import {
  AccountSchema,
  CategoryRuleSchema,
  SetCategoryResultSchema,
  SetCategorySchema,
  SimilarSchema,
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
import type { AccountDoc, CategoryRuleDoc, TransactionDoc } from '../../db/collections';
import { categoryKeyForType, deriveType } from '../../integrations/pluggy/mappers';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { escapeRegex, normalizeDescription } from '../../lib/text';
import { requireAuth, userOf } from '../../plugins/auth';
import { isAnomaly, median, modifiedZ } from '@pluto/finance-engine';
import { autoCategorize } from '../analytics/categorizer';
import { recurringKeys } from '../analytics/service';
import { applyRule, directionOf, ruleKeyFilter, ruleKeyOf, typeFor } from '../categories/rules';

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

type Outlier = Transaction['outlier'];
const toTransactionDTO = (t: TransactionDoc, recurring = new Set<string>(), outliers = new Map<string, Outlier>(), groups = new Map<string, string>()): Transaction => ({
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
  categoryKey: t.categoryKey ?? 'outros',
  installment: t.installment,
  tags: t.tags,
  hidden: t.hidden,
  notes: t.notes,
  hasTime: t.hasTime ?? true,
  recurring: recurring.has(`${directionOf(t.amountMinor)}|${ruleKeyOf(t)}`),
  hasCounterparty: !!t.counterpartyKey,
  outlier: outliers.get(t._id.toHexString()) ?? null,
  suggestion: t.aiSuggestion ?? null,
  merchantGroup: t.merchantGroupId ? (groups.get(t.merchantGroupId.toHexString()) ?? null) : null,
});

const OUTLIER_WINDOW = 180 * 86_400_000;

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
    const recurring = await recurringKeys(ctx.col, userOf(req).id);
    const outliers = await outliersOf(userOf(req).id, page);
    const groups = new Map(
      (await ctx.col.merchantGroups.find({ userId: userOf(req).id }, { projection: { name: 1 } }).toArray()).map((g) => [g._id.toHexString(), g.name]),
    );
    return { items: page.map((t) => toTransactionDTO(t, recurring, outliers, groups)), nextCursor: docs.length > q.limit ? encodeCursor(page[page.length - 1]!) : null };
  });

  /**
   * Gasto isolado fora do normal na categoria: z-score modificado > 3,5 contra os gastos dos ultimos
   * 180 dias da mesma categoria (minimo 8). So sinaliza; nada e escondido ou alterado (RN-D05).
   */
  const outliersOf = async (userId: ObjectId, page: TransactionDoc[]) => {
    const out = new Map<string, Outlier>();
    const spend = page.filter((t) => t.type === 'EXPENSE');
    for (const cat of new Set(spend.map((t) => t.categoryKey))) {
      const ref = await ctx.col.transactions
        .find(
          { userId, deletedAt: null, type: 'EXPENSE', categoryKey: cat, date: { $gte: new Date(Date.now() - OUTLIER_WINDOW) } },
          { projection: { amountMinor: 1 } },
        )
        .toArray();
      for (const t of spend.filter((x) => x.categoryKey === cat)) {
        const others = ref.filter((r) => !r._id.equals(t._id)).map((r) => -r.amountMinor);
        const z = modifiedZ(-t.amountMinor, others);
        if (z !== null && z > 0 && isAnomaly(z)) {
          out.set(t._id.toHexString(), { medianMinor: Math.round(median(others)), z: Math.round(z * 10) / 10 });
        }
      }
    }
    return out;
  };

  // Categoria escolhida pelo usuario (RN-12) e regras por destinatario/descricao (RN-10).
  const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });
  const ownTx = async (userId: ObjectId, id: string) => {
    const t = await ctx.col.transactions.findOne({ _id: new ObjectId(id), userId, deletedAt: null });
    if (!t) throw notFound('Transação');
    return t;
  };

  app.get('/transactions/:id/similar', { schema: { params: IdParam, response: { 200: SimilarSchema } } }, async (req) => {
    const userId = userOf(req).id, t = await ownTx(userId, req.params.id);
    const matchKey = ruleKeyOf(t);
    const count = await ctx.col.transactions.countDocuments({
      userId,
      ...ruleKeyFilter(matchKey),
      deletedAt: null,
      amountMinor: t.amountMinor > 0 ? { $gt: 0 } : { $lte: 0 },
    });
    return { matchKey, count, byCounterparty: matchKey.startsWith('cp:'), label: t.merchant ?? (t.matchKey || t.description) };
  });

  app.patch(
    '/transactions/:id/category',
    { schema: { params: IdParam, body: SetCategorySchema, response: { 200: SetCategoryResultSchema } } },
    async (req) => {
      const userId = userOf(req).id, t = await ownTx(userId, req.params.id);
      const { categoryKey, applyToSimilar } = req.body;
      const now = new Date();
      await ctx.col.transactions.updateOne(
        { _id: t._id, userId },
        { $set: { categoryKey, categorySource: 'MANUAL', type: typeFor(categoryKey, t.amountMinor), aiSuggestion: null, updatedAt: now } },
      );
      let updated = 1, ruleId: string | null = null;
      if (applyToSimilar) {
        const matchKey = ruleKeyOf(t), direction = directionOf(t.amountMinor);
        const label = t.merchant ?? (t.matchKey || t.description);
        const rule = await ctx.col.categoryRules.findOneAndUpdate(
          { userId, matchKey, direction },
          { $set: { categoryKey, label, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true, returnDocument: 'after' },
        );
        ruleId = rule!._id.toHexString();
        // Ao trocar a regra, as transacoes que ela ja tinha categorizado passam a seguir a nova.
        await ctx.col.transactions.updateMany(
          { userId, ...ruleKeyFilter(matchKey), categorySource: 'RULE' },
          { $set: { categorySource: null } },
        );
        updated += await applyRule(ctx.col, { userId, matchKey, direction, categoryKey }, { _id: { $ne: t._id } });
      }
      // Cada correcao vira exemplo de treino: o modelo se atualiza na hora (doc. "Retreino").
      await autoCategorize(ctx.col, userId).catch((e) => req.log.warn({ err: e instanceof Error ? e.message : e }, 'falha ao recategorizar'));
      await audit(ctx.col, 'transaction.category_set', userId, { transactionId: t._id.toHexString(), categoryKey, applyToSimilar }, req.ip);
      return { updated, ruleId };
    },
  );

  const toRuleDTO = (r: CategoryRuleDoc) => ({
    id: r._id.toHexString(),
    matchKey: r.matchKey,
    label: r.label ?? r.matchKey,
    byCounterparty: r.matchKey.startsWith('cp:'),
    direction: r.direction,
    categoryKey: r.categoryKey,
    createdAt: r.createdAt,
  });

  app.get('/category-rules', { schema: { response: { 200: z.array(CategoryRuleSchema) } } }, async (req) =>
    (await ctx.col.categoryRules.find({ userId: userOf(req).id }).sort({ matchKey: 1 }).toArray()).map(toRuleDTO),
  );

  /** Remove a regra; as transacoes que ela categorizou voltam para a categoria do Pluggy. */
  app.delete('/category-rules/:id', { schema: { params: IdParam } }, async (req, reply) => {
    const userId = userOf(req).id;
    const rule = await ctx.col.categoryRules.findOneAndDelete({ _id: new ObjectId(req.params.id), userId });
    if (!rule) throw notFound('Regra');
    const affected = await ctx.col.transactions
      .find({ userId, ...ruleKeyFilter(rule.matchKey), categorySource: 'RULE' }, { projection: { accountId: 1, pluggyCategory: 1, amountMinor: 1, description: 1 } })
      .toArray();
    if (affected.length) {
      const accType = new Map((await ctx.col.accounts.find({ userId }, { projection: { type: 1 } }).toArray()).map((a) => [a._id.toHexString(), a.type]));
      await ctx.col.transactions.bulkWrite(
        affected.map((d) => {
          const type = deriveType(
            { type: d.amountMinor < 0 ? 'DEBIT' : 'CREDIT', category: d.pluggyCategory, description: d.description },
            accType.get(d.accountId.toHexString()) ?? 'CHECKING',
          );
          return {
            updateOne: {
              filter: { _id: d._id },
              update: { $set: { categorySource: null, type, categoryKey: categoryKeyForType(type, d.pluggyCategory, d.amountMinor) } },
            },
          };
        }),
      );
    }
    await audit(ctx.col, 'category_rule.deleted', userId, { ruleId: req.params.id }, req.ip);
    return reply.code(204).send();
  });
};
