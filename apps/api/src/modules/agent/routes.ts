import { FinancialProfileSchema, UpdateFinancialProfileSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { getProfile, updateProfile } from './profile';

// Agente Plutao (doc. Pluton). Etapa 1: perfil financeiro que alimenta os calculos.
export const agentRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));

  app.get('/agent/profile', { schema: { response: { 200: FinancialProfileSchema } } }, async (req) => getProfile(ctx, userOf(req).id));

  app.put('/agent/profile', { config: { rateLimit: perUser(30) }, schema: { body: UpdateFinancialProfileSchema, response: { 200: FinancialProfileSchema } } }, async (req) => {
    const userId = userOf(req).id;
    const change = await updateProfile(ctx, userId, req.body);
    await audit(ctx.col, 'agent_profile.updated', userId, change, req.ip);
    return getProfile(ctx, userId);
  });
};
