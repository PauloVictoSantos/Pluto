import { createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// Secao 6.2: Argon2id (parametros ficam dentro do hash), minimo de 12 caracteres.
// Parametros OWASP: 19 MiB, 2 iteracoes, paralelismo 1. algorithm 2 = Argon2id (const enum do pacote).
const OPTS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const MIN_PASSWORD = 12;

export const hashPassword = (password: string) => hash(password, OPTS);

// Hash ficticio: quando o e-mail nao existe, verificamos contra ele para o tempo de resposta
// nao revelar se a conta existe.
let dummy: Promise<string> | null = null;
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (!stored) {
    dummy ??= hashPassword('pluto-dummy-password');
    await verify(await dummy, password).catch(() => false);
    return false;
  }
  return verify(stored, password).catch(() => false);
}

export function passwordProblems(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (password.length > 256) return 'A senha é longa demais.';
  if (/^(.)\1+$/.test(password)) return 'A senha não pode repetir um único caractere.';
  return null;
}

/**
 * Quantas vezes a senha aparece em vazamentos conhecidos (Have I Been Pwned, k-anonymity):
 * so os 5 primeiros caracteres do SHA-1 saem da maquina. Retorna null se o servico falhar.
 */
export async function pwnedCount(password: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return null;
    for (const line of (await res.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}
