import { CommitmentsSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../../context';
import { requireAuth, userOf } from '../../plugins/auth';
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
};
