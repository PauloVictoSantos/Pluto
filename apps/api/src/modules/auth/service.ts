import { randomUUID } from 'node:crypto';
import { UserSettingsSchema, maskCpf, type Me } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { SessionDoc, UserDoc } from '../../db/collections';
import { audit } from '../../lib/audit';
import type { FieldCrypto } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { ACCESS_TTL_SEC } from '../../lib/jwt';
import { verifyPassword } from '../../lib/password';
import { normalizeRecoveryCode, randomToken, sha256 } from '../../lib/tokens';
import { verifyTotp } from '../../lib/totp';

// Secao 6.2: senha + 2FA obrigatorio, access token curto, refresh opaco rotacionado a cada uso.
const LOCK_AFTER = 5;
// Refresh de 7 dias, renovado a cada rotacao (quem usa o app toda semana nao precisa entrar de novo).
const PERSISTENT_TTL_MS = 7 * 86_400_000;
const SESSION_TTL_MS = 12 * 3_600_000;
/** Duas abas/requests renovando ao mesmo tempo nao sao tratadas como roubo. */
const ROTATION_GRACE_MS = 15_000;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  client: 'web' | 'mobile';
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'CPF ou senha inválidos');
const invalidSession = () => new AppError(401, 'INVALID_SESSION', 'Sessão expirada. Entre novamente.');

/** Chave de busca do CPF (so digitos). O prefixo separa do hash de outros identificadores. */
export const cpfHash = (crypto: FieldCrypto, cpf: string) => crypto.hash(`cpf:${cpf}`);

export const toMe = (u: UserDoc, crypto: FieldCrypto): Me => ({
  id: u._id.toHexString(),
  email: u.email,
  cpfMasked: u.cpfEnc ? maskCpf(crypto.decrypt(u.cpfEnc)) : null,
  name: u.name,
  phone: u.phone,
  // Usuarios antigos nao tem as configuracoes criadas depois (ex.: alerts): completa com os padroes.
  settings: UserSettingsSchema.parse(u.settings ?? {}),
});

export function assertNotLocked(u: UserDoc | null, now: Date) {
  if (u?.lockedUntil && u.lockedUntil > now) {
    const min = Math.ceil((u.lockedUntil.getTime() - now.getTime()) / 60_000);
    throw new AppError(429, 'ACCOUNT_LOCKED', `Muitas tentativas. Tente de novo em ${min} minuto${min > 1 ? 's' : ''}.`);
  }
}

/** Bloqueio progressivo: a partir da 5a falha, 1, 2, 4, 8... ate 60 minutos (secao 6.1). */
async function registerFailure(ctx: AppContext, u: UserDoc, now: Date) {
  const n = u.failedLogins + 1;
  const lockedUntil = n >= LOCK_AFTER ? new Date(now.getTime() + Math.min(2 ** (n - LOCK_AFTER), 60) * 60_000) : null;
  await ctx.col.users.updateOne({ _id: u._id }, { $set: { failedLogins: n, lockedUntil, updatedAt: now } });
}

/** Etapa 1: senha. Retorna o token de etapa MFA. */
export async function login(ctx: AppContext, cpf: string, password: string, meta: RequestMeta): Promise<string> {
  const now = new Date();
  const u = await ctx.col.users.findOne({ cpfHash: cpfHash(ctx.crypto, cpf) });
  assertNotLocked(u, now);
  // Sempre roda o Argon2, mesmo sem usuario, para o tempo nao revelar quais CPFs existem.
  if (!(await verifyPassword(u?.passwordHash ?? null, password)) || !u) {
    if (u) await registerFailure(ctx, u, now);
    await audit(ctx.col, 'login.failed', u?._id ?? null, { step: 'password' }, meta.ip);
    throw invalidCredentials();
  }
  if (!u.totp.enabled) throw new AppError(403, 'MFA_NOT_CONFIGURED', 'Configure o autenticador antes de entrar (pnpm user:create).');
  return ctx.jwt!.signMfa!(u._id.toHexString());
}

/** Codigo do autenticador (com protecao contra reuso) ou codigo de recuperacao (uso unico). */
async function checkSecondFactor(ctx: AppContext, u: UserDoc, code: string): Promise<'totp' | 'recovery' | null> {
  const c = code.trim().replace(/\s/g, '');
  if (/^\d{6}$/.test(c)) {
    const step = verifyTotp(ctx.crypto.decrypt(u.totp.secretEnc), c, Date.now(), u.totp.lastStep);
    if (step == null) return null;
    // Atualizacao atomica: dois requests com o mesmo codigo nao passam os dois.
    const r = await ctx.col.users.updateOne(
      { _id: u._id, $or: [{ 'totp.lastStep': null }, { 'totp.lastStep': { $lt: step } }] },
      { $set: { 'totp.lastStep': step } },
    );
    return r.modifiedCount ? 'totp' : null;
  }
  const hash = sha256(normalizeRecoveryCode(c));
  const r = await ctx.col.users.updateOne({ _id: u._id, 'totp.recoveryCodesHash': hash }, { $pull: { 'totp.recoveryCodesHash': hash } });
  return r.modifiedCount ? 'recovery' : null;
}

