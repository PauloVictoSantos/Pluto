import { buildApp } from './app';
import { loadEnv } from './config/env';
import { connectDatabase } from './db/client';
import { ensureIndexes } from './db/indexes';

const env = loadEnv();
const database = await connectDatabase(env.MONGODB_URI);
await ensureIndexes(database.db);

const app = await buildApp({ env, pingDb: database.ping });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'encerrando');
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.HOST, port: env.PORT });
