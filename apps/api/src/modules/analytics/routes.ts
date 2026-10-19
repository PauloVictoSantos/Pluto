import { BudgetSuggestionSchema, CommitmentsSchema, ForecastSchema, GoalInsightsSchema, PaymentPlanSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../../context';
import { requireAuth, userOf } from '../../plugins/auth';
import { budgetSuggestion, forecast, goalInsights, paymentPlan } from './forecast';
import { commitments, refreshRecurrences } from './service';

// Camada analitica: numeros calculados aqui; a interface e o Gemini so exibem e explicam (RN-I01).
export const analyticsRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));

  /** Recorrencias e parcelas por vir. Sem series calculadas ainda (antes da 1a sincronizacao), calcula agora. */
  app.get('/analytics/commitments', { schema: { response: { 200: CommitmentsSchema } } }, async (req) => {
    const userId = userOf(req).id;
    if (!(await ctx.col.recurrences.countDocuments({ userId }, { limit: 1 }))) await refreshRecurrences(ctx.col, userId);
    return commitments(ctx.col, userId);
  });

  /** Saldo no fim do mes em faixa P10-P90 e chance de fechar no azul (Visao geral). */
  app.get('/analytics/forecast', { schema: { response: { 200: ForecastSchema } } }, async (req) => forecast(ctx, userOf(req).id));

  /** Rascunho de orcamento; so vale depois que o usuario aceita (PUT /budgets, RN-M06). */
  app.get('/analytics/budget', { schema: { response: { 200: BudgetSuggestionSchema } } }, async (req) => budgetSuggestion(ctx, userOf(req).id));

  app.get('/analytics/goals', { schema: { response: { 200: GoalInsightsSchema } } }, async (req) => goalInsights(ctx, userOf(req).id));

  app.get('/analytics/payments', { schema: { response: { 200: PaymentPlanSchema } } }, async (req) => paymentPlan(ctx, userOf(req).id));
};
