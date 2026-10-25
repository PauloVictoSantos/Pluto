import { buildApp } from './app';
import { loadEnv } from './config/env';
import type { AppContext } from './context';
import { connectDatabase } from './db/client';
import { collections } from './db/collections';
import { ensureIndexes } from './db/indexes';
import { runMigrations } from './db/migrations';
import { createResendMailer } from './integrations/email/resend';
import { createGemini } from './integrations/llm/gemini';
import { createStripeGateway } from './integrations/stripe/gateway';
import { createPluggyGateway } from './integrations/pluggy/sdk-gateway';
import { createPusher } from './integrations/push/webpush';
import { startAlertsScheduler, startChargeScheduler, startPlannerScheduler, startSyncScheduler } from './jobs/sync-scheduler';
import { createFieldCrypto } from './lib/crypto';
import { createJwt } from './lib/jwt';
import { initMonitoring } from './lib/monitoring';

const env = loadEnv();
initMonitoring(env.SENTRY_DSN, env.NODE_ENV);
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
  mongo: database.client,
  crypto: createFieldCrypto(env.FIELD_ENCRYPTION_KEY),
  jwt: env.JWT_PUBLIC_KEY ? await createJwt({ publicKeyB64: env.JWT_PUBLIC_KEY, privateKeyB64: env.JWT_PRIVATE_KEY }) : null,
  pluggy:
    env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET
      ? createPluggyGateway({ clientId: env.PLUGGY_CLIENT_ID, clientSecret: env.PLUGGY_CLIENT_SECRET })
      : null,
  pingDb: database.ping,
  stripe: env.STRIPE_SECRET_KEY ? createStripeGateway({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET }) : null,
  // Sem dominio verificado, o Resend so envia do endereco de testes para o e-mail da propria conta.
  mailer: env.RESEND_API_KEY ? createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM ?? 'Pluto <onboarding@resend.dev>' }) : null,
  pusher:
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? createPusher({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? 'mailto:alertas@pluto.local' })
      : null,
  llm: llmKey ? createGemini({ apiKey: llmKey, model: env.LLM_MODEL ?? 'gemini-2.5-flash', fallbackModel: 'gemini-2.5-flash' }) : null,
};

const app = await buildApp(ctx);
if (!ctx.jwt) app.log.warn('JWT_PUBLIC_KEY ausente: rotas autenticadas vão responder 401');
const stopScheduler = startSyncScheduler(ctx, app.log);
const stopCharges = startChargeScheduler(ctx, app.log);
const stopShopping = startPlannerScheduler(ctx, app.log);
const stopAlerts = startAlertsScheduler(ctx, app.log);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'encerrando');
  stopScheduler();
  stopShopping();
  stopAlerts();
  stopCharges();
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.HOST, port: env.PORT });
