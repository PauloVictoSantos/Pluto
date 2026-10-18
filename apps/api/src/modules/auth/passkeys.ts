import type { Passkey } from '@pluto/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Binary, ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { PasskeyDoc } from '../../db/collections';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { assertNotLocked, createSession, type RequestMeta } from './service';

// Passkeys (WebAuthn, secao 6.2): a biometria do aparelho libera uma chave privada que nunca sai
// dele. Exigimos verificacao do usuario (digital/rosto/PIN), entao a passkey vale como login
// completo: algo que voce tem (o aparelho) + algo que voce e (biometria). Nao funciona em site falso.

const CHALLENGE_TTL_MS = 5 * 60_000;

/** O RP ID e o dominio do site; as origens aceitas sao as mesmas do CORS/CSRF. */
export const relyingParty = (ctx: AppContext) => ({
  rpID: ctx.env.WEBAUTHN_RP_ID ?? new URL(ctx.env.ALLOWED_ORIGINS[0]!).hostname,
  origins: ctx.env.ALLOWED_ORIGINS,
});

const toPasskeyDTO = (p: PasskeyDoc): Passkey => ({ id: p._id.toHexString(), name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt });

async function saveChallenge(ctx: AppContext, challenge: string, purpose: 'register' | 'login', userId: ObjectId | null) {
  const { insertedId } = await ctx.col.webauthnChallenges.insertOne({
    challenge,
    purpose,
    userId,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  } as never);
  return insertedId.toHexString();
}

/** Uso unico: o desafio e apagado ao ser lido, mesmo que a verificacao falhe depois. */
async function takeChallenge(ctx: AppContext, id: string, purpose: 'register' | 'login', userId: ObjectId | null) {
  const c = await ctx.col.webauthnChallenges.findOneAndDelete({ _id: new ObjectId(id), purpose, userId, expiresAt: { $gt: new Date() } });
  if (!c) throw new AppError(400, 'CHALLENGE_EXPIRED', 'O tempo para confirmar acabou. Tente de novo.');
  return c.challenge;
}

export async function listPasskeys(ctx: AppContext, userId: ObjectId) {
  return (await ctx.col.passkeys.find({ userId }).sort({ createdAt: 1 }).toArray()).map(toPasskeyDTO);
}

export async function registrationOptions(ctx: AppContext, userId: ObjectId) {
  const u = await ctx.col.users.findOne({ _id: userId });
  if (!u) throw new AppError(401, 'INVALID_SESSION', 'Sessão expirada. Entre novamente.');
  const existing = await ctx.col.passkeys.find({ userId }).toArray();
  const { rpID } = relyingParty(ctx);
  const options = await generateRegistrationOptions({
    rpName: 'Pluto',
    rpID,
    userID: new TextEncoder().encode(userId.toHexString()),
    userName: u.email,
    userDisplayName: u.name,
    attestationType: 'none',
    // Nao cadastrar de novo a mesma chave neste aparelho.
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as AuthenticatorTransportFuture[] })),
    // Passkey "descobrivel" (login sem digitar CPF) e com biometria/PIN obrigatoria.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { challengeId: await saveChallenge(ctx, options.challenge, 'register', userId), options: { ...options } as Record<string, unknown> };
}

export async function registerPasskey(ctx: AppContext, userId: ObjectId, challengeId: string, response: RegistrationResponseJSON, name: string | undefined, ip: string | null) {
  const expectedChallenge = await takeChallenge(ctx, challengeId, 'register', userId);
  const { rpID, origins } = relyingParty(ctx);
  let verification;
  try {
    verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
  } catch {
    throw new AppError(400, 'PASSKEY_INVALID', 'Não foi possível confirmar a biometria deste aparelho.');
  }
  if (!verification.verified) throw new AppError(400, 'PASSKEY_INVALID', 'Não foi possível confirmar a biometria deste aparelho.');
  const { credential, credentialDeviceType } = verification.registrationInfo;
  const now = new Date();
  const doc = {
    userId,
    credentialId: credential.id,
    publicKey: new Binary(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    name: name || (credentialDeviceType === 'multiDevice' ? 'Passkey sincronizada' : 'Este aparelho'),
    createdAt: now,
    lastUsedAt: null,
  };
  const { insertedId } = await ctx.col.passkeys.insertOne(doc as never).catch((e: unknown) => {
    if ((e as { code?: number }).code === 11000) throw new AppError(409, 'PASSKEY_EXISTS', 'Esta biometria já está cadastrada.');
    throw e;
  });
  await audit(ctx.col, 'passkey.registered', userId, { passkeyId: insertedId.toHexString() }, ip);
  return toPasskeyDTO({ _id: insertedId, ...doc } as PasskeyDoc);
}

export async function removePasskey(ctx: AppContext, userId: ObjectId, id: string, ip: string | null) {
  const r = await ctx.col.passkeys.deleteOne({ _id: new ObjectId(id), userId });
  if (!r.deletedCount) throw new AppError(404, 'NOT_FOUND', 'Passkey não encontrada');
  await audit(ctx.col, 'passkey.removed', userId, { passkeyId: id }, ip);
}

export async function loginOptions(ctx: AppContext) {
  const options = await generateAuthenticationOptions({ rpID: relyingParty(ctx).rpID, userVerification: 'required' });
  return { challengeId: await saveChallenge(ctx, options.challenge, 'login', null), options: { ...options } as Record<string, unknown> };
}

const passkeyFailed = () => new AppError(401, 'PASSKEY_FAILED', 'Não foi possível entrar com a biometria. Use CPF e senha.');

export async function loginWithPasskey(ctx: AppContext, challengeId: string, response: AuthenticationResponseJSON, remember: boolean, meta: RequestMeta) {
  const expectedChallenge = await takeChallenge(ctx, challengeId, 'login', null);
  const pk = await ctx.col.passkeys.findOne({ credentialId: response.id });
  if (!pk) {
    await audit(ctx.col, 'login.failed', null, { step: 'passkey', reason: 'unknown_credential' }, meta.ip);
    throw passkeyFailed();
  }
  const now = new Date();
  const u = await ctx.col.users.findOne({ _id: pk.userId });
  if (!u) throw passkeyFailed();
  assertNotLocked(u, now);

  const { rpID, origins } = relyingParty(ctx);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: { id: pk.credentialId, publicKey: new Uint8Array(pk.publicKey.buffer), counter: pk.counter, transports: pk.transports as AuthenticatorTransportFuture[] },
      requireUserVerification: true,
    });
  } catch {
    verification = null;
  }
  if (!verification?.verified) {
    await audit(ctx.col, 'login.failed', u._id, { step: 'passkey' }, meta.ip);
    throw passkeyFailed();
  }
  await ctx.col.passkeys.updateOne({ _id: pk._id }, { $set: { counter: verification.authenticationInfo.newCounter, lastUsedAt: now } });
  await ctx.col.users.updateOne({ _id: u._id }, { $set: { failedLogins: 0, lockedUntil: null, updatedAt: now } });
  await audit(ctx.col, 'login.success', u._id, { factor: 'passkey', client: meta.client }, meta.ip);
  return { user: u, ...(await createSession(ctx, u, { meta, persistent: remember, authTime: now })) };
}
