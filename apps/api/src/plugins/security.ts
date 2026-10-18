import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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
    // Origens fora da lista nao recebem cabecalhos CORS: o navegador bloqueia a resposta.
    // Rotas que usam cookie tambem verificam Origin explicitamente (CSRF, modulo auth).
    origin: (origin, cb) => cb(null, !origin || env.ALLOWED_ORIGINS.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization', 'x-pluto-client'],
  });

  // Chave padrao: req.ip. Com trustProxy em loopback (app.ts), atras do proxy do Next e o IP
  // real do cliente (ultimo endereco nao confiavel do X-Forwarded-For), nao o do proxy.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Os testes fazem dezenas de logins seguidos do mesmo IP.
    allowList: () => env.NODE_ENV === 'test',
  });
}

/**
 * Limite por usuario para rotas autenticadas: roda depois do requireAuth (preHandler), entao a
 * chave e a conta verificada pelo token. Um usuario nao gasta o limite de outro.
 */
export const perUser = (max: number, timeWindow = '1 minute') => ({
  max,
  timeWindow,
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => (req.user ? `user:${req.user.id.toHexString()}` : req.ip),
});
