import { randomUUID } from 'node:crypto';
import { API_PREFIX } from '@pluto/shared';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './config/env';
import { healthRoutes } from './modules/health/routes';
import { registerErrorHandler } from './plugins/errors';
import { registerSecurity } from './plugins/security';

export interface AppDeps {
  env: Env;
  pingDb: () => Promise<boolean>;
}

export async function buildApp({ env, pingDb }: AppDeps) {
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

  await app.register(
    async (v1) => {
      await v1.register(healthRoutes, { ping: pingDb });
      // Modulos (auth, connections, transactions, ...) serao registrados aqui.
    },
    { prefix: API_PREFIX },
  );

  return app;
}
