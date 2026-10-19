import { BOLETO_MAX_DAYS, type Charge, type CreateCharge, type InstallmentStatus } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { ChargeDoc, InstallmentDoc } from '../../db/collections';
import type { BoletoStatus, StripeGateway } from '../../integrations/stripe/gateway';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { boletoEmail, cancellationEmail } from './emails';

// Cobrancas por boleto (Stripe). Cada parcela e um boleto registrado. O Stripe so aceita boleto
// que vence em ate 60 dias; parcelas mais distantes ficam SCHEDULED e o job as emite na hora certa.
// Quando uma parcela e paga e o destino e uma meta, o valor entra na meta (uma unica vez).

const BOLETO_TZ = 'America/Sao_Paulo';
const DAY = 86_400_000;

export const stripeOf = (ctx: AppContext): StripeGateway => {
  if (!ctx.stripe) throw new AppError(503, 'STRIPE_NOT_CONFIGURED', 'Cobrança por boleto não configurada (falta STRIPE_SECRET_KEY).');
  return ctx.stripe;
};

/** Hoje (YYYY-MM-DD) no fuso em que o Stripe conta o vencimento do boleto. */
export const todaySP = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: BOLETO_TZ }).format(now);
const ymdToUtc = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
export const daysUntil = (from: string, to: string) => Math.round((ymdToUtc(to) - ymdToUtc(from)) / DAY);
const addDays = (ymd: string, n: number) => new Date(ymdToUtc(ymd) + n * DAY).toISOString().slice(0, 10);

/** Mesmo dia nos meses seguintes; dia 31 vira o ultimo dia de meses mais curtos. */
export function addMonthsYmd(ymd: string, n: number): string {
  const y = +ymd.slice(0, 4), m = +ymd.slice(5, 7) - 1 + n, d = +ymd.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/** Divide em centavos: a ultima parcela leva a sobra, o total bate exatamente. */
export function splitInstallments(totalMinor: number, n: number): number[] {
  const base = Math.floor(totalMinor / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? totalMinor - base * (n - 1) : base));
}

export function toChargeDTO(c: ChargeDoc, goalName: string | null): Charge {
  return {
    id: c._id.toHexString(),
    destination: c.destination,
    goalId: c.goalId?.toHexString() ?? null,
    goalName,
    description: c.description,
    payerName: c.payerName,
    payerEmail: c.payerEmail,
    payerPhone: c.payerPhone,
    totalMinor: c.totalMinor,
    paidMinor: c.installments.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amountMinor, 0),
    installments: c.installments.map((i) => ({
      n: i.n,
      amountMinor: i.amountMinor,
      dueDate: i.dueDate,
      status: i.status,
      number: i.number,
      pdfUrl: i.pdfUrl,
      voucherUrl: i.voucherUrl,
      issueOn: i.status === 'SCHEDULED' ? addDays(i.dueDate, -BOLETO_MAX_DAYS) : null,
      paidAt: i.paidAt,
      paidVia: i.paidVia ?? null,
      sentAt: i.sentAt ?? null,
      cancelNotifiedAt: i.cancelNotifiedAt ?? null,
      error: i.error,
    })),
    createdAt: c.createdAt,
  };
}

export async function chargesWithGoals(ctx: AppContext, docs: ChargeDoc[]) {
  const ids = [...new Set(docs.map((d) => d.goalId).filter((g): g is ObjectId => !!g))];
  const goals = new Map((await ctx.col.goals.find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray()).map((g) => [g._id.toHexString(), g.name]));
  return docs.map((d) => toChargeDTO(d, d.goalId ? (goals.get(d.goalId.toHexString()) ?? null) : null));
}

const setInstallment = (ctx: AppContext, chargeId: ObjectId, n: number, patch: Partial<InstallmentDoc>, onlyIf?: InstallmentStatus[]) =>
  ctx.col.charges.updateOne(
    { _id: chargeId, installments: { $elemMatch: { n, ...(onlyIf ? { status: { $in: onlyIf } } : {}) } } },
    { $set: { ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [`installments.$.${k}`, v])), updatedAt: new Date() } },
  );

