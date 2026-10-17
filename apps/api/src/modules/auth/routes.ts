import {
  CLIENT_HEADER,
  LoginSchema,
  MeSchema,
  MfaChallengeSchema,
  ReauthSchema,
  RefreshSchema,
  TokensSchema,
  UpdateMeSchema,
  VerifyMfaSchema,
} from '@pluto/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { requireAuth, userOf } from '../../plugins/auth';
import { login, logout, reauth, refresh, toMe, verifyMfa, type RequestMeta } from './service';

// Web: refresh em cookie HttpOnly; Secure; SameSite=Strict, prefixo __Host- (secoes 6.2 e 6.7).
// Mobile: refresh no corpo, guardado no Keychain/Keystore pelo app.
export const REFRESH_COOKIE = '__Host-pluto_rt';
const COOKIE_MAX_AGE_SEC = 30 * 86_400;

const meta = (req: FastifyRequest): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.headers['user-agent'] ?? null,
  client: req.headers[CLIENT_HEADER] === 'mobile' ? 'mobile' : 'web',
});

export const authRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  if (!ctx.jwt?.sign) app.log.warn('JWT_PRIVATE_KEY ausente: login desativado');

  /** CSRF (secao 6.7): requests que usam o cookie precisam vir de uma origem permitida. */
  const assertOrigin = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    if (!origin || !ctx.env.ALLOWED_ORIGINS.includes(origin)) throw new AppError(403, 'BAD_ORIGIN', 'Origem não permitida');
  };

  const sendTokens = (req: FastifyRequest, reply: FastifyReply, t: { accessToken: string; expiresIn: number; refreshToken: string; persistent: boolean }) => {
    if (meta(req).client === 'mobile') return { accessToken: t.accessToken, expiresIn: t.expiresIn, refreshToken: t.refreshToken };
    reply.setCookie(REFRESH_COOKIE, t.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      ...(t.persistent ? { maxAge: COOKIE_MAX_AGE_SEC } : {}),
    });
    return { accessToken: t.accessToken, expiresIn: t.expiresIn };
  };

  const ensureLogin = () => {
    if (!ctx.jwt?.sign) throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Login indisponível');
  };

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: LoginSchema, response: { 200: MfaChallengeSchema } } },
    async (req) => {
      ensureLogin();
      return { mfaRequired: true as const, mfaToken: await login(ctx, req.body.email, req.body.password, meta(req)) };
    },
  );

  app.post(
    '/auth/2fa/verify',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: VerifyMfaSchema, response: { 200: TokensSchema } } },
    async (req, reply) => {
      ensureLogin();
      if (meta(req).client === 'web') assertOrigin(req);
      const r = await verifyMfa(ctx, req.body.mfaToken, req.body.code, req.body.remember, meta(req));
      return sendTokens(req, reply, r);
    },
  );

  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { body: RefreshSchema, response: { 200: TokensSchema } } },
    async (req, reply) => {
      ensureLogin();
      const fromBody = req.body?.refreshToken;
      if (!fromBody) assertOrigin(req);
      const token = fromBody ?? req.cookies[REFRESH_COOKIE];
      if (!token) throw new AppError(401, 'INVALID_SESSION', 'Sessão expirada. Entre novamente.');
      try {
        return sendTokens(req, reply, await refresh(ctx, token, meta(req)));
      } catch (e) {
        // Sessao invalida: limpa o cookie para o navegador nao insistir.
        if (!fromBody && e instanceof AppError && e.code === 'INVALID_SESSION') reply.clearCookie(REFRESH_COOKIE, { path: '/' });
        throw e;
      }
    },
  );

  app.post('/auth/logout', { schema: { body: RefreshSchema } }, async (req, reply) => {
    const fromBody = req.body?.refreshToken;
    if (!fromBody) assertOrigin(req);
    await logout(ctx, fromBody ?? req.cookies[REFRESH_COOKIE], req.ip);
    reply.clearCookie(REFRESH_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  // Rotas autenticadas
  await app.register(async (instance) => {
    const authed = instance.withTypeProvider<ZodTypeProvider>();
    authed.addHook('preHandler', requireAuth(ctx));

    authed.post(
      '/auth/reauth',
      { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: ReauthSchema, response: { 200: TokensSchema } } },
      async (req) => {
        const u = userOf(req);
        return reauth(ctx, u.id, u.sessionId, req.body.password, req.body.code, req.ip);
      },
    );

    authed.get('/me', { schema: { response: { 200: MeSchema } } }, async (req) => {
      const u = await ctx.col.users.findOne({ _id: userOf(req).id });
      if (!u) throw new AppError(401, 'INVALID_SESSION', 'Sessão expirada. Entre novamente.');
      return toMe(u);
    });

    authed.patch('/me', { schema: { body: UpdateMeSchema, response: { 200: MeSchema } } }, async (req) => {
      const auth = userOf(req);
      const u = await ctx.col.users.findOne({ _id: auth.id });
      if (!u) throw new AppError(401, 'INVALID_SESSION', 'Sessão expirada. Entre novamente.');
      const { name, phone, email } = req.body;
      if (email && email !== u.email) {
        // Trocar o e-mail de login e acao sensivel (secao 6.2).
        if (Date.now() / 1000 - auth.authTime > 10 * 60) throw new AppError(401, 'REAUTH_REQUIRED', 'Confirme sua identidade para continuar');
        if (await ctx.col.users.findOne({ email, _id: { $ne: u._id } })) throw new AppError(409, 'EMAIL_IN_USE', 'Este e-mail já está em uso');
        await audit(ctx.col, 'user.email_changed', u._id, {}, req.ip);
      }
      const updated = await ctx.col.users.findOneAndUpdate(
        { _id: u._id },
        { $set: { ...(name !== undefined ? { name } : {}), ...(phone !== undefined ? { phone } : {}), ...(email ? { email } : {}), updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return toMe(updated!);
    });
  });
};
