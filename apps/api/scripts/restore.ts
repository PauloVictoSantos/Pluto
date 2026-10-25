// Uso: pnpm --filter @pluto/api restore -- <arquivo .enc> [--force]
// Restaura em MONGODB_URI/MONGODB_DB. Use um banco vazio (ex.: MONGODB_DB=pluto_restore) e confira
// antes de apontar a API para ele. --force apaga as colecoes do destino antes. Ver docs/RECUPERACAO.md.
import { readFileSync } from 'node:fs';
import { restoreBackup } from '../src/db/backup';
import { connectDatabase } from '../src/db/client';
import { ensureIndexes } from '../src/db/indexes';
import { ensureSchemas } from '../src/db/schema';

// So o necessario (sem loadEnv): roda tambem no GitHub Actions, que nao tem as demais chaves.
const { MONGODB_URI, MONGODB_DB = 'pluto', BACKUP_PASSPHRASE } = process.env;
if (!MONGODB_URI || !BACKUP_PASSPHRASE) throw new Error('Defina MONGODB_URI e BACKUP_PASSPHRASE');
const args = process.argv.slice(2).filter((a) => a !== '--');
const path = args.find((a) => !a.startsWith('--'));
if (!path) throw new Error('Informe o arquivo do backup');
const database = await connectDatabase(MONGODB_URI, MONGODB_DB);
try {
  const { collections } = await restoreBackup(database.db, readFileSync(path), BACKUP_PASSPHRASE, { force: args.includes('--force') });
  await ensureSchemas(database.db);
  await ensureIndexes(database.db);
  const total = Object.values(collections).reduce((a, b) => a + b, 0);
  console.log(`Restaurado em "${database.db.databaseName}": ${Object.keys(collections).length} colecoes, ${total} documentos.`);
  console.log(JSON.stringify(collections));
} finally {
  await database.close();
}