/** Emite o boleto de uma parcela agendada, se ja estiver dentro dos 60 dias. */
async function issueInstallment(ctx: AppContext, c: ChargeDoc, inst: InstallmentDoc, today: string) {
  const days = daysUntil(today, inst.dueDate);
  if (days > BOLETO_MAX_DAYS) return;
  if (days < 0) {
    // A API ficou desligada alem do vencimento: nao emite boleto ja vencido.
    await setInstallment(ctx, c._id, inst.n, { status: 'EXPIRED', error: 'Vencimento passou antes da emissão' }, ['SCHEDULED']);
    return;
  }
  const stripe = stripeOf(ctx);
  const address = JSON.parse(ctx.crypto.decrypt(c.payerAddressEnc)) as { postalCode: string; line1: string; city: string; state: string };
  const n = c.installments.length;
  try {
    const b = await stripe.createBoleto({
      amountMinor: inst.amountMinor,
      description: [c.description || 'Cobrança', n > 1 ? `parcela ${inst.n}/${n}` : ''].filter(Boolean).join(' · '),
      expiresAfterDays: days,
      payer: { name: c.payerName, email: c.payerEmail, taxId: ctx.crypto.decrypt(c.payerTaxIdEnc), address },
      metadata: { chargeId: c._id.toHexString(), installment: String(inst.n), userId: c.userId.toHexString() },
      idempotencyKey: `pluto-charge-${c._id.toHexString()}-${inst.n}`,
    });
    await setInstallment(ctx, c._id, inst.n, { status: 'OPEN', paymentIntentId: b.paymentIntentId, number: b.number, pdfUrl: b.pdfUrl, voucherUrl: b.voucherUrl, error: null }, ['SCHEDULED', 'FAILED']);
  } catch (e) {
    // Mensagem do Stripe ajuda a corrigir (ex.: CPF invalido); nunca inclui segredo.
    const msg = e instanceof Error ? e.message.slice(0, 200) : 'erro desconhecido';
    await setInstallment(ctx, c._id, inst.n, { status: 'FAILED', error: `O Stripe recusou o boleto: ${msg}` }, ['SCHEDULED', 'FAILED']);
  }
}

