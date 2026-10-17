import { HealthSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const healthRoutes: FastifyPluginAsyncZod<{ ping: () => Promise<boolean> }> = async (
  app,
  { ping },
) => {
  app.get('/health', { schema: { response: { 200: HealthSchema } } }, async () => {
    const dbUp = await ping();
    return { status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down', time: new Date().toISOString() } as const;
  });
};
