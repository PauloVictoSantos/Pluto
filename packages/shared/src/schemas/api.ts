import { z } from 'zod';

// Formato de erro padrao da API (secao 7).
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['up', 'down']),
  time: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;
