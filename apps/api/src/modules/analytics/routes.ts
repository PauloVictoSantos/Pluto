import { BudgetSuggestionSchema, CommitmentsSchema, ForecastSchema, GoalInsightsSchema, FinancialHealthSchema, PatternsSchema, PaymentPlanSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../../context';
import { requireAuth, userOf } from '../../plugins/auth';
import { budgetSuggestion, forecast, goalInsights, paymentPlan } from './forecast';
import { financialHealth } from './health';
import { patterns } from './patterns';
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

  /** Mapa dia x horario, mudancas de habito, tendencia e explicacao da variacao (Relatorios). */
  app.get('/analytics/patterns', { schema: { response: { 200: PatternsSchema } } }, async (req) => patterns(ctx, userOf(req).id));

  /** Saude financeira (0 a 100) com os indicadores do doc. Pluton e a nota do mes anterior. */
  app.get('/analytics/health', { schema: { response: { 200: FinancialHealthSchema } } }, async (req) => financialHealth(ctx, userOf(req).id));

  app.get('/analytics/payments', { schema: { response: { 200: PaymentPlanSchema } } }, async (req) => paymentPlan(ctx, userOf(req).id));
};
