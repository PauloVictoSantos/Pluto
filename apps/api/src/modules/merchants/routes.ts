import { MergeMerchantGroupSchema, MerchantGroupsSchema, RemoveMerchantKeySchema, UpdateMerchantGroupSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { applyGroups, groupMerchants, listGroups, releaseKey } from './service';

const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });
const R = { response: { 200: MerchantGroupsSchema } };

// Estabelecimentos agrupados: a IA propoe, o usuario edita (vira regra dele: source "user").
export const merchantRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));
  const { col } = ctx;
  const own = async (userId: ObjectId, id: string) => {
    const g = await col.merchantGroups.findOne({ _id: new ObjectId(id), userId });
    if (!g) throw notFound('Grupo');
    return g;
  };

  app.get('/merchant-groups', { schema: R }, async (req) => listGroups(ctx, userOf(req).id));

  /** Agrupa agora as descricoes novas (similaridade + Gemini). */
  app.post('/merchant-groups/refresh', { config: { rateLimit: perUser(6) }, schema: R }, async (req) => {
    const userId = userOf(req).id;
    await groupMerchants(ctx, userId);
    return listGroups(ctx, userId);
  });

  app.patch('/merchant-groups/:id', { schema: { params: IdParam, body: UpdateMerchantGroupSchema, ...R } }, async (req) => {
    const userId = userOf(req).id, g = await own(userId, req.params.id);
    await col.merchantGroups.updateOne({ _id: g._id }, { $set: { ...req.body, source: 'user', updatedAt: new Date() } });
    await applyGroups(ctx, userId);
    await audit(col, 'merchant_group.updated', userId, { groupId: req.params.id }, req.ip);
    return listGroups(ctx, userId);
  });

  /** Junta este grupo em outro ("99" dentro de "Uber"): as descricoes passam a valer a categoria do destino. */
  app.post('/merchant-groups/:id/merge', { schema: { params: IdParam, body: MergeMerchantGroupSchema, ...R } }, async (req) => {
    const userId = userOf(req).id, from = await own(userId, req.params.id), into = await own(userId, req.body.intoId);
    if (from._id.equals(into._id)) throw new AppError(400, 'SAME_GROUP', 'Escolha outro grupo.');
    await col.merchantGroups.updateOne({ _id: into._id }, { $addToSet: { keys: { $each: from.keys } }, $set: { source: 'user', updatedAt: new Date() } });
    await col.transactions.updateMany({ userId, merchantGroupId: from._id }, { $set: { merchantGroupId: into._id } });
    await col.merchantGroups.deleteOne({ _id: from._id });
    await applyGroups(ctx, userId);
    await audit(col, 'merchant_group.merged', userId, { from: req.params.id, into: req.body.intoId }, req.ip);
    return listGroups(ctx, userId);
  });

  /** Tira uma descricao do grupo (a IA nao poe de volta nele). */
  app.delete('/merchant-groups/:id/keys', { schema: { params: IdParam, body: RemoveMerchantKeySchema, ...R } }, async (req) => {
    const userId = userOf(req).id, g = await own(userId, req.params.id);
    await releaseKey(ctx, g, req.body.key);
    const rest = g.keys.filter((k) => k !== req.body.key);
    if (rest.length) await col.merchantGroups.updateOne({ _id: g._id }, { $set: { keys: rest, source: 'user', updatedAt: new Date() }, $addToSet: { blocked: req.body.key } });
    else await col.merchantGroups.deleteOne({ _id: g._id });
    return listGroups(ctx, userId);
  });
};
