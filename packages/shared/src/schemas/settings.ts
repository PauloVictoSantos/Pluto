import { z } from 'zod';

// users.settings - valores padrao da secao 5.
export const UserSettingsSchema = z.object({
  timezone: z.string().default('America/Manaus'),
  currency: z.literal('BRL').default('BRL'),
  quietHours: z
    .object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })
    .default({ start: '22:00', end: '07:00' }),
  reserveMonths: z.number().min(0).max(24).default(3),
  maxCommitmentPct: z.number().min(0).max(1).default(0.3),
  discountRateMonthly: z.number().min(0).max(0.2).default(0.009),
  aiEnabled: z.boolean().default(true),
  lockAfterSeconds: z.number().int().min(0).default(30),
  scoreWeights: z
    .object({
      urgency: z.number(),
      necessity: z.number(),
      impact: z.number(),
      cashPressure: z.number(),
      goalAlignment: z.number(),
    })
    .default({ urgency: 0.3, necessity: 0.25, impact: 0.15, cashPressure: 0.2, goalAlignment: 0.1 }),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const DEFAULT_SETTINGS: UserSettings = UserSettingsSchema.parse({});
