import {
  CreateFixedExpenseSchema,
  CreateLoanSchema,
  FinancialProfileSchema,
  FixedExpensesSchema,
  LoanExtraQuerySchema,
  LoanExtraSchema,
  LoansSchema,
  OverrideLimitSchema,
  SpendingLimitSchema,
  UpdateFinancialProfileSchema,
  UpdateFixedExpenseSchema,
  UpdateLoanSchema,
} from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { createFixed, listFixed, removeFixed, updateFixed } from './fixed';
import { getLimit, overrideLimit } from './limit';
import { createLoan, listLoans, loanExtra, removeLoan, updateLoan } from './loans';
import { getProfile, updateProfile } from './profile';

const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });
const FIXED = { response: { 200: FixedExpensesSchema } };
const LOANS = { response: { 200: LoansSchema } };

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

  // Dividas com juros: a auditoria registra credor, tipo e taxa, nunca saldo e parcela (criptografados).
  app.get('/agent/loans', { schema: LOANS }, async (req) => listLoans(ctx, userOf(req).id));

  app.post('/agent/loans', { config: { rateLimit: perUser(30) }, schema: { body: CreateLoanSchema, ...LOANS } }, async (req) => {
    const userId = userOf(req).id;
    const created = await createLoan(ctx, userId, req.body);
    await audit(ctx.col, 'loan.created', userId, { after: created }, req.ip);
    return listLoans(ctx, userId);
  });

  app.patch('/agent/loans/:id', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, body: UpdateLoanSchema, ...LOANS } }, async (req) => {
    const userId = userOf(req).id;
    const change = await updateLoan(ctx, userId, req.params.id, req.body);
    await audit(ctx.col, 'loan.updated', userId, change, req.ip);
    return listLoans(ctx, userId);
  });

  app.delete('/agent/loans/:id', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, ...LOANS } }, async (req) => {
    const userId = userOf(req).id;
    const removed = await removeLoan(ctx, userId, req.params.id);
    await audit(ctx.col, 'loan.deleted', userId, { before: removed }, req.ip);
    return listLoans(ctx, userId);
  });

  // Limite de gasto do mes (LG-01..06). O recalculo apos mudancas fica no hook do app (onPlanChange).
  app.get('/agent/limit', { schema: { response: { 200: SpendingLimitSchema } } }, async (req) => getLimit(ctx, userOf(req).id));

  app.put('/agent/limit/override', { config: { rateLimit: perUser(20) }, schema: { body: OverrideLimitSchema, response: { 200: SpendingLimitSchema } } }, async (req) => {
    const userId = userOf(req).id;
    await overrideLimit(ctx, userId, req.body.amountMinor, req.ip);
    return getLimit(ctx, userId);
  });

  /** Simula amortizar um valor hoje: juros evitados e meses a menos. */
  app.get('/agent/loans/:id/extra', { schema: { params: IdParam, querystring: LoanExtraQuerySchema, response: { 200: LoanExtraSchema } } }, async (req) =>
    loanExtra(ctx, userOf(req).id, req.params.id, req.query.amountMinor),
  );
};
