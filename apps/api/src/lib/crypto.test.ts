import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFieldCrypto } from './crypto';

const key = randomBytes(32).toString('base64');

describe('field crypto', () => {
  it('criptografa e descriptografa (IV aleatorio)', () => {
    const c = createFieldCrypto(key);
    const a = c.encrypt('item-123'), b = c.encrypt('item-123');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(c.decrypt(a)).toBe('item-123');
  });

  it('hash e deterministico e depende da chave', () => {
    const c = createFieldCrypto(key);
    expect(c.hash('x')).toBe(c.hash('x'));
    expect(createFieldCrypto(randomBytes(32).toString('base64')).hash('x')).not.toBe(c.hash('x'));
  });

  it('detecta adulteracao', () => {
    const c = createFieldCrypto(key);
    const [v, iv, tag, ct] = c.encrypt('segredo').split('.');
    const forged = [v, iv, tag, Buffer.from('xxxxxxx').toString('base64url')].join('.');
    expect(() => c.decrypt(forged)).toThrow();
    expect(ct).toBeTruthy();
  });

  it('rejeita chave de tamanho errado', () => {
    expect(() => createFieldCrypto(randomBytes(16).toString('base64'))).toThrow();
  });
});
