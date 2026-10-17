import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP (RFC 6238) com HMAC-SHA1, 6 digitos, passo de 30 s: compativel com Google Authenticator,
// Microsoft Authenticator, 1Password, Authy etc.
const STEP_SEC = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32 invalido');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo de 160 bits em base32 (tamanho recomendado pela RFC 4226). */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SEC);

/**
 * Verifica um codigo aceitando +-1 passo de tolerancia de relogio. Retorna o passo usado ou null.
 * `lastStep` impede reuso do mesmo codigo (replay) dentro da janela.
 */
export function verifyTotp(secretB32: string, code: string, nowMs: number, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = stepAt(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    const expected = hotp(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'Pluto') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}
