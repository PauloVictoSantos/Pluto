import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Refresh token opaco de 256 bits (secao 6.2). */
export const randomToken = () => randomBytes(32).toString('base64url');

/** Tokens aleatorios de alta entropia: SHA-256 basta (nao precisam de hash lento). */
export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

/** Codigos de recuperacao no formato xxxx-xxxx (sem caracteres ambiguos). */
export function recoveryCodes(n = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return Array.from({ length: n }, () => `${part()}-${part()}`);
}

export const normalizeRecoveryCode = (c: string) => c.trim().toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
