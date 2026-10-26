import { ChargeSchema, ClearChargesResultSchema, CloseInstallmentSchema, CreateChargeSchema, PayerSchema, SavedPayerSchema } from '@pluto/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { requireAuth, userOf } from '../../plugins/auth';
import { perUser } from '../../plugins/security';
import { cancelCharge, chargesWithGoals, clearCharges, listPayers, removePayer, savePayer, visibleCharges, closeInstallment, sendChargeEmail, createCharge, handleStripeEvent, processCharges } from './service';

const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });

export const chargeRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));

  /** A tela mostra "modo teste" e esconde o formulario se o Stripe nao estiver configurado. */
  app.get('/charges/status', { schema: { response: { 200: z.object({ enabled: z.boolean(), testMode: z.boolean(), emailEnabled: z.boolean() }) } } }, async () => ({
    enabled: !!ctx.stripe,
    testMode: !!ctx.env.STRIPE_SECRET_KEY && /^(sk|rk)_test_/.test(ctx.env.STRIPE_SECRET_KEY),
    emailEnabled: !!ctx.mailer,
  }));

  app.get('/charges', { schema: { response: { 200: z.array(ChargeSchema) } } }, async (req) => visibleCharges(ctx, userOf(req).id));

  // "Limpar": tira da lista os boletos de teste e os encerrados; os em aberto ficam.
  app.post('/charges/clear', { config: { rateLimit: perUser(10) }, schema: { response: { 200: ClearChargesResultSchema } } }, async (req) => {
    const userId = userOf(req).id;
    const hidden = await clearCharges(ctx, userId);
    await audit(ctx.col, 'charges.cleared', userId, { hidden }, req.ip);
    return { hidden, charges: await visibleCharges(ctx, userId) };
  });
  app.delete('/charges/:id', { config: { rateLimit: perUser(30) }, schema: { params: IdParam, response: { 200: ClearChargesResultSchema } } }, async (req) => {
    const userId = userOf(req).id;
    const hidden = await clearCharges(ctx, userId, req.params.id);
    return { hidden, charges: await visibleCharges(ctx, userId) };
  });

  // Contatos: pagadores salvos (dados cifrados), para gerar o proximo boleto sem digitar de novo.
  app.get('/charges/payers', { schema: { response: { 200: z.array(SavedPayerSchema) } } }, async (req) => listPayers(ctx, userOf(req).id));
  app.post('/charges/payers', { config: { rateLimit: perUser(20) }, schema: { body: PayerSchema, response: { 200: z.array(SavedPayerSchema) } } }, async (req) => savePayer(ctx, userOf(req).id, req.body));
  app.delete('/charges/payers/:id', { config: { rateLimit: perUser(20) }, schema: { params: IdParam, response: { 200: z.array(SavedPayerSchema) } } }, async (req) =>
    removePayer(ctx, userOf(req).id, req.params.id),
  );

  app.post(
    '/charges',
    { config: { rateLimit: perUser(10) }, schema: { body: CreateChargeSchema, response: { 201: ChargeSchema } } },
    async (req, reply) => {
      const doc = await createCharge(ctx, userOf(req).id, req.body, req.ip);
      return reply.status(201).send((await chargesWithGoals(ctx, [doc]))[0]!);
    },
  );

  // Atualiza na hora (sem esperar o webhook ou o job): util no computador, onde o webhook nao chega.
  app.post('/charges/refresh', { config: { rateLimit: perUser(6) }, schema: { response: { 200: z.array(ChargeSchema) } } }, async (req) => {
    const userId = userOf(req).id;
    await processCharges(ctx, { userId }, req.log);
    return visibleCharges(ctx, userId);
  });

  app.post(
    '/charges/:id/installments/:n/close',
    {
      config: { rateLimit: perUser(20) },
      schema: { params: IdParam.extend({ n: z.coerce.number().int().min(1).max(12) }), body: CloseInstallmentSchema, response: { 200: ChargeSchema } },
    },
    async (req) => {
      const doc = await closeInstallment(ctx, userOf(req).id, req.params.id, req.params.n, req.body.outcome, req.ip);
      return (await chargesWithGoals(ctx, [doc]))[0]!;
    },
  );

  // E-mail ao pagador pelo Resend: todos os boletos em aberto, ou so a parcela n.
  app.post(
    '/charges/:id/send',
    {
      config: { rateLimit: perUser(10) },
      schema: { params: IdParam, body: z.object({ n: z.number().int().min(1).max(12).nullable().default(null) }), response: { 200: ChargeSchema } },
    },
    async (req) => {
      const doc = await sendChargeEmail(ctx, userOf(req).id, req.params.id, req.body.n, req.ip);
      return (await chargesWithGoals(ctx, [doc]))[0]!;
    },
  );

  app.post('/charges/:id/cancel', { config: { rateLimit: perUser(10) }, schema: { params: IdParam, response: { 200: ChargeSchema } } }, async (req) => {
    const doc = await cancelCharge(ctx, userOf(req).id, req.params.id, req.ip);
    return (await chargesWithGoals(ctx, [doc]))[0]!;
  });
};

/**
 * Webhook do Stripe (secao 6.5, mesmo cuidado dos webhooks do Pluggy): assinatura validada com o
 * corpo bruto, e o estado real e reconsultado no Stripe; o payload nunca e usado como verdade.
 */
export const stripeWebhookRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 512 * 1024 }, (_req, body, done) => done(null, body));
  app.post('/webhooks/stripe', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const signature = req.headers['stripe-signature'];
    if (!ctx.stripe || !ctx.env.STRIPE_WEBHOOK_SECRET) throw new AppError(503, 'STRIPE_NOT_CONFIGURED', 'Webhook do Stripe não configurado');
    if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) throw new AppError(400, 'BAD_SIGNATURE', 'Assinatura ausente');
    let event;
    try {
      event = ctx.stripe.parseWebhook(req.body, signature);
    } catch {
      throw new AppError(400, 'BAD_SIGNATURE', 'Assinatura inválida');
    }
    if (event.paymentIntentId && event.type.startsWith('payment_intent.')) await handleStripeEvent(ctx, event.paymentIntentId);
    return reply.status(200).send({ received: true });
  });
};

