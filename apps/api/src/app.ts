import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import { API_PREFIX } from '@pluto/shared';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppContext } from './context';
import { authRoutes } from './modules/auth/routes';
import { connectionRoutes } from './modules/connections/routes';
import { financeRoutes } from './modules/finance/routes';
import { healthRoutes } from './modules/health/routes';
import { registerErrorHandler } from './plugins/errors';
import { registerSecurity } from './plugins/security';

export async function buildApp(ctx: AppContext) {
  const { env } = ctx;
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      // Logs sem tokens nem dados pessoais (secoes 6.3 e 9.2).
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        remove: true,
      },
    },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: false,
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);
  await registerSecurity(app, env);
  await app.register(cookie);

  await app.register(
    async (v1) => {
      await v1.register(healthRoutes, { ping: ctx.pingDb });
      await v1.register(authRoutes, { ctx });
      await v1.register(connectionRoutes, { prefix: '/connections', ctx });
      await v1.register(financeRoutes, { ctx });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
