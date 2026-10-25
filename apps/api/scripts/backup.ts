// Uso: pnpm --filter @pluto/api backup -- <pasta de saida>
// Gera pluto-backup-AAAA-MM-DD.enc, cifrado com BACKUP_PASSPHRASE (ver docs/RECUPERACAO.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBackup } from '../src/db/backup';
import { connectDatabase } from '../src/db/client';

// So o necessario (sem loadEnv): roda tambem no GitHub Actions, que nao tem as demais chaves.
const { MONGODB_URI, MONGODB_DB = 'pluto', BACKUP_PASSPHRASE } = process.env;
if (!MONGODB_URI || !BACKUP_PASSPHRASE) throw new Error('Defina MONGODB_URI e BACKUP_PASSPHRASE');
const dir = process.argv.slice(2).find((a) => a !== '--') ?? 'backups';
const database = await connectDatabase(MONGODB_URI, MONGODB_DB);
try {
  const { file, collections } = await createBackup(database.db, BACKUP_PASSPHRASE);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `pluto-backup-${new Date().toISOString().slice(0, 10)}.enc`);
  writeFileSync(path, file);
  const total = Object.values(collections).reduce((a, b) => a + b, 0);
  console.log(`Backup salvo em ${path}: ${Object.keys(collections).length} colecoes, ${total} documentos, ${(file.length / 1024).toFixed(0)} KB.`);
  console.log(JSON.stringify(collections));
} finally {
  await database.close();
}
