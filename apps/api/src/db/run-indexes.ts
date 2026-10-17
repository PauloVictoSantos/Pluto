// Uso: pnpm --filter @pluto/api db:indexes
import { loadEnv } from '../config/env';
import { connectDatabase } from './client';
import { ensureIndexes } from './indexes';

const database = await connectDatabase(loadEnv().MONGODB_URI);
await ensureIndexes(database.db);
await database.close();
console.log('Indices criados.');
