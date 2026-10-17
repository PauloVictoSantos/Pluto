import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';

// Secao 6.3: Helmet, CORS sem curinga, rate limit.
export async function registerSecurity(app: FastifyInstance, env: Env) {
  await app.register(helmet, {
    // A API so serve JSON; CSP do site fica no Next.js (secao 6.7).
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: { maxAge: 63072000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Requisicoes sem Origin (curl, apps nativos sem WebView) passam; o resto precisa estar na lista.
      if (!origin || env.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error('Origin nao permitida'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });
}
