import { CreateFixedExpenseSchema, FinancialProfileSchema, FixedExpensesSchema, UpdateFinancialProfileSchema, UpdateFixedExpenseSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { createFixed, listFixed, removeFixed, updateFixed } from './fixed';
import { getProfile, updateProfile } from './profile';

const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });
const FIXED = { response: { 200: FixedExpensesSchema } };

// Agente Plutao (doc. Pluton): perfil financeiro e gastos fixos que alimentam os calculos.
export const agentRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));

  app.get('/agent/profile', { schema: { response: { 200: FinancialProfileSchema } } }, async (req) => getProfile(ctx, userOf(req).id));

  app.put('/agent/profile', { config: { rateLimit: perUser(30) }, schema: { body: UpdateFinancialProfileSchema, response: { 200: FinancialProfileSchema } } }, async (req) => {
    const userId = userOf(req).id;
    const change = await updateProfile(ctx, userId, req.body);
    await audit(ctx.col, 'agent_profile.updated', userId, change, req.ip);
    return getProfile(ctx, userId);
  });

  // Gastos fixos (GF-01: a tela e o chat usam estes mesmos endpoints). Toda escrita devolve a lista
  // atualizada; o recalculo do limite (GF-05) entra com o limite gerenciado.
  app.get('/agent/fixed-expenses', { schema: FIXED }, async (req) => listFixed(ctx, userOf(req).id));

  app.post('/agent/fixed-expenses', { config: { rateLimit: perUser(30) }, schema: { body: CreateFixedExpenseSchema, ...FIXED } }, async (req) => {
    const userId = userOf(req).id;
    const created = await createFixed(ctx, userId, req.body);
    await audit(ctx.col, 'fixed_expense.created', userId, { after: created }, req.ip);
    return listFixed(ctx, userId);
  });

  app.patch('/agent/fixed-expenses/:id', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, body: UpdateFixedExpenseSchema, ...FIXED } }, async (req) => {
    const userId = userOf(req).id;
    const change = await updateFixed(ctx, userId, req.params.id, req.body);
    await audit(ctx.col, 'fixed_expense.updated', userId, change, req.ip);
    return listFixed(ctx, userId);
  });

  app.delete('/agent/fixed-expenses/:id', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, ...FIXED } }, async (req) => {
    const userId = userOf(req).id;
    const removed = await removeFixed(ctx, userId, req.params.id);
    await audit(ctx.col, 'fixed_expense.deleted', userId, { before: removed }, req.ip);
    return listFixed(ctx, userId);
  });
};
