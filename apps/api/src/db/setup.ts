// Uso: pnpm --filter @pluto/api db:setup
// Cria colecoes com validadores (secao 4.1) e indices (secao 4.4). Idempotente.
import { loadEnv } from '../config/env';
import { connectDatabase } from './client';
import { ensureIndexes } from './indexes';
import { runMigrations } from './migrations';
import { ensureSchemas } from './schema';

const database = await connectDatabase(loadEnv().MONGODB_URI);
try {
  await ensureSchemas(database.db, (m) => console.log(m));
  await ensureIndexes(database.db);
  await runMigrations(database.db, (m) => console.log(m));
  console.log(`Indices verificados no banco "${database.db.databaseName}".`);
} finally {
  await database.close();
}
