import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'deve ter 32 bytes em base64');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(3333),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    MONGODB_URI: z.string().startsWith('mongodb'),
    MONGODB_DB: z.string().regex(/^[A-Za-z0-9_-]{1,38}$/, 'nome de banco invalido').default('pluto'),

    JWT_PRIVATE_KEY: optional,
    JWT_PUBLIC_KEY: optional,
    FIELD_ENCRYPTION_KEY: base64Key32,

    ALLOWED_ORIGINS: z
      .string()
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string()).min(1)),

    PLUGGY_CLIENT_ID: optional,
    PLUGGY_CLIENT_SECRET: optional,
    PLUGGY_WEBHOOK_SECRET: optional,

    LLM_API_KEY: optional,
    /** Alias de LLM_API_KEY para o Gemini. */
    GEMINI_API_KEY: optional,
    LLM_MODEL: optional,

    FCM_SERVICE_ACCOUNT_JSON: optional,
    BACKUP_PASSPHRASE: optional,

    SYNC_INTERVAL_HOURS: z.coerce.number().positive().default(6),
  })
  .superRefine((env, ctx) => {
    // Secao 6.3: o servidor se recusa a iniciar com configuracao insegura.
    if (env.ALLOWED_ORIGINS.includes('*')) {
      ctx.addIssue({ code: 'custom', path: ['ALLOWED_ORIGINS'], message: 'curinga "*" proibido' });
    }
    if (env.HOST === '0.0.0.0' || env.HOST === '::') {
      ctx.addIssue({
        code: 'custom',
        path: ['HOST'],
        message: 'nao escute em todas as interfaces; use 127.0.0.1 ou o IP da VPN',
      });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'BACKUP_PASSPHRASE'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'obrigatorio em production' });
      }
      if (!/\/\/[^:]+:[^@]+@/.test(env.MONGODB_URI)) {
        ctx.addIssue({
          code: 'custom',
          path: ['MONGODB_URI'],
          message: 'MongoDB sem autenticacao nao e permitido em production',
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Mostra apenas nomes das variaveis e o motivo, nunca os valores.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuracao invalida:\n${issues}`);
  }
  return parsed.data;
}