export async function createSession(ctx: AppContext, u: UserDoc, opts: { meta: RequestMeta; persistent: boolean; authTime: Date; familyId?: string }) {
  const now = new Date();
  const refreshToken = randomToken();
  const doc: Omit<SessionDoc, '_id'> = {
    userId: u._id,
    familyId: opts.familyId ?? randomUUID(),
    refreshTokenHash: sha256(refreshToken),
    client: opts.meta.client,
    authTime: opts.authTime,
    persistent: opts.persistent,
    ip: opts.meta.ip,
    userAgent: opts.meta.userAgent?.slice(0, 200) ?? null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + (opts.persistent ? PERSISTENT_TTL_MS : SESSION_TTL_MS)),
    rotatedAt: null,
    revokedAt: null,
  };
  const { insertedId } = await ctx.col.sessions.insertOne(doc as SessionDoc);
  const accessToken = await ctx.jwt!.sign!({
    userId: u._id.toHexString(),
    authTime: Math.floor(opts.authTime.getTime() / 1000),
    sessionId: insertedId.toHexString(),
  });
  return { refreshToken, accessToken, expiresIn: ACCESS_TTL_SEC, persistent: opts.persistent };
}

/** Etapa 2: segundo fator. Cria a sessao. */
export async function verifyMfa(ctx: AppContext, mfaToken: string, code: string, remember: boolean, meta: RequestMeta) {
  let userId: string;
  try {
    userId = await ctx.jwt!.verifyMfa(mfaToken);
  } catch {
    throw new AppError(401, 'MFA_EXPIRED', 'O tempo para digitar o código acabou. Entre novamente.');
  }
  const now = new Date();
  const u = await ctx.col.users.findOne({ _id: new ObjectId(userId) });
  if (!u) throw invalidCredentials();
  assertNotLocked(u, now);

  const factor = await checkSecondFactor(ctx, u, code);
  if (!factor) {
    await registerFailure(ctx, u, now);
    await audit(ctx.col, 'login.failed', u._id, { step: '2fa' }, meta.ip);
    throw new AppError(401, 'INVALID_CODE', 'Código inválido');
  }
  await ctx.col.users.updateOne({ _id: u._id }, { $set: { failedLogins: 0, lockedUntil: null, updatedAt: now } });
  await audit(ctx.col, 'login.success', u._id, { factor, client: meta.client }, meta.ip);
  if (factor === 'recovery') await audit(ctx.col, '2fa.recovery_code_used', u._id, { remaining: u.totp.recoveryCodesHash.length - 1 }, meta.ip);
  return { user: u, ...(await createSession(ctx, u, { meta, persistent: remember, authTime: now })) };
}

/** Rotaciona o refresh token. Reuso de um token ja rotacionado revoga a familia inteira (secao 6.2). */
export async function refresh(ctx: AppContext, refreshToken: string, meta: RequestMeta) {
  const now = new Date();
  const s = await ctx.col.sessions.findOne({ refreshTokenHash: sha256(refreshToken) });
  if (!s || s.revokedAt || s.expiresAt < now) throw invalidSession();
  if (s.rotatedAt) {
    if (now.getTime() - s.rotatedAt.getTime() < ROTATION_GRACE_MS) throw new AppError(401, 'REFRESH_RACE', 'Sessão em renovação');
    await ctx.col.sessions.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: now } });
    await audit(ctx.col, 'session.reuse_detected', s.userId, { familyId: s.familyId }, meta.ip);
    // TODO(notifications): avisar o usuario do possivel roubo de sessao.
    throw invalidSession();
  }
  const claimed = await ctx.col.sessions.updateOne({ _id: s._id, rotatedAt: null }, { $set: { rotatedAt: now } });
  if (!claimed.modifiedCount) throw new AppError(401, 'REFRESH_RACE', 'Sessão em renovação');

  const u = await ctx.col.users.findOne({ _id: s.userId });
  if (!u) throw invalidSession();
  return { user: u, ...(await createSession(ctx, u, { meta: { ...meta, client: s.client }, persistent: s.persistent, authTime: s.authTime, familyId: s.familyId })) };
}

export async function logout(ctx: AppContext, refreshToken: string | undefined, ip: string | null) {
  if (!refreshToken) return;
  const s = await ctx.col.sessions.findOne({ refreshTokenHash: sha256(refreshToken) });
  if (!s) return;
  await ctx.col.sessions.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await audit(ctx.col, 'logout', s.userId, {}, ip);
}

/** Reautenticacao para acoes sensiveis (secao 6.2): senha + 2FA renovam o authTime da sessao. */
export async function reauth(ctx: AppContext, userId: ObjectId, sessionId: string | undefined, password: string, code: string, ip: string | null) {
  const now = new Date();
  const u = await ctx.col.users.findOne({ _id: userId });
  if (!u) throw invalidSession();
  assertNotLocked(u, now);
  if (!(await verifyPassword(u.passwordHash, password)) || !(await checkSecondFactor(ctx, u, code))) {
    await registerFailure(ctx, u, now);
    await audit(ctx.col, 'reauth.failed', u._id, {}, ip);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Senha ou código inválidos');
  }
  await ctx.col.users.updateOne({ _id: u._id }, { $set: { failedLogins: 0, lockedUntil: null } });
  if (sessionId && ObjectId.isValid(sessionId)) {
    // Mantem o novo authTime nas proximas renovacoes da mesma familia.
    const s = await ctx.col.sessions.findOne({ _id: new ObjectId(sessionId) });
    if (s) await ctx.col.sessions.updateMany({ familyId: s.familyId }, { $set: { authTime: now } });
  }
  await audit(ctx.col, 'reauth.success', u._id, {}, ip);
  const accessToken = await ctx.jwt!.sign!({ userId: u._id.toHexString(), authTime: Math.floor(now.getTime() / 1000), sessionId });
  return { accessToken, expiresIn: ACCESS_TTL_SEC };
}