export async function createCharge(ctx: AppContext, userId: ObjectId, input: CreateCharge, ip: string | null) {
  stripeOf(ctx);
  const today = todaySP();
  if (input.firstDueDate < today) throw new AppError(400, 'DUE_DATE_PAST', 'O vencimento não pode ser no passado.');
  let goalId: ObjectId | null = null;
  if (input.destination === 'GOAL') {
    const goal = await ctx.col.goals.findOne({ _id: new ObjectId(input.goalId!), userId });
    if (!goal) throw notFound('Meta');
    goalId = goal._id;
  }
  const now = new Date();
  const amounts = splitInstallments(input.totalMinor, input.installments);
  const doc: Omit<ChargeDoc, '_id'> = {
    userId,
    destination: input.destination,
    goalId,
    description: input.description,
    payerName: input.payer.name,
    payerEmail: input.payer.email,
    payerPhone: input.payer.phone,
    payerTaxIdEnc: ctx.crypto.encrypt(input.payer.taxId),
    payerAddressEnc: ctx.crypto.encrypt(JSON.stringify(input.payer.address)),
    totalMinor: input.totalMinor,
    installments: amounts.map((amountMinor, i) => ({
      n: i + 1,
      amountMinor,
      dueDate: addMonthsYmd(input.firstDueDate, i),
      status: 'SCHEDULED',
      paymentIntentId: null,
      number: null,
      pdfUrl: null,
      voucherUrl: null,
      paidAt: null,
      creditedAt: null,
      paidVia: null,
      error: null,
    })),
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await ctx.col.charges.insertOne(doc as ChargeDoc);
  const created = { _id: insertedId, ...doc } as ChargeDoc;
  for (const inst of created.installments) await issueInstallment(ctx, created, inst, today);
  await audit(ctx.col, 'charge.created', userId, { chargeId: insertedId.toHexString(), installments: input.installments, destination: input.destination }, ip);
  return (await ctx.col.charges.findOne({ _id: insertedId }))!;
}

/** Parcela paga: marca uma vez e, se o destino for uma meta, soma o valor nela uma unica vez. */
async function markPaid(ctx: AppContext, c: ChargeDoc, n: number, via: 'BOLETO' | 'MANUAL' = 'BOLETO') {
  const now = new Date();
  const from: InstallmentStatus[] = via === 'MANUAL' ? ['OPEN', 'SCHEDULED', 'EXPIRED', 'FAILED'] : ['OPEN', 'EXPIRED', 'FAILED'];
  await setInstallment(ctx, c._id, n, { status: 'PAID', paidAt: now, paidVia: via, error: null }, from);
  if (c.destination !== 'GOAL' || !c.goalId) return;
  const claim = await ctx.col.charges.updateOne(
    { _id: c._id, installments: { $elemMatch: { n, status: 'PAID', creditedAt: null } } },
    { $set: { 'installments.$.creditedAt': now } },
  );
  if (!claim.modifiedCount) return;
  const inst = c.installments.find((i) => i.n === n)!;
  await ctx.col.goals.updateOne({ _id: c.goalId, userId: c.userId }, { $inc: { savedMinor: inst.amountMinor }, $set: { updatedAt: now } });
  await audit(ctx.col, 'charge.goal_credited', c.userId, { chargeId: c._id.toHexString(), installment: n }, null);
}

const STATUS_FROM_STRIPE: Record<BoletoStatus, InstallmentStatus> = { OPEN: 'OPEN', PAID: 'PAID', EXPIRED: 'EXPIRED', CANCELED: 'CANCELED' };

/** Reconsulta no Stripe as parcelas em aberto (nunca confia so no webhook). */
export async function refreshCharge(ctx: AppContext, c: ChargeDoc) {
  const stripe = stripeOf(ctx);
  for (const inst of c.installments) {
    if (inst.status !== 'OPEN' || !inst.paymentIntentId) continue;
    const status = STATUS_FROM_STRIPE[await stripe.getStatus(inst.paymentIntentId)];
    if (status === 'PAID') await markPaid(ctx, c, inst.n);
    else if (status !== 'OPEN') await setInstallment(ctx, c._id, inst.n, { status }, ['OPEN']);
  }
}

/** Job e botao "Atualizar": emite parcelas que entraram na janela de 60 dias e atualiza as abertas. */
export async function processCharges(ctx: AppContext, filter: { userId?: ObjectId } = {}, log?: { warn: (o: object, m: string) => void }) {
  if (!ctx.stripe) return;
  const today = todaySP();
  const cursor = ctx.col.charges.find({ ...filter, canceledAt: null, 'installments.status': { $in: ['SCHEDULED', 'OPEN'] } });
  for await (const c of cursor) {
    try {
      for (const inst of c.installments) if (inst.status === 'SCHEDULED') await issueInstallment(ctx, c, inst, today);
      await refreshCharge(ctx, (await ctx.col.charges.findOne({ _id: c._id }))!);
    } catch (e) {
      log?.warn({ chargeId: c._id.toHexString(), err: e instanceof Error ? e.message : String(e) }, 'falha ao atualizar cobrança');
    }
  }
}

export async function handleStripeEvent(ctx: AppContext, paymentIntentId: string) {
  const c = await ctx.col.charges.findOne({ 'installments.paymentIntentId': paymentIntentId });
  if (c) await refreshCharge(ctx, c);
}

/**
 * Encerra uma parcela antes do pagamento pelo banco. O boleto em aberto e invalidado no Stripe
 * primeiro; se o Stripe disser que ja foi pago, vale o pagamento (e nao o encerramento).
 */
export async function closeInstallment(ctx: AppContext, userId: ObjectId, id: string, n: number, outcome: 'CANCEL' | 'RECEIVED', ip: string | null) {
  const c = await ctx.col.charges.findOne({ _id: new ObjectId(id), userId });
  if (!c) throw notFound('Cobrança');
  const inst = c.installments.find((i) => i.n === n);
  if (!inst) throw notFound('Parcela');
  if (inst.status === 'PAID' || inst.status === 'CANCELED') throw new AppError(409, 'INSTALLMENT_CLOSED', 'Este boleto já está encerrado.');

  if (inst.status === 'OPEN' && inst.paymentIntentId) {
    const stripe = stripeOf(ctx);
    await stripe.cancel(inst.paymentIntentId).catch(() => {});
    if ((await stripe.getStatus(inst.paymentIntentId)) === 'PAID') {
      await markPaid(ctx, c, n);
      throw new AppError(409, 'ALREADY_PAID', 'Este boleto já foi pago pelo banco. A parcela foi marcada como paga.');
    }
  }
  if (outcome === 'RECEIVED') await markPaid(ctx, c, n, 'MANUAL');
  else await setInstallment(ctx, c._id, n, { status: 'CANCELED' }, ['OPEN', 'SCHEDULED', 'EXPIRED', 'FAILED']);
  await audit(ctx.col, 'charge.installment_closed', userId, { chargeId: id, installment: n, outcome }, ip);
  // Boleto ja emitido pode estar com o pagador: ele precisa saber que nao deve pagar.
  if (outcome === 'CANCEL' && inst.status === 'OPEN') await notifyCancellation(ctx, c._id, [n]);
  return (await ctx.col.charges.findOne({ _id: c._id }))!;
}

export async function cancelCharge(ctx: AppContext, userId: ObjectId, id: string, ip: string | null) {
  const c = await ctx.col.charges.findOne({ _id: new ObjectId(id), userId });
  if (!c) throw notFound('Cobrança');
  const stripe = stripeOf(ctx);
  const wasOpen = c.installments.filter((i) => i.status === 'OPEN').map((i) => i.n);
  for (const inst of c.installments) {
    if (inst.status === 'SCHEDULED') await setInstallment(ctx, c._id, inst.n, { status: 'CANCELED' }, ['SCHEDULED']);
    if (inst.status === 'OPEN' && inst.paymentIntentId) {
      // Se ja foi pago, o Stripe recusa o cancelamento: a atualizacao abaixo registra o pagamento.
      await stripe.cancel(inst.paymentIntentId).catch(() => {});
    }
  }
  await refreshCharge(ctx, (await ctx.col.charges.findOne({ _id: c._id }))!);
  await ctx.col.charges.updateOne({ _id: c._id }, { $set: { canceledAt: new Date(), updatedAt: new Date() } });
  await audit(ctx.col, 'charge.canceled', userId, { chargeId: id }, ip);
  if (wasOpen.length) await notifyCancellation(ctx, c._id, wasOpen);
  return (await ctx.col.charges.findOne({ _id: c._id }))!;
}

const beneficiaryOf = async (ctx: AppContext, userId: ObjectId) => {
  const u = await ctx.col.users.findOne({ _id: userId }, { projection: { name: 1, email: 1 } });
  return { name: u?.name ?? 'Pluto', email: u?.email ?? null };
};

/**
 * Avisa o pagador, por e-mail, das parcelas emitidas que foram canceladas. Sem Resend configurado
 * ou com falha no envio, o cancelamento continua valendo (o aviso e um extra, nao uma condicao).
 */
async function notifyCancellation(ctx: AppContext, chargeId: ObjectId, ns: number[]) {
  if (!ctx.mailer) return;
  const c = (await ctx.col.charges.findOne({ _id: chargeId }))!;
  const items = c.installments.filter((i) => ns.includes(i.n) && i.status === 'CANCELED' && !i.cancelNotifiedAt);
  if (!items.length) return;
  const from = await beneficiaryOf(ctx, c.userId);
  try {
    await ctx.mailer.send({
      to: c.payerEmail,
      replyTo: from.email,
      ...cancellationEmail(c, items, from.name),
      idempotencyKey: `pluto-cancel-${c._id.toHexString()}-${items.map((i) => i.n).join('-')}`,
    });
    const now = new Date();
    for (const i of items) await setInstallment(ctx, c._id, i.n, { cancelNotifiedAt: now });
  } catch {
    await audit(ctx.col, 'charge.cancel_notice_failed', c.userId, { chargeId: c._id.toHexString() }, null);
  }
}

/** Envia por e-mail os boletos em aberto (ou so a parcela n). Boleto cancelado nao e enviado. */
export async function sendChargeEmail(ctx: AppContext, userId: ObjectId, id: string, n: number | null, ip: string | null) {
  if (!ctx.mailer) throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Envio de e-mail não configurado (falta RESEND_API_KEY).');
  const c = await ctx.col.charges.findOne({ _id: new ObjectId(id), userId });
  if (!c) throw notFound('Cobrança');
  if (n != null) {
    const inst = c.installments.find((i) => i.n === n);
    if (!inst) throw notFound('Parcela');
    if (inst.status === 'CANCELED') throw new AppError(409, 'INSTALLMENT_CANCELED', 'Este boleto foi cancelado e não pode ser enviado.');
  }
  const items = c.installments.filter((i) => i.status === 'OPEN' && !!i.number && (n == null || i.n === n));
  if (!items.length) throw new AppError(409, 'NOTHING_TO_SEND', 'Não há boleto em aberto para enviar.');
  const from = await beneficiaryOf(ctx, userId);
  try {
    await ctx.mailer.send({
      to: c.payerEmail,
      replyTo: from.email,
      ...boletoEmail(c, items, from.name),
      // Clique duplo no mesmo minuto nao gera dois e-mails; reenviar depois e permitido.
      idempotencyKey: `pluto-send-${c._id.toHexString()}-${items.map((i) => i.n).join('-')}-${Math.floor(Date.now() / 60_000)}`,
    });
  } catch (e) {
    throw new AppError(502, 'EMAIL_FAILED', `Não foi possível enviar o e-mail: ${e instanceof Error ? e.message.slice(0, 160) : 'erro'}`);
  }
  const now = new Date();
  for (const i of items) await setInstallment(ctx, c._id, i.n, { sentAt: now });
  await audit(ctx.col, 'charge.emailed', userId, { chargeId: id, installments: items.map((i) => i.n) }, ip);
  return (await ctx.col.charges.findOne({ _id: c._id }))!;
}
