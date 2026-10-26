import { InvestmentBoxesSchema, LinkBoxGoalSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { linkBoxGoal, listBoxes } from './boxes';

// Caixinhas e investimentos com projecao de rendimento e meta ligada (tela Investimentos).
export const investmentRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));
  app.get('/investments/boxes', { schema: { response: { 200: InvestmentBoxesSchema } } }, async (req) => listBoxes(ctx, userOf(req).id));
  app.put(
    '/investments/boxes/:id/goal',
    { config: { rateLimit: perUser(30) }, schema: { params: z.object({ id: z.string().regex(/^(inv|acc):[a-f0-9]{24}$/) }), body: LinkBoxGoalSchema, response: { 200: InvestmentBoxesSchema } } },
    async (req) => {
      await linkBoxGoal(ctx, userOf(req).id, req.params.id, req.body.goalId);
      return listBoxes(ctx, userOf(req).id);
    },
  );
};
