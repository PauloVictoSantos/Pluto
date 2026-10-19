import {
  AlertFeedbackSchema,
  AlertSchema,
  AlertSettingsSchema,
  PushSubscriptionSchema,
  PushUnsubscribeSchema,
  UpdateAlertSettingsSchema,
  type AlertSettings,
} from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { deliver, toAlertDTO } from './service';

const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });

// Painel do sino, preferencias de canal e inscricao Web Push (doc. "POST /api/push/subscribe").
export const alertRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));
  const { col } = ctx;

  app.get('/alerts', { schema: { response: { 200: z.array(AlertSchema) } } }, async (req) =>
    (await col.alerts.find({ userId: userOf(req).id }).sort({ createdAt: -1 }).limit(50).toArray()).map(toAlertDTO),
  );

  app.post('/alerts/read', async (req, reply) => {
    await col.alerts.updateMany({ userId: userOf(req).id, readAt: null }, { $set: { readAt: new Date() } });
    return reply.code(204).send();
  });

  /** "Util" e "nao util" calibram os proximos alertas (RN-A04). */
  app.patch('/alerts/:id', { schema: { params: IdParam, body: AlertFeedbackSchema, response: { 200: AlertSchema } } }, async (req) => {
    const a = await col.alerts.findOneAndUpdate(
      { _id: new ObjectId(req.params.id), userId: userOf(req).id },
      { $set: { feedback: req.body.feedback, feedbackAt: new Date(), readAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!a) throw notFound('Alerta');
    return toAlertDTO(a);
  });

  const settingsOf = async (userId: ObjectId): Promise<AlertSettings> => {
    const u = await col.users.findOne({ _id: userId }, { projection: { 'settings.alerts': 1 } });
    const prefs = u?.settings.alerts ?? { push: true, email: true };
    return {
      ...prefs,
      pushAvailable: !!ctx.pusher,
      emailAvailable: !!ctx.mailer,
      publicKey: ctx.pusher?.publicKey ?? null,
      devices: await col.pushSubscriptions.countDocuments({ userId }),
    };
  };

  app.get('/alerts/settings', { schema: { response: { 200: AlertSettingsSchema } } }, async (req) => settingsOf(userOf(req).id));

  app.patch('/alerts/settings', { schema: { body: UpdateAlertSettingsSchema, response: { 200: AlertSettingsSchema } } }, async (req) => {
    const userId = userOf(req).id, cur = await settingsOf(userId);
    const next = { push: req.body.push ?? cur.push, email: req.body.email ?? cur.email };
    await col.users.updateOne({ _id: userId }, { $set: { 'settings.alerts': next, updatedAt: new Date() } });
    await audit(col, 'alerts.settings', userId, next, req.ip);
    return settingsOf(userId);
  });

  app.post('/push/subscribe', { config: { rateLimit: perUser(10) }, schema: { body: PushSubscriptionSchema, response: { 200: AlertSettingsSchema } } }, async (req) => {
    if (!ctx.pusher) throw new AppError(503, 'PUSH_NOT_CONFIGURED', 'As notificações não estão configuradas no servidor.');
    const userId = userOf(req).id, now = new Date();
    // Um endpoint pertence a um navegador: se ja era de outro usuario, passa para este.
    await col.pushSubscriptions.updateOne(
      { endpoint: req.body.endpoint },
      {
        $set: { userId, keysEnc: ctx.crypto.encrypt(JSON.stringify(req.body.keys)), userAgent: req.headers['user-agent']?.slice(0, 200) ?? null },
        $setOnInsert: { createdAt: now, lastSuccessAt: null },
      },
      { upsert: true },
    );
    await audit(col, 'push.subscribed', userId, {}, req.ip);
    return settingsOf(userId);
  });

  app.delete('/push/subscribe', { schema: { body: PushUnsubscribeSchema, response: { 200: AlertSettingsSchema } } }, async (req) => {
    const userId = userOf(req).id;
    await col.pushSubscriptions.deleteOne({ userId, endpoint: req.body.endpoint });
    return settingsOf(userId);
  });

  /** Teste dos canais: manda um aviso agora (nao conta no limite diario). */
  app.post('/alerts/test', { config: { rateLimit: perUser(5) }, schema: { response: { 200: z.object({ channels: z.array(z.enum(['push', 'email'])) }) } } }, async (req) => {
    const userId = userOf(req).id;
    const channels = await deliver(ctx, userId, { id: `test-${Date.now()}`, pushText: 'Teste: os avisos da Pluto estão chegando aqui.', url: '/' });
    return { channels };
  });
};
