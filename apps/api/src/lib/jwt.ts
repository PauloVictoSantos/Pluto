import { SignJWT, importPKCS8, importSPKI, jwtVerify, type JWTPayload } from 'jose';

// Access token curto (secao 6.2): JWT EdDSA (Ed25519), 15 min.
// Token de etapa MFA: mesmo par de chaves, audiencia diferente, 5 min. Nao serve como access token.
const ISSUER = 'pluto-api';
const AUDIENCE = 'pluto';
const MFA_AUDIENCE = 'pluto-mfa';
export const ACCESS_TTL_SEC = 15 * 60;
export const MFA_TTL_SEC = 5 * 60;

export interface AccessClaims {
  userId: string;
  /** Momento (epoch s) da ultima autenticacao forte (senha+2FA, passkey ou biometria). */
  authTime: number;
  sessionId?: string;
}

const pem = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

export interface Jwt {
  verify(token: string): Promise<AccessClaims>;
  sign?(claims: AccessClaims): Promise<string>;
  signMfa?(userId: string): Promise<string>;
  verifyMfa(token: string): Promise<string>;
}

export async function createJwt(opts: { publicKeyB64: string; privateKeyB64?: string }): Promise<Jwt> {
  const pub = await importSPKI(pem(opts.publicKeyB64), 'EdDSA');
  const priv = opts.privateKeyB64 ? await importPKCS8(pem(opts.privateKeyB64), 'EdDSA') : null;

  const build = (payload: JWTPayload, sub: string, aud: string, ttl: number) =>
    new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setSubject(sub).setIssuer(ISSUER).setAudience(aud).setIssuedAt().setExpirationTime(`${ttl}s`).sign(priv!);

  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, pub, { algorithms: ['EdDSA'], issuer: ISSUER, audience: AUDIENCE });
      if (typeof payload.sub !== 'string' || typeof payload.auth_time !== 'number') throw new Error('claims invalidas');
      return { userId: payload.sub, authTime: payload.auth_time, sessionId: typeof payload.sid === 'string' ? payload.sid : undefined };
    },
    sign: priv ? (c) => build({ auth_time: c.authTime, ...(c.sessionId ? { sid: c.sessionId } : {}) }, c.userId, AUDIENCE, ACCESS_TTL_SEC) : undefined,
    signMfa: priv ? (userId) => build({}, userId, MFA_AUDIENCE, MFA_TTL_SEC) : undefined,
    async verifyMfa(token) {
      const { payload } = await jwtVerify(token, pub, { algorithms: ['EdDSA'], issuer: ISSUER, audience: MFA_AUDIENCE });
      if (typeof payload.sub !== 'string') throw new Error('claims invalidas');
      return payload.sub;
    },
  };
}
