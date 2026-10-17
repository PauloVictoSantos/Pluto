// Gera segredos locais para o .env. Imprime no terminal; nao grava arquivos.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const b64 = (s) => Buffer.from(s).toString('base64');

console.log(`JWT_PRIVATE_KEY=${b64(privateKey)}`);
console.log(`JWT_PUBLIC_KEY=${b64(publicKey)}`);
console.log(`FIELD_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
console.log(`BACKUP_PASSPHRASE=${randomBytes(32).toString('base64url')}`);
