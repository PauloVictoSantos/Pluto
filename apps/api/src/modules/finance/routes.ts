import {
  AccountSchema,
  brandKeysFor,
  CategoryRuleSchema,
  RenameTransactionSchema,
  SaveCategoryRulesSchema,
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
import { escapeRegex, matchKeyOf, normalizeDescription } from '../../lib/text';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
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
type GroupName = { name: string; user: boolean };
const toTransactionDTO = (t: TransactionDoc, recurring = new Set<string>(), outliers = new Map<string, Outlier>(), groups = new Map<string, GroupName>()): Transaction => ({
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
  paymentMethod: t.paymentMethod ?? null,
  needsReview: t.needsReview ?? false,
  merchantGroup: t.merchantGroupId ? (groups.get(t.merchantGroupId.toHexString())?.name ?? null) : null,
  nameOverride: t.merchantGroupId && groups.get(t.merchantGroupId.toHexString())?.user ? groups.get(t.merchantGroupId.toHexString())!.name : null,
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
    // Pix como filtro, nunca como categoria (doc. Melhorias, passo 8).
    if (q.paymentMethod) filter.paymentMethod = q.paymentMethod;
    if (q.review) filter.needsReview = true;
    if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (q.q) {
      const term = normalizeDescription(q.q);
      // O nome facil tambem acha a descricao original: "Ingresso" encontra "MP *GUICHEWEB".
      const brand = brandKeysFor(q.q).map((k) => ({ descriptionNorm: { $regex: k.split('').map(escapeRegex).join('\\s?') } }));
      if (term || brand.length) filter.$and = [{ $or: [...(term ? [{ descriptionNorm: { $regex: escapeRegex(term) } }] : []), ...brand] }];
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
      (await ctx.col.merchantGroups.find({ userId: userOf(req).id }, { projection: { name: 1, source: 1 } }).toArray()).map((g) => [
        g._id.toHexString(),
        { name: g.name, user: g.source === 'user' },
      ]),
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
        { $set: { categoryKey, categorySource: 'MANUAL', type: typeFor(categoryKey, t.amountMinor), aiSuggestion: null, needsReview: false, updatedAt: now } },
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

  /**
   * Renomear: o nome vale para todas as transacoes da mesma descricao (grupo do usuario). Se a descricao
   * ja esta num grupo, renomeia o grupo. null volta ao nome automatico.
   */
  app.post('/transactions/:id/rename', { schema: { params: IdParam, body: RenameTransactionSchema, response: { 200: z.object({ name: z.string().nullable() }) } } }, async (req) => {
    const userId = userOf(req).id, t = await ownTx(userId, req.params.id), now = new Date();
    const { name } = req.body;
    const group = t.merchantGroupId ? await ctx.col.merchantGroups.findOne({ _id: t.merchantGroupId, userId }) : null;
    if (name === null) {
      // So desfaz o nome de um grupo criado so para renomear (sem categoria e com uma descricao).
      if (group && group.source === 'user' && !group.categoryKey && group.keys.length === 1) {
        await ctx.col.merchantGroups.deleteOne({ _id: group._id });
        await ctx.col.transactions.updateMany({ userId, merchantGroupId: group._id }, { $set: { merchantGroupId: null } });
      } else if (group) await ctx.col.merchantGroups.updateOne({ _id: group._id }, { $set: { source: 'ai', updatedAt: now } });
      return { name: null };
    }
    if (group) await ctx.col.merchantGroups.updateOne({ _id: group._id }, { $set: { name, source: 'user', updatedAt: now } });
    else {
      const _id = new ObjectId();
      await ctx.col.merchantGroups.insertOne({ _id, userId, name, categoryKey: null, source: 'user', keys: [t.matchKey], blocked: [], createdAt: now, updatedAt: now });
      await ctx.col.transactions.updateMany({ userId, matchKey: t.matchKey, deletedAt: null, splitOf: null }, { $set: { merchantGroupId: _id } });
    }
    await audit(ctx.col, 'transaction.renamed', userId, { transactionId: req.params.id }, req.ip);
    return { name };
  });

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
  const deleteRule = async (userId: ObjectId, id: string) => {
    const rule = await ctx.col.categoryRules.findOneAndDelete({ _id: new ObjectId(id), userId });
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
  };

  /** Troca a categoria de uma regra: o que ela ja tinha categorizado passa a seguir a nova. */
  const moveRule = async (userId: ObjectId, id: string, categoryKey: string) => {
    const rule = await ctx.col.categoryRules.findOneAndUpdate({ _id: new ObjectId(id), userId }, { $set: { categoryKey, updatedAt: new Date() } }, { returnDocument: 'after' });
    if (!rule) throw notFound('Regra');
    await ctx.col.transactions.updateMany({ userId, ...ruleKeyFilter(rule.matchKey), categorySource: 'RULE' }, { $set: { categorySource: null } });
    await applyRule(ctx.col, rule);
  };

  /** Estabelecimento digitado no modal: vale para as transacoes com a mesma descricao. */
  const addRule = async (userId: ObjectId, label: string, categoryKey: string, direction: 'in' | 'out') => {
    const now = new Date(), matchKey = matchKeyOf(label);
    const rule = await ctx.col.categoryRules.findOneAndUpdate(
      { userId, matchKey, direction },
      { $set: { categoryKey, label, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    await ctx.col.transactions.updateMany({ userId, ...ruleKeyFilter(matchKey), categorySource: 'RULE' }, { $set: { categorySource: null } });
    await applyRule(ctx.col, rule!);
  };

  /** Modal de regras (doc. Melhorias, passo 6): adicionar, mover e remover de uma vez, no "Salvar". */
  app.put('/category-rules', { config: { rateLimit: perUser(20) }, schema: { body: SaveCategoryRulesSchema, response: { 200: z.array(CategoryRuleSchema) } } }, async (req) => {
    const userId = userOf(req).id, { create, move, remove } = req.body;
    const own = await ctx.col.categoryRules.countDocuments({ userId, _id: { $in: [...move.map((m) => m.id), ...remove].map((id) => new ObjectId(id)) } });
    if (own !== new Set([...move.map((m) => m.id), ...remove]).size) throw notFound('Regra');
    for (const id of remove) await deleteRule(userId, id);
    for (const m of move) if (!remove.includes(m.id)) await moveRule(userId, m.id, m.categoryKey);
    for (const c of create) await addRule(userId, c.label, c.categoryKey, c.direction);
    await autoCategorize(ctx.col, userId).catch((e) => req.log.warn({ err: e instanceof Error ? e.message : e }, 'falha ao recategorizar'));
    await audit(ctx.col, 'category_rules.saved', userId, { created: create.length, moved: move.length, removed: remove.length }, req.ip);
    return (await ctx.col.categoryRules.find({ userId }).sort({ matchKey: 1 }).toArray()).map(toRuleDTO);
  });

  app.delete('/category-rules/:id', { schema: { params: IdParam } }, async (req, reply) => {
    const userId = userOf(req).id;
    await deleteRule(userId, req.params.id);
    await audit(ctx.col, 'category_rule.deleted', userId, { ruleId: req.params.id }, req.ip);
    return reply.code(204).send();
  });
};
