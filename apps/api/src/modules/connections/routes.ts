import {
  ConnectTokenSchema,
  ConnectionSchema,
  CreateConnectionSchema,
  DeleteConnectionQuerySchema,
  ImportConnectionSchema,
  SyncResultSchema,
} from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pluggyOf, type AppContext } from '../../context';
import { perUser } from '../../plugins/security';
import { requireAuth, requireRecentAuth, userOf } from '../../plugins/auth';
import { syncConnection } from '../sync/service';
import { createConnectToken, findOwnConnection, listConnections, registerConnection, removeConnection, toConnectionDTO } from './service';

const IdParams = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });

export const connectionRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));
  const syncDeps = () => ({ col: ctx.col, pluggy: pluggyOf(ctx), crypto: ctx.crypto, log: app.log });

  app.post(
    '/token',
    {
      config: { rateLimit: perUser(10) },
      schema: { body: z.object({ connectionId: z.string().regex(/^[a-f0-9]{24}$/).optional() }).nullish(), response: { 200: ConnectTokenSchema } },
    },
    async (req) => ({ accessToken: await createConnectToken(ctx, userOf(req).id, req.body?.connectionId) }),
  );

  app.post(
    '/',
    { preHandler: requireRecentAuth(), config: { rateLimit: perUser(10) }, schema: { body: CreateConnectionSchema, response: { 201: ConnectionSchema } } },
    async (req, reply) => {
      const conn = await registerConnection(ctx, userOf(req).id, req.body.itemId, req.ip);
      // Sincronizacao inicial em segundo plano (secao 3.7, passo 4).
      void syncConnection(syncDeps(), conn._id).catch((err) => app.log.error({ err }, 'falha na sincronizacao inicial'));
      return reply.status(201).send(toConnectionDTO(conn));
    },
  );

  app.post(
    '/import',
    {
      preHandler: requireRecentAuth(),
      config: { rateLimit: perUser(10) },
      schema: { body: ImportConnectionSchema, response: { 201: ConnectionSchema } },
    },
    async (req, reply) => {
      const conn = await registerConnection(ctx, userOf(req).id, req.body.itemId, req.ip, 'MEU_PLUGGY');
      void syncConnection(syncDeps(), conn._id).catch((err) => app.log.error({ err }, 'falha na sincronizacao inicial'));
      return reply.status(201).send(toConnectionDTO(conn));
    },
  );

  app.get('/', { schema: { response: { 200: z.array(ConnectionSchema) } } }, async (req) =>
    (await listConnections(ctx, userOf(req).id)).map(toConnectionDTO),
  );

  app.post(
    '/:id/sync',
    { config: { rateLimit: perUser(6) }, schema: { params: IdParams, response: { 200: SyncResultSchema } } },
    async (req) => {
      const conn = await findOwnConnection(ctx, userOf(req).id, req.params.id);
      return syncConnection(syncDeps(), conn._id, { force: true });
    },
  );

  app.delete(
    '/:id',
    { preHandler: requireRecentAuth(), schema: { params: IdParams, querystring: DeleteConnectionQuerySchema } },
    async (req, reply) => {
      await removeConnection(ctx, userOf(req).id, req.params.id, req.query.keepHistory, req.ip);
      return reply.status(204).send();
    },
  );
};
