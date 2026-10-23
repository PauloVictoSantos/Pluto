import {
  ConfirmGoalDraftSchema,
  CreateGoalDraftSchema,
  DiscardGoalDraftSchema,
  GoalAnswersSchema,
  GoalDraftSchema,
  GoalStatusChangeSchema,
  GoalsPlanSchema,
  PurchaseEvaluationSchema,
  PurchaseRequestSchema,
  PurchasesSchema,
  AgentChatRequestSchema,
  AgentChatStateSchema,
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
import { answerDraft, confirmDraft, createDraft, diagnoseDraft, discardDraft, getDraft, goalsPlan, listDrafts, setGoalStatus } from './goals';
import { getLimit, overrideLimit } from './limit';
import { chatState, resetChat, sendMessage } from './plutao/orchestrator';
import { boughtPurchase, evaluateAndSave, giveUpPurchase, listPurchases, planPurchase, purchaseToGoal, simulatePurchase } from './purchases';
import { createLoan, listLoans, loanExtra, removeLoan, updateLoan } from './loans';
import { getProfile, updateProfile } from './profile';

const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });
const FIXED = { response: { 200: FixedExpensesSchema } };
const LOANS = { response: { 200: LoansSchema } };
const DRAFT = { response: { 200: GoalDraftSchema } };

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

  // Metas v2 (doc. Pluton 4): intencao -> entrevista -> diagnostico -> proposta -> confirmacao.
  app.get('/agent/goal-drafts', { schema: { response: { 200: z.array(GoalDraftSchema) } } }, async (req) => listDrafts(ctx, userOf(req).id));
  app.get('/agent/goal-drafts/:id', { schema: { params: IdParam, ...DRAFT } }, async (req) => getDraft(ctx, userOf(req).id, req.params.id));

  app.post('/agent/goal-drafts', { config: { rateLimit: perUser(30) }, schema: { body: CreateGoalDraftSchema, ...DRAFT } }, async (req) => {
    const userId = userOf(req).id;
    const d = await createDraft(ctx, userId, req.body.kind, req.body.title);
    await audit(ctx.col, 'goal_draft.created', userId, { draftId: d.id, kind: d.kind }, req.ip);
    return d;
  });

  app.patch('/agent/goal-drafts/:id', { config: { rateLimit: perUser(60) }, schema: { params: IdParam, body: GoalAnswersSchema, ...DRAFT } }, async (req) =>
    answerDraft(ctx, userOf(req).id, req.params.id, req.body),
  );

  app.post('/agent/goal-drafts/:id/diagnose', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, ...DRAFT } }, async (req) => {
    const userId = userOf(req).id;
    const d = await diagnoseDraft(ctx, userId, req.params.id);
    await audit(ctx.col, 'goal_draft.diagnosed', userId, { draftId: d.id, verdict: d.diagnosis?.verdict, score: d.diagnosis?.score }, req.ip);
    return d;
  });

  app.post('/agent/goal-drafts/:id/confirm', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, body: ConfirmGoalDraftSchema, ...DRAFT } }, async (req) => {
    const userId = userOf(req).id;
    const r = await confirmDraft(ctx, userId, req.params.id, req.body.scenario);
    await audit(ctx.col, 'goal.created', userId, { draftId: r.draft.id, goalId: r.goalId, scenario: r.scenario, pausedGoalId: r.pausedGoalId }, req.ip);
    return r.draft;
  });

  app.post('/agent/goal-drafts/:id/discard', { schema: { params: IdParam, body: DiscardGoalDraftSchema, ...DRAFT } }, async (req) => {
    const userId = userOf(req).id;
    const d = await discardDraft(ctx, userId, req.params.id, req.body.reason);
    await audit(ctx.col, 'goal_draft.discarded', userId, { draftId: d.id, reason: req.body.reason }, req.ip);
    return d;
  });

  app.get('/agent/goals/plan', { schema: { response: { 200: GoalsPlanSchema } } }, async (req) => goalsPlan(ctx, userOf(req).id));

  app.patch('/agent/goals/:id/status', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, body: GoalStatusChangeSchema, response: { 200: GoalsPlanSchema } } }, async (req) => {
    const userId = userOf(req).id;
    const change = await setGoalStatus(ctx, userId, req.params.id, req.body.status);
    await audit(ctx.col, 'goal.status_changed', userId, { goalId: req.params.id, ...change }, req.ip);
    return goalsPlan(ctx, userId);
  });

  // Chat com o Plutao (doc. Pluton 7): substitui o "Perguntar a Pluto". Cada mensagem pode custar
  // algumas chamadas ao provedor.
  const CHAT = { response: { 200: AgentChatStateSchema } };
  app.get('/agent/chat', { schema: CHAT }, async (req) => chatState(ctx, userOf(req).id));
  app.post('/agent/chat', { config: { rateLimit: perUser(30) }, schema: { body: AgentChatRequestSchema, ...CHAT } }, async (req) => sendMessage(ctx, userOf(req).id, req.body.message, req.ip));
  app.post('/agent/chat/reset', { schema: CHAT }, async (req) => resetChat(ctx, userOf(req).id));

  // Avaliacao de compra (doc. Pluton 3.4). "simulate" e a ferramenta simular_compra: so calcula.
  const PURCHASE = { response: { 200: PurchaseEvaluationSchema } };
  app.get('/agent/purchases', { schema: { response: { 200: PurchasesSchema } } }, async (req) => listPurchases(ctx, userOf(req).id));
  app.post('/agent/purchases/simulate', { config: { rateLimit: perUser(30) }, schema: { body: PurchaseRequestSchema, ...PURCHASE } }, async (req) => simulatePurchase(ctx, userOf(req).id, req.body));
  app.post('/agent/purchases', { config: { rateLimit: perUser(30) }, schema: { body: PurchaseRequestSchema, ...PURCHASE } }, async (req) => {
    const userId = userOf(req).id;
    const e = await evaluateAndSave(ctx, userId, req.body);
    await audit(ctx.col, 'purchase.evaluated', userId, { purchaseId: e.id, verdict: e.verdict, reason: e.reason }, req.ip);
    return e;
  });
  app.post('/agent/purchases/:id/plan', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, ...PURCHASE } }, async (req) => {
    const userId = userOf(req).id;
    const e = await planPurchase(ctx, userId, req.params.id);
    await audit(ctx.col, 'purchase.planned', userId, { purchaseId: e.id, verdict: e.verdict }, req.ip);
    return e;
  });
  app.post('/agent/purchases/:id/bought', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, ...PURCHASE } }, async (req) => {
    const userId = userOf(req).id;
    const e = await boughtPurchase(ctx, userId, req.params.id);
    await audit(ctx.col, e.status === 'desvio' ? 'purchase.deviation' : 'purchase.bought', userId, { purchaseId: e.id, verdict: e.verdict }, req.ip);
    return e;
  });
  app.post('/agent/purchases/:id/give-up', { schema: { params: IdParam, ...PURCHASE } }, async (req) => {
    const userId = userOf(req).id;
    const e = await giveUpPurchase(ctx, userId, req.params.id);
    await audit(ctx.col, 'purchase.given_up', userId, { purchaseId: e.id }, req.ip);
    return e;
  });
  /** RECUSAR oferece o plano como meta: abre um rascunho ja com as respostas da compra. */
  app.post('/agent/purchases/:id/to-goal', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, ...DRAFT } }, async (req) => purchaseToGoal(ctx, userOf(req).id, req.params.id));

  /** Simula amortizar um valor hoje: juros evitados e meses a menos. */
  app.get('/agent/loans/:id/extra', { schema: { params: IdParam, querystring: LoanExtraQuerySchema, response: { 200: LoanExtraSchema } } }, async (req) =>
    loanExtra(ctx, userOf(req).id, req.params.id, req.query.amountMinor),
  );
};
