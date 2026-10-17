import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

// Criptografia em nivel de campo (secao 6.4): AES-256-GCM com IV aleatorio.
// Formato: "v1.<iv>.<tag>.<ciphertext>" em base64url.
// Para campos que precisam de busca/indice unico, usa-se um HMAC deterministico ao lado.

export interface FieldCrypto {
  encrypt(plain: string): string;
  decrypt(token: string): string;
  /** HMAC-SHA256 deterministico para indices e buscas por igualdade. */
  hash(value: string): string;
}

export function createFieldCrypto(base64Key: string): FieldCrypto {
  const master = Buffer.from(base64Key, 'base64');
  if (master.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY deve ter 32 bytes');
  // Chaves separadas por finalidade, derivadas da chave mestra.
  const encKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'pluto:field-enc:v1', 32));
  const macKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'pluto:field-mac:v1', 32));

  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encKey, iv);
      const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), ct].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
    },
    decrypt(token) {
      const [v, iv, tag, ct] = token.split('.');
      if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Formato de campo criptografado invalido');
      const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
    },
    hash(value) {
      return createHmac('sha256', macKey).update(value).digest('base64url');
    },
  };
}
