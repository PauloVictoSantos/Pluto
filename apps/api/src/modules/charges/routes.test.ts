import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OutgoingEmail } from '../../integrations/email/resend';
import type { BoletoStatus, CreateBoletoInput, StripeGateway } from '../../integrations/stripe/gateway';
import { startHarness, type Harness } from '../../test/harness';
import { addMonthsYmd, daysUntil, processCharges, splitInstallments, todaySP } from './service';

class FakeStripe implements StripeGateway {
  created: CreateBoletoInput[] = [];
  status = new Map<string, BoletoStatus>();
  canceled: string[] = [];
  failNext: string | null = null;
  async createBoleto(input: CreateBoletoInput) {
    if (this.failNext) {
      const m = this.failNext;
      this.failNext = null;
      throw new Error(m);
    }
    this.created.push(input);
    const id = `pi_${this.created.length}`;
    this.status.set(id, 'OPEN');
    return { paymentIntentId: id, number: '0'.repeat(47), pdfUrl: `https://pay.stripe.test/${id}.pdf`, voucherUrl: `https://pay.stripe.test/${id}` };
  }
  async getStatus(id: string) {
    return this.status.get(id) ?? 'OPEN';
  }
  async cancel(id: string) {
    this.canceled.push(id);
    if (this.status.get(id) === 'OPEN') this.status.set(id, 'CANCELED');
  }
  parseWebhook(_raw: Buffer, signature: string) {
    if (signature !== 'assinatura-valida') throw new Error('bad signature');
    return { type: 'payment_intent.succeeded', paymentIntentId: 'pi_1' };
  }
}

let h: Harness;
let stripe: FakeStripe;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => {
  await h.reset();
  stripe = new FakeStripe();
  h.ctx.stripe = stripe;
  h.ctx.mailer = null;
});

