import type { FastifyReply, FastifyRequest } from 'fastify';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../context';
import { AppError } from '../lib/errors';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: ObjectId; authTime: number; sessionId?: string };
  }
}

const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária');

/**
 * preHandler que exige access token valido (Authorization: Bearer). O userId vem SEMPRE do
 * token, nunca do corpo (secao 6.3). Se o token tem sessao, ela precisa estar ativa: revogar
 * um dispositivo derruba o acesso na hora (secao 6.2).
 */
export function requireAuth(ctx: Pick<AppContext, 'jwt' | 'col'>) {
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!ctx.jwt || !header?.startsWith('Bearer ')) throw unauthorized();
    let claims;
    try {
      claims = await ctx.jwt.verify(header.slice(7));
    } catch {
      throw unauthorized();
    }
    if (!ObjectId.isValid(claims.userId)) throw unauthorized();
    if (claims.sessionId) {
      if (!ObjectId.isValid(claims.sessionId)) throw unauthorized();
      const s = await ctx.col.sessions.findOne({ _id: new ObjectId(claims.sessionId) }, { projection: { revokedAt: 1 } });
      if (!s || s.revokedAt) throw unauthorized();
    }
    req.user = { id: new ObjectId(claims.userId), authTime: claims.authTime, sessionId: claims.sessionId };
  };
}

/** Acoes sensiveis exigem autenticacao forte recente (secao 6.2). */
export function requireRecentAuth(maxAgeSec = 10 * 60) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const u = req.user;
    if (!u) throw unauthorized();
    if (Date.now() / 1000 - u.authTime > maxAgeSec) throw new AppError(401, 'REAUTH_REQUIRED', 'Confirme sua identidade para continuar');
  };
}

export const userOf = (req: FastifyRequest) => {
  if (!req.user) throw unauthorized();
  return req.user;
};
