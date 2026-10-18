import { buildApp } from './app';
import { loadEnv } from './config/env';
import type { AppContext } from './context';
import { connectDatabase } from './db/client';
import { collections } from './db/collections';
import { ensureIndexes } from './db/indexes';
import { runMigrations } from './db/migrations';
import { createGemini } from './integrations/llm/gemini';
import { createPluggyGateway } from './integrations/pluggy/sdk-gateway';
import { startSyncScheduler } from './jobs/sync-scheduler';
import { createFieldCrypto } from './lib/crypto';
import { createJwt } from './lib/jwt';

const env = loadEnv();
const database = await connectDatabase(env.MONGODB_URI, env.MONGODB_DB);
await ensureIndexes(database.db);
// Migracao que falha nao derruba a API: os dados continuam utilizaveis e o erro fica no log.
await runMigrations(database.db, (m) => console.log(m)).catch((e: unknown) =>
  console.error('migracoes nao concluidas:', e instanceof Error ? e.message : String(e)),
);

const llmKey = env.LLM_API_KEY ?? env.GEMINI_API_KEY;
const ctx: AppContext = {
  env,
  col: collections(database.db),
  crypto: createFieldCrypto(env.FIELD_ENCRYPTION_KEY),
  jwt: env.JWT_PUBLIC_KEY ? await createJwt({ publicKeyB64: env.JWT_PUBLIC_KEY, privateKeyB64: env.JWT_PRIVATE_KEY }) : null,
  pluggy:
    env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET
      ? createPluggyGateway({ clientId: env.PLUGGY_CLIENT_ID, clientSecret: env.PLUGGY_CLIENT_SECRET })
      : null,
  pingDb: database.ping,
  llm: llmKey ? createGemini({ apiKey: llmKey, model: env.LLM_MODEL ?? 'gemini-2.5-flash', fallbackModel: 'gemini-2.5-flash' }) : null,
};

const app = await buildApp(ctx);
if (!ctx.jwt) app.log.warn('JWT_PUBLIC_KEY ausente: rotas autenticadas vão responder 401');
const stopScheduler = startSyncScheduler(ctx, app.log);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'encerrando');
  stopScheduler();
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.HOST, port: env.PORT });