type User = Awaited<ReturnType<Harness['createUser']>>;
const req = async (u: User, method: 'GET' | 'POST', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(u.id)}` } });
const inDays = (n: number) => new Date(Date.parse(`${todaySP()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const payer = {
  name: 'Carla Mendes',
  taxId: '529.982.247-25',
  email: 'carla@exemplo.test',
  phone: '(92) 99999-0000',
  address: { postalCode: '69005-010', line1: 'Av. Eduardo Ribeiro, 520', city: 'Manaus', state: 'am' },
};
const body = (over: object = {}) => ({ destination: 'CHARGE', description: 'Aulas de inglês', payer, totalMinor: 30_000, installments: 3, firstDueDate: inDays(10), ...over });

describe('regras de parcelamento', () => {
  it('divide em centavos sem perder nada e avanca os meses', () => {
    expect(splitInstallments(10_000, 3)).toEqual([3333, 3333, 3334]);
    expect(addMonthsYmd('2026-01-31', 1)).toBe('2026-02-28');
    expect(daysUntil('2026-10-18', '2026-12-17')).toBe(60);
  });
});

describe('/v1/charges', () => {
  it('sem Stripe configurado responde 503', async () => {
    h.ctx.stripe = null;
    const u = await h.createUser();
    expect((await req(u, 'POST', '/v1/charges', body())).json().error.code).toBe('STRIPE_NOT_CONFIGURED');
  });

  it('emite as parcelas que vencem em ate 60 dias e agenda as demais', async () => {
    const u = await h.createUser();
    const res = await req(u, 'POST', '/v1/charges', body());
    expect(res.statusCode).toBe(201);
    const c = res.json();
    expect(c.installments.map((i: { amountMinor: number }) => i.amountMinor)).toEqual([10_000, 10_000, 10_000]);
    expect(c.installments.map((i: { status: string }) => i.status)).toEqual(['OPEN', 'OPEN', 'SCHEDULED']);
    expect(c.installments[2].issueOn).toBeTruthy();
    expect(stripe.created[0]).toMatchObject({ amountMinor: 10_000, expiresAfterDays: 10, payer: { taxId: '52998224725', address: { state: 'AM', postalCode: '69005010' } } });
    expect(stripe.created[0]!.description).toContain('parcela 1/3');
    expect(new Set(stripe.created.map((x) => x.idempotencyKey)).size).toBe(2);
    // CPF e endereco do pagador ficam cifrados.
    const doc = await h.ctx.col.charges.findOne({});
    expect(doc!.payerTaxIdEnc).not.toContain('529');
  });

  it('parcela agendada e emitida quando entra na janela de 60 dias', async () => {
    const u = await h.createUser();
    const { id } = (await req(u, 'POST', '/v1/charges', body())).json();
    await h.ctx.col.charges.updateOne({ _id: new ObjectId(id), 'installments.n': 3 }, { $set: { 'installments.$.dueDate': inDays(20) } });
    await processCharges(h.ctx);
    const doc = await h.ctx.col.charges.findOne({ _id: new ObjectId(id) });
    expect(doc!.installments[2]!.status).toBe('OPEN');
    expect(stripe.created).toHaveLength(3);
  });

  it('pagamento para meta soma na meta uma unica vez', async () => {
    const u = await h.createUser();
    const goal = await h.ctx.col.goals.insertOne({ userId: u.id, name: 'Viagem', icon: 'plane', targetMinor: 500_000, savedMinor: 1_000, deadline: inDays(300), monthlyContributionMinor: 10_000, createdAt: new Date(), updatedAt: new Date() } as never);
    await req(u, 'POST', '/v1/charges', body({ destination: 'GOAL', goalId: goal.insertedId.toHexString(), installments: 1, totalMinor: 10_000 }));
    stripe.status.set('pi_1', 'PAID');
    const list = (await req(u, 'POST', '/v1/charges/refresh')).json();
    expect(list[0]).toMatchObject({ paidMinor: 10_000, goalName: 'Viagem' });
    await req(u, 'POST', '/v1/charges/refresh');
    expect((await h.ctx.col.goals.findOne({ _id: goal.insertedId }))!.savedMinor).toBe(11_000);
  });

  it('meta de outra conta, parcela pequena e vencimento passado sao recusados', async () => {
    const [a, b] = [await h.createUser({ email: 'a@pluto.test' }), await h.createUser({ email: 'b@pluto.test' })];
    const goal = await h.ctx.col.goals.insertOne({ userId: b.id, name: 'X', icon: 'x', targetMinor: 1, savedMinor: 0, deadline: inDays(9), monthlyContributionMinor: 0, createdAt: new Date(), updatedAt: new Date() } as never);
    expect((await req(a, 'POST', '/v1/charges', body({ destination: 'GOAL', goalId: goal.insertedId.toHexString() }))).statusCode).toBe(404);
    expect((await req(a, 'POST', '/v1/charges', body({ totalMinor: 1_000, installments: 3 }))).statusCode).toBe(400);
    expect((await req(a, 'POST', '/v1/charges', body({ firstDueDate: inDays(-1) }))).json().error.code).toBe('DUE_DATE_PAST');
    expect((await req(a, 'POST', '/v1/charges', body({ payer: { ...payer, taxId: '123' } }))).statusCode).toBe(400);
  });

  it('recusa do Stripe vira parcela FAILED com o motivo', async () => {
    const u = await h.createUser();
    stripe.failNext = 'Invalid tax_id';
    const c = (await req(u, 'POST', '/v1/charges', body({ installments: 1 }))).json();
    expect(c.installments[0]).toMatchObject({ status: 'FAILED', error: expect.stringContaining('Invalid tax_id') });
  });

  it('cancelar cancela os boletos abertos e as agendadas; so o dono ve e cancela', async () => {
    const [a, b] = [await h.createUser({ email: 'a@pluto.test' }), await h.createUser({ email: 'b@pluto.test' })];
    const { id } = (await req(a, 'POST', '/v1/charges', body())).json();
    expect((await req(b, 'GET', '/v1/charges')).json()).toHaveLength(0);
    expect((await req(b, 'POST', `/v1/charges/${id}/cancel`)).statusCode).toBe(404);
    const c = (await req(a, 'POST', `/v1/charges/${id}/cancel`)).json();
    expect(c.installments.map((i: { status: string }) => i.status)).toEqual(['CANCELED', 'CANCELED', 'CANCELED']);
    expect(stripe.canceled).toEqual(['pi_1', 'pi_2']);
  });
});

describe('encerrar um boleto', () => {
  const close = (u: User, id: string, n: number, outcome: string) => req(u, 'POST', `/v1/charges/${id}/installments/${n}/close`, { outcome });

  it('cancelar invalida o boleto no Stripe e so mexe naquela parcela', async () => {
    const u = await h.createUser();
    const { id } = (await req(u, 'POST', '/v1/charges', body())).json();
    const c = (await close(u, id, 1, 'CANCEL')).json();
    expect(c.installments.map((i: { status: string }) => i.status)).toEqual(['CANCELED', 'OPEN', 'SCHEDULED']);
    expect(stripe.canceled).toEqual(['pi_1']);
    // Parcela agendada tambem pode ser encerrada, sem chamar o Stripe.
    expect((await close(u, id, 3, 'CANCEL')).json().installments[2].status).toBe('CANCELED');
    expect(stripe.canceled).toEqual(['pi_1']);
    expect((await close(u, id, 1, 'CANCEL')).json().error.code).toBe('INSTALLMENT_CLOSED');
  });

  it('"recebi por fora" conta como pago e entra na meta', async () => {
    const u = await h.createUser();
    const goal = await h.ctx.col.goals.insertOne({ userId: u.id, name: 'Reserva', icon: 'x', targetMinor: 900_000, savedMinor: 0, deadline: inDays(300), monthlyContributionMinor: 0, createdAt: new Date(), updatedAt: new Date() } as never);
    const { id } = (await req(u, 'POST', '/v1/charges', body({ destination: 'GOAL', goalId: goal.insertedId.toHexString() }))).json();
    const c = (await close(u, id, 1, 'RECEIVED')).json();
    expect(c.installments[0]).toMatchObject({ status: 'PAID', paidVia: 'MANUAL' });
    expect(c.paidMinor).toBe(10_000);
    expect(stripe.canceled).toEqual(['pi_1']);
    expect((await h.ctx.col.goals.findOne({ _id: goal.insertedId }))!.savedMinor).toBe(10_000);
  });

  it('se o banco ja pagou, vale o pagamento e nao o encerramento; so o dono encerra', async () => {
    const [a, b] = [await h.createUser({ email: 'a@pluto.test' }), await h.createUser({ email: 'b@pluto.test' })];
    const { id } = (await req(a, 'POST', '/v1/charges', body({ installments: 1 }))).json();
    expect((await close(b, id, 1, 'CANCEL')).statusCode).toBe(404);
    stripe.status.set('pi_1', 'PAID');
    expect((await close(a, id, 1, 'CANCEL')).json().error.code).toBe('ALREADY_PAID');
    expect((await h.ctx.col.charges.findOne({}))!.installments[0]).toMatchObject({ status: 'PAID', paidVia: 'BOLETO' });
  });
});

describe('e-mail ao pagador (Resend)', () => {
  let sent: OutgoingEmail[];
  beforeEach(() => {
    sent = [];
    h.ctx.mailer = { send: async (e) => (sent.push(e), { id: `em_${sent.length}` }) };
  });
  const send = (u: User, id: string, n: number | null = null) => req(u, 'POST', `/v1/charges/${id}/send`, { n });
  const close = (u: User, id: string, n: number) => req(u, 'POST', `/v1/charges/${id}/installments/${n}/close`, { outcome: 'CANCEL' });

  it('envia os boletos em aberto com linha digitavel e link, escapando o texto do usuario', async () => {
    const u = await h.createUser();
    const { id } = (await req(u, 'POST', '/v1/charges', body({ description: '<script>x</script> Aulas' }))).json();
    const c = (await send(u, id)).json();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'carla@exemplo.test', replyTo: u.email });
    expect(sent[0]!.html).toContain('https://pay.stripe.test/pi_1');
    expect(sent[0]!.html).toContain('&lt;script&gt;');
    expect(sent[0]!.html).not.toContain('<script>');
    // So as duas parcelas ja emitidas; a agendada fica para depois.
    expect(c.installments.map((i: { sentAt: string | null }) => !!i.sentAt)).toEqual([true, true, false]);
  });

  it('boleto cancelado nao pode ser enviado e o pagador e avisado uma vez', async () => {
    const u = await h.createUser();
    const { id } = (await req(u, 'POST', '/v1/charges', body())).json();
    const c = (await close(u, id, 1)).json();
    expect(c.installments[0].cancelNotifiedAt).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('cancelado');
    expect(sent[0]!.html).toContain('Não pague');
    expect((await send(u, id, 1)).json().error.code).toBe('INSTALLMENT_CANCELED');

    // Cancelar a cobranca inteira avisa so a parcela emitida que faltava (a agendada nunca saiu).
    await req(u, 'POST', `/v1/charges/${id}/cancel`);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('parcela 2/3');
    expect(sent[1]!.text).not.toContain('parcela 3/3');
    expect((await send(u, id)).json().error.code).toBe('NOTHING_TO_SEND');
  });

  it('sem Resend: enviar responde 503 e o cancelamento funciona mesmo assim', async () => {
    h.ctx.mailer = null;
    const u = await h.createUser();
    const { id } = (await req(u, 'POST', '/v1/charges', body({ installments: 1 }))).json();
    expect((await send(u, id)).json().error.code).toBe('EMAIL_NOT_CONFIGURED');
    expect((await close(u, id, 1)).json().installments[0]).toMatchObject({ status: 'CANCELED', cancelNotifiedAt: null });
  });
});

describe('/v1/webhooks/stripe', () => {
  it('valida a assinatura e reconsulta o pagamento no Stripe', async () => {
    Object.assign(h.ctx.env, { STRIPE_WEBHOOK_SECRET: 'whsec_teste' });
    const u = await h.createUser();
    await req(u, 'POST', '/v1/charges', body({ installments: 1 }));
    const send = (sig: string) => h.app.inject({ method: 'POST', url: '/v1/webhooks/stripe', payload: '{"id":"evt_1"}', headers: { 'content-type': 'application/json', 'stripe-signature': sig } });

    expect((await send('forjada')).statusCode).toBe(400);
    stripe.status.set('pi_1', 'PAID');
    expect((await send('assinatura-valida')).statusCode).toBe(200);
    expect((await h.ctx.col.charges.findOne({}))!.installments[0]!.status).toBe('PAID');
  });
});
