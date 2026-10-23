import { AiConsentSchema, DeleteAccountSchema, ExportFileSchema, ExportQuerySchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { requireAuth, requireRecentAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { deleteAccount, exportData, exportTransactionsCsv, setAiConsent } from './service';

// LGPD (doc. Pluton 8.5): exportacao e exclusao exigem autenticacao recente (sao as acoes mais
// sensiveis da conta).
export const privacyRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));

  app.get(
    '/me/export',
    { preHandler: requireRecentAuth(), config: { rateLimit: perUser(5) }, schema: { querystring: ExportQuerySchema, response: { 200: ExportFileSchema } } },
    async (req) => {
      const userId = userOf(req).id;
      const day = new Date().toISOString().slice(0, 10);
      await audit(ctx.col, 'user.exported', userId, { format: req.query.format }, req.ip);
      if (req.query.format === 'csv') return { filename: `pluto-transacoes-${day}.csv`, mime: 'text/csv;charset=utf-8', content: await exportTransactionsCsv(ctx, userId) };
      return { filename: `pluto-meus-dados-${day}.json`, mime: 'application/json', content: JSON.stringify(await exportData(ctx, userId), null, 2) };
    },
  );

  app.delete('/me', { preHandler: requireRecentAuth(), config: { rateLimit: perUser(3) }, schema: { body: DeleteAccountSchema } }, async (req, reply) => {
    await deleteAccount(ctx, userOf(req).id);
    return reply.status(204).send();
  });

  app.post('/agent/consent', { config: { rateLimit: perUser(10) }, schema: { body: AiConsentSchema } }, async (req, reply) => {
    await setAiConsent(ctx, userOf(req).id, req.body.accept, req.ip);
    return reply.status(204).send();
  });
};
