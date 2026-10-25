import { AdjustMonthlyPlanSchema, BudgetSchema, CreateGoalSchema, MonthlyPlanSchema, GoalSchema, MonthQuerySchema, PutBudgetSchema, UpdateGoalSchema, type Goal } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppContext } from '../../context';
import type { GoalDoc } from '../../db/collections';
import { notFound } from '../../lib/errors';
import { monthOf } from '../../lib/time';
import { audit } from '../../lib/audit';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { adjustMonthlyPlan, buildMonthlyPlan, getMonthlyPlan } from './monthlyPlan';

// Orcamentos mensais por categoria (RN-20..22) e metas (RN-23). Os valores guardados nas metas
// sao registros do usuario: o Pluto nao movimenta dinheiro (secao 1.2).

const IdParams = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });

const toGoal = (g: GoalDoc): Goal => ({
  id: g._id.toHexString(),
  name: g.name,
  icon: g.icon,
  targetMinor: g.targetMinor,
  savedMinor: g.savedMinor,
  deadline: g.deadline,
  monthlyContributionMinor: g.monthlyContributionMinor ?? 0,
  priority: g.priority ?? 3,
  status: g.status ?? 'ativa',
  kind: g.kind ?? null,
  score: g.score ?? null,
});

export const planningRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));
  const { col } = ctx;

  app.get('/budgets', { schema: { querystring: MonthQuerySchema, response: { 200: BudgetSchema } } }, async (req) => {
    const userId = userOf(req).id;
    const tz = (await col.users.findOne({ _id: userId }))?.settings.timezone ?? 'America/Manaus';
    const month = req.query.month ?? monthOf(new Date(), tz);
    const items = await col.budgets.find({ userId, month }).sort({ categoryKey: 1 }).toArray();
    return { month, items: items.map((b) => ({ categoryKey: b.categoryKey, limitMinor: b.limitMinor })) };
  });

  /** Substitui o orcamento do mes inteiro (o Planejamento envia todas as categorias). */
  app.put('/budgets', { schema: { body: PutBudgetSchema, response: { 200: BudgetSchema } } }, async (req) => {
    const userId = userOf(req).id, { month, items } = req.body, now = new Date();
    const unique = [...new Map(items.map((i) => [i.categoryKey, i])).values()].filter((i) => i.limitMinor > 0);
    await col.budgets.deleteMany({ userId, month });
    if (unique.length)
      await col.budgets.insertMany(unique.map((i) => ({ userId, month, categoryKey: i.categoryKey, limitMinor: i.limitMinor, createdAt: now, updatedAt: now })) as never);
    return { month, items: unique };
  });

  // Planejamento automatico do mes (doc. Melhorias, passo 9).
  app.get('/planning/monthly', { schema: { querystring: MonthQuerySchema, response: { 200: MonthlyPlanSchema.nullable() } } }, async (req) => getMonthlyPlan(ctx, userOf(req).id, req.query.month));
  app.post('/planning/monthly/generate', { config: { rateLimit: perUser(5) }, schema: { response: { 200: MonthlyPlanSchema } } }, async (req) => {
    const userId = userOf(req).id;
    const plan = await buildMonthlyPlan(ctx, userId, new Date(), 'manual');
    await audit(col, 'monthly_plan.generated', userId, { month: plan.month, trigger: 'manual' }, req.ip);
    return plan;
  });
  app.patch(
    '/planning/monthly/:month',
    { config: { rateLimit: perUser(30) }, schema: { params: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), body: AdjustMonthlyPlanSchema, response: { 200: MonthlyPlanSchema } } },
    async (req) => {
      const userId = userOf(req).id;
      const plan = await adjustMonthlyPlan(ctx, userId, req.params.month, req.body);
      await audit(col, 'monthly_plan.adjusted', userId, { month: plan.month }, req.ip);
      return plan;
    },
  );

  app.get('/goals', { schema: { response: { 200: z.array(GoalSchema) } } }, async (req) =>
    (await col.goals.find({ userId: userOf(req).id }).sort({ priority: 1, deadline: 1 }).toArray()).map(toGoal),
  );

  app.post('/goals', { schema: { body: CreateGoalSchema, response: { 201: GoalSchema } } }, async (req, reply) => {
    const now = new Date();
    const doc = { ...req.body, userId: userOf(req).id, monthlyContributionMinor: 0, createdAt: now, updatedAt: now };
    const { insertedId } = await col.goals.insertOne(doc as never);
    return reply.status(201).send(toGoal({ ...doc, _id: insertedId } as GoalDoc));
  });

  app.patch('/goals/:id', { schema: { params: IdParams, body: UpdateGoalSchema, response: { 200: GoalSchema } } }, async (req) => {
    const { addMinor, ...set } = req.body;
    const g = await col.goals.findOneAndUpdate(
      { _id: new ObjectId(req.params.id), userId: userOf(req).id },
      { $set: { ...set, updatedAt: new Date() }, ...(addMinor ? { $inc: { savedMinor: addMinor } } : {}) },
      { returnDocument: 'after' },
    );
    if (!g) throw notFound('Meta');
    if (g.savedMinor < 0) await col.goals.updateOne({ _id: g._id }, { $set: { savedMinor: 0 } });
    return toGoal({ ...g, savedMinor: Math.max(0, g.savedMinor) });
  });

  app.delete('/goals/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const r = await col.goals.deleteOne({ _id: new ObjectId(req.params.id), userId: userOf(req).id });
    if (!r.deletedCount) throw notFound('Meta');
    return reply.status(204).send();
  });
};
