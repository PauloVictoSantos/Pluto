import {
  AddEntrySchema,
  CatalogSchema,
  ClosedListSchema,
  CopyEntriesSchema,
  ListHistorySchema,
  MarketAnswerSchema,
  ResolveItemResultSchema,
  ResolveItemSchema,
  ShoppingListSchema,
  UpdateEntrySchema,
} from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { addEntry, answerMarket, catalog, closedList, copyFrom, dismissSuggestion, ensureList, history, listDTO, resolveItem, updateEntry } from './service';

const ItemParam = z.object({ itemId: z.string().regex(/^[a-f0-9]{24}$/) });
const MonthParam = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

// Lista de compras do mes (doc. "Lista de compras"). Todo o calculo fica no servidor.
export const shoppingRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));
  const R = { response: { 200: ShoppingListSchema } };

  app.get('/shopping/list', { schema: R }, async (req) => {
    const { list, tz } = await ensureList(ctx, userOf(req).id);
    return listDTO(ctx, list, tz);
  });

  app.post('/shopping/list/entries', { schema: { body: AddEntrySchema, ...R } }, async (req) => addEntry(ctx, userOf(req).id, req.body));

  app.patch('/shopping/list/entries/:itemId', { schema: { params: ItemParam, body: UpdateEntrySchema, ...R } }, async (req) =>
    updateEntry(ctx, userOf(req).id, req.params.itemId, req.body),
  );

  app.post('/shopping/list/suggestions/:itemId/dismiss', { schema: { params: ItemParam, ...R } }, async (req) =>
    dismissSuggestion(ctx, userOf(req).id, req.params.itemId),
  );

  app.post('/shopping/list/market', { schema: { body: MarketAnswerSchema, ...R } }, async (req) =>
    answerMarket(ctx, userOf(req).id, req.body.transactionId, req.body.itemIds),
  );

  app.post('/shopping/list/copy', { schema: { body: CopyEntriesSchema, ...R } }, async (req) =>
    copyFrom(ctx, userOf(req).id, req.body.month, req.body.itemIds),
  );

  // Chama o Gemini quando o nome e novo: limite por usuario.
  app.post(
    '/shopping/items/resolve',
    { config: { rateLimit: perUser(30) }, schema: { body: ResolveItemSchema, response: { 200: ResolveItemResultSchema } } },
    async (req) => resolveItem(ctx, userOf(req).id, req.body.raw),
  );

  app.get('/shopping/items', { schema: { response: { 200: CatalogSchema } } }, async (req) => catalog(ctx, userOf(req).id));
  app.get('/shopping/lists', { schema: { response: { 200: ListHistorySchema } } }, async (req) => history(ctx, userOf(req).id));
  app.get('/shopping/lists/:month', { schema: { params: MonthParam, response: { 200: ClosedListSchema } } }, async (req) =>
    closedList(ctx, userOf(req).id, req.params.month),
  );
};
