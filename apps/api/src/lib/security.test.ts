import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblems, pwnedCount, verifyPassword } from './password';
import { normalizeRecoveryCode, recoveryCodes } from './tokens';
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, stepAt, verifyTotp } from './totp';

describe('TOTP (RFC 6238, vetores oficiais SHA-1)', () => {
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('t=%i', (t, code) => {
    expect(hotp(secret, stepAt(t * 1000), 8)).toBe(code);
  });

  it('base32 ida e volta', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it('aceita +-1 passo e bloqueia reuso', () => {
    const b32 = base32Encode(secret), now = 1_700_000_000_000;
    const code = hotp(secret, stepAt(now));
    const step = verifyTotp(b32, code, now, null);
    expect(step).toBe(stepAt(now));
    expect(verifyTotp(b32, code, now + 30_000, null)).toBe(stepAt(now));
    expect(verifyTotp(b32, code, now + 90_000, null)).toBeNull();
    expect(verifyTotp(b32, code, now, step)).toBeNull();
    expect(verifyTotp(b32, '12345', now, null)).toBeNull();
  });

  it('otpauth URI', () => {
    expect(otpauthUri('ABC', 'eu@x.com')).toBe('otpauth://totp/Pluto%3Aeu%40x.com?secret=ABC&issuer=Pluto&algorithm=SHA1&digits=6&period=30');
  });
});

describe('senha', () => {
  it('Argon2id e verificacao', async () => {
    const h = await hashPassword('uma senha bem longa');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'uma senha bem longa')).toBe(true);
    expect(await verifyPassword(h, 'outra')).toBe(false);
    expect(await verifyPassword(null, 'qualquer')).toBe(false);
  });

  it('regras minimas', () => {
    expect(passwordProblems('curta')).toMatch(/12/);
    expect(passwordProblems('aaaaaaaaaaaaaaa')).toMatch(/repetir/);
    expect(passwordProblems('cavalo correto bateria')).toBeNull();
  });

  it('k-anonymity: envia so o prefixo do SHA-1', async () => {
    let url = '';
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fake = (async (u: string) => {
      url = u;
      return new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\nAAAA:1');
    }) as typeof fetch;
    expect(await pwnedCount('password', fake)).toBe(9545824);
    expect(url).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    expect(await pwnedCount('password', (async () => { throw new Error('offline'); }) as typeof fetch)).toBeNull();
  });
});

describe('codigos de recuperacao', () => {
  it('formato e normalizacao', () => {
    const codes = recoveryCodes();
    expect(codes).toHaveLength(10);
    codes.forEach((c) => expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/));
    expect(normalizeRecoveryCode(' ABCD EFGH ')).toBe('abcd-efgh');
  });
});
