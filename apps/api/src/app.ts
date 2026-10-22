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
import { analyticsRoutes } from './modules/analytics/routes';
import { alertRoutes } from './modules/alerts/routes';
import { assistantRoutes } from './modules/assistant/routes';
import { billRoutes } from './modules/bills/routes';
import { debtRoutes } from './modules/debts/routes';
import { merchantRoutes } from './modules/merchants/routes';
import { recalcLimit } from './modules/agent/limit';
import { agentRoutes } from './modules/agent/routes';

/** Mudancas que alteram o plano (renda, fixos, dividas, metas). */
const PLAN_ROUTES = /\/(agent\/(profile|fixed-expenses|loans)|goals|debts)(\/|$)/;
import { shoppingRoutes } from './modules/shopping/routes';
import { chargeRoutes, stripeWebhookRoutes } from './modules/charges/routes';
import { authRoutes } from './modules/auth/routes';
import { connectionRoutes } from './modules/connections/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { financeRoutes } from './modules/finance/routes';
import { healthRoutes } from './modules/health/routes';
import { planningRoutes } from './modules/planning/routes';
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
    // So o proxy do Next na mesma maquina e confiavel: req.ip vira o cliente real (X-Forwarded-For),
    // e um cliente remoto falando direto com a API nao consegue forjar o IP.
    trustProxy: 'loopback',
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);
  await registerSecurity(app, env);
  await app.register(cookie);

  await app.register(
    async (v1) => {
      v1.addHook('onSend', async (req, reply, payload) => {
        if (req.method !== 'GET' && reply.statusCode < 300 && req.user && PLAN_ROUTES.test(req.routeOptions.url ?? '')) {
          await recalcLimit(ctx, req.user.id, `${req.method} ${req.routeOptions.url}`).catch((err) => req.log.error({ err }, 'falha ao recalcular o limite'));
        }
        return payload;
      });
      await v1.register(healthRoutes, { ping: ctx.pingDb });
      await v1.register(authRoutes, { ctx });
      await v1.register(connectionRoutes, { prefix: '/connections', ctx });
      await v1.register(financeRoutes, { ctx });
      await v1.register(dashboardRoutes, { ctx });
      await v1.register(planningRoutes, { ctx });
      await v1.register(analyticsRoutes, { ctx });
      await v1.register(shoppingRoutes, { ctx });
      await v1.register(billRoutes, { ctx });
      await v1.register(debtRoutes, { ctx });
      await v1.register(merchantRoutes, { ctx });
      await v1.register(agentRoutes, { ctx });
      await v1.register(alertRoutes, { ctx });
      await v1.register(assistantRoutes, { ctx });
      await v1.register(chargeRoutes, { ctx });
      await v1.register(stripeWebhookRoutes, { ctx });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
