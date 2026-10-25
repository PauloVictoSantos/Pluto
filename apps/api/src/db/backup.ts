import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BSON, type Db, type Document } from 'mongodb';

const { EJSON } = BSON;

// Backup do banco inteiro num arquivo unico, comprimido e cifrado (AES-256-GCM, chave derivada de
// BACKUP_PASSPHRASE com scrypt). Sem a frase o arquivo nao serve para nada: pode ficar fora do servidor.
// Formato: "PLUTOBK1" | salt(16) | iv(12) | tag(16) | gzip(JSON linha a linha {c, d}).
const MAGIC = Buffer.from('PLUTOBK1');

const keyOf = (passphrase: string, salt: Buffer) => scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export interface BackupSummary {
  collections: Record<string, number>;
}

export async function createBackup(db: Db, passphrase: string): Promise<{ file: Buffer } & BackupSummary> {
  const lines: string[] = [];
  const collections: Record<string, number> = {};
  for (const { name } of await db.listCollections({ type: 'collection' }, { nameOnly: true }).toArray()) {
    if (name.startsWith('system.')) continue;
    collections[name] = 0;
    for await (const d of db.collection(name).find()) {
      lines.push(EJSON.stringify({ c: name, d }, { relaxed: false }));
      collections[name]++;
    }
  }
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(passphrase, salt), iv);
  const ct = Buffer.concat([cipher.update(gzipSync(lines.join('\n'))), cipher.final()]);
  return { file: Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ct]), collections };
}

export function readBackup(file: Buffer, passphrase: string): Map<string, Document[]> {
  if (!file.subarray(0, 8).equals(MAGIC)) throw new Error('Arquivo nao e um backup do Pluto');
  const salt = file.subarray(8, 24), iv = file.subarray(24, 36), tag = file.subarray(36, 52);
  const decipher = createDecipheriv('aes-256-gcm', keyOf(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = gunzipSync(Buffer.concat([decipher.update(file.subarray(52)), decipher.final()]));
  } catch {
    throw new Error('Frase de backup errada ou arquivo corrompido');
  }
  const out = new Map<string, Document[]>();
  for (const line of plain.toString('utf8').split('\n')) {
    if (!line) continue;
    const { c, d } = EJSON.parse(line, { relaxed: false }) as { c: string; d: Document };
    if (!out.has(c)) out.set(c, []);
    out.get(c)!.push(d);
  }
  return out;
}

/**
 * Restaura num banco vazio (recusa sobrescrever dados, a menos que force=true apague antes).
 * Depois rode db:setup no destino para recriar validadores e indices.
 */
export async function restoreBackup(db: Db, file: Buffer, passphrase: string, { force = false } = {}): Promise<BackupSummary> {
  const data = readBackup(file, passphrase);
  const existing = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  for (const name of data.keys()) {
    if (!existing.includes(name)) continue;
    if (!force && (await db.collection(name).estimatedDocumentCount()) > 0) throw new Error(`O banco de destino ja tem dados em "${name}". Use um banco vazio.`);
    await db.collection(name).deleteMany({});
  }
  const collections: Record<string, number> = {};
  for (const [name, docs] of data) {
    collections[name] = docs.length;
    for (let i = 0; i < docs.length; i += 1000) await db.collection(name).insertMany(docs.slice(i, i + 1000));
  }
  return { collections };
}
