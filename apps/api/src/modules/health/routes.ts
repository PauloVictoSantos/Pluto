import { HealthSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const healthRoutes: FastifyPluginAsyncZod<{ ping: () => Promise<boolean> }> = async (
  app,
  { ping },
) => {
  // Leve, sem banco: o site chama ao abrir para acordar o servidor (doc. Melhorias, passo 2).
  app.get('/health/live', { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } }, async () => ({ status: 'ok' as const }));

  // Completo (com ping no banco): health check do Render e monitor de uptime.
  app.get('/health', { schema: { response: { 200: HealthSchema } } }, async () => {
    const dbUp = await ping();
    return { status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down', time: new Date().toISOString() } as const;
  });
};
