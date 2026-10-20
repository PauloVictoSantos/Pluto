import { CreateCommitmentSchema, CreateDebtSourceSchema, DebtSourceSchema, UpdateCommitmentSchema, UpdateDebtSourceSchema } from '@pluto/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { requireAuth, userOf } from '../../plugins/auth';
import { listDebts, syncDebtBills } from './service';

const IdParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) });
const List = { response: { 200: z.array(DebtSourceSchema) } };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));

// Dividas manuais (cartao de terceiro, boleto ou Pix fora do Open Finance).
export const debtRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.addHook('preHandler', requireAuth(ctx));
  const { col } = ctx;
  const done = async (userId: ObjectId) => {
    await syncDebtBills(ctx, userId);
    return listDebts(ctx, userId);
  };

  app.get('/debts', { schema: List }, async (req) => done(userOf(req).id));

  app.post('/debts/sources', { schema: { body: CreateDebtSourceSchema, ...List } }, async (req) => {
    const userId = userOf(req).id, now = new Date(), b = req.body;
    const doc = { _id: new ObjectId(), userId, holder: null, bank: null, cardProduct: null, brand: null, last4: null, notes: null, ...clean(b), name: b.name, method: b.method, dueDay: b.dueDay, createdAt: now, updatedAt: now };
    await col.debtSources.insertOne(doc as never);
    await audit(col, 'debt_source.created', userId, { sourceId: doc._id.toHexString() }, req.ip);
    return done(userId);
  });

  app.patch('/debts/sources/:id', { schema: { params: IdParam, body: UpdateDebtSourceSchema, ...List } }, async (req) => {
    const userId = userOf(req).id;
    const r = await col.debtSources.updateOne({ _id: new ObjectId(req.params.id), userId }, { $set: { ...clean(req.body), updatedAt: new Date() } });
    if (!r.matchedCount) throw notFound('Forma de pagamento');
    return done(userId);
  });

  /** So sem compras: com historico, encerre as compras (RN-G07). */
  app.delete('/debts/sources/:id', { schema: { params: IdParam, ...List } }, async (req) => {
    const userId = userOf(req).id, _id = new ObjectId(req.params.id);
    if (await col.commitments.countDocuments({ userId, sourceId: _id }, { limit: 1 }))
      throw new AppError(409, 'HAS_COMMITMENTS', 'Encerre ou apague as compras desta forma de pagamento primeiro.');
    const r = await col.debtSources.deleteOne({ _id, userId });
    if (!r.deletedCount) throw notFound('Forma de pagamento');
    await col.bills.deleteMany({ userId, sourceId: _id, status: { $ne: 'paid' } });
    return done(userId);
  });

  app.post('/debts/commitments', { schema: { body: CreateCommitmentSchema, ...List } }, async (req) => {
    const userId = userOf(req).id, now = new Date(), b = req.body;
    const sourceId = new ObjectId(b.sourceId);
    if (!(await col.debtSources.findOne({ _id: sourceId, userId }))) throw notFound('Forma de pagamento');
    const installments = b.kind === 'installments';
    await col.commitments.insertOne({
      _id: new ObjectId(),
      userId,
      sourceId,
      merchant: b.merchant,
      categoryKey: b.categoryKey,
      approvedAt: b.approvedAt,
      kind: b.kind,
      totalMinor: installments ? b.totalMinor! : null,
      installments: installments ? b.installments! : null,
      monthlyMinor: installments ? null : b.monthlyMinor!,
      firstMonth: b.firstMonth,
      lastMonth: b.lastMonth ?? null,
      notes: b.notes || null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await audit(col, 'commitment.created', userId, { sourceId: b.sourceId, kind: b.kind }, req.ip);
    return done(userId);
  });

  app.patch('/debts/commitments/:id', { schema: { params: IdParam, body: UpdateCommitmentSchema, ...List } }, async (req) => {
    const userId = userOf(req).id;
    const r = await col.commitments.updateOne({ _id: new ObjectId(req.params.id), userId }, { $set: { ...clean(req.body), updatedAt: new Date() } });
    if (!r.matchedCount) throw notFound('Compra');
    return done(userId);
  });

  /** Apagar so cadastro errado, sem boleto pago com ela; com historico, encerre (active: false). */
  app.delete('/debts/commitments/:id', { schema: { params: IdParam, ...List } }, async (req) => {
    const userId = userOf(req).id, _id = new ObjectId(req.params.id);
    if (await col.bills.countDocuments({ userId, status: 'paid', 'items.commitmentId': _id }, { limit: 1 }))
      throw new AppError(409, 'HAS_PAYMENTS', 'Esta compra já tem pagamento registrado. Use "Encerrar" para parar os próximos boletos.');
    const r = await col.commitments.deleteOne({ _id, userId });
    if (!r.deletedCount) throw notFound('Compra');
    return done(userId);
  });
};
