import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';

// Avaliacao de compra (doc. Pluton 3.4, 5.5 e 10.3): simular sem gravar, vereditos com o numero,
// RECUSAR bloqueia planejar, desvio com consequencia, 72 h, compra planejada pesa no limite.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId;
const now = new Date();
const req = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });
const buy = { description: 'Fone', priceMinor: 20_000, payment: 'cash', reason: 'desejo', urgency: 2, mood: 'calmo' };

/** Renda 5 mil, aluguel 1,5 mil, margem 0: limite 3,5 mil; reserva de 6 meses de custo fixo. */
async function setup() {
  await req('PUT', '/v1/agent/profile', { netIncomeMinor: 500_000, safetyMarginPct: 0 });
  await req('POST', '/v1/agent/fixed-expenses', { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 150_000, dueDay: 5, recurrence: 'monthly' });
  await h.ctx.col.goals.insertOne({ _id: new ObjectId(), userId, name: 'Reserva de emergência', icon: 'shield', targetMinor: 900_000, savedMinor: 900_000, deadline: '2030-01-01', monthlyContributionMinor: 0, createdAt: now, updatedAt: now } as never);
}

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
});

describe('avaliacao de compra', () => {
  it('simular nao grava; aprovar informa o impacto; planejada pesa no limite', async () => {
    await setup();
    const sim = (await req('POST', '/v1/agent/purchases/simulate', buy)).json();
    expect(sim).toMatchObject({ id: null, status: 'simulada', verdict: 'aprovar', reason: 'cabe' });
    expect(sim.headline).toMatch(/^APROVAR: cabe no limite/);
    expect(await h.ctx.col.purchaseEvaluations.countDocuments({ userId })).toBe(0);

    const e = (await req('POST', '/v1/agent/purchases', buy)).json();
    expect(e).toMatchObject({ status: 'avaliada', canPlan: true });
    const before = (await req('GET', '/v1/agent/limit')).json();
    const p = (await req('POST', `/v1/agent/purchases/${e.id}/plan`)).json();
    expect(p.status).toBe('planejada');
    const after = (await req('GET', '/v1/agent/limit')).json();
    expect(after.plannedMinor).toBe(20_000);
    expect(after.remainingMinor).toBe(before.remainingMinor - 20_000);
    expect((await req('POST', `/v1/agent/purchases/${e.id}/bought`)).json().status).toBe('comprada');
    expect((await req('GET', '/v1/agent/limit')).json().plannedMinor).toBe(0);
  });

  it('RECUSAR bloqueia planejar; comprar mesmo assim vira desvio com consequencia', async () => {
    await setup();
    const e = (await req('POST', '/v1/agent/purchases', { ...buy, description: 'TV', priceMinor: 400_000 })).json();
    expect(e).toMatchObject({ verdict: 'recusar', reason: 'estoura-limite', canPlan: false });
    expect(e.headline).toContain('passa R$');
    const r = await req('POST', `/v1/agent/purchases/${e.id}/plan`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('NOT_APPROVED');
    const d = (await req('POST', `/v1/agent/purchases/${e.id}/bought`)).json();
    expect(d.status).toBe('desvio');
    expect(d.consequence[0]).toContain('desvio do plano');
    expect(d.consequence.join(' ')).toContain('no negativo');
    expect(await h.ctx.col.auditLogs.findOne({ userId, event: 'purchase.deviation' })).not.toBeNull();
  });

  it('"eu mereço": reconhece e aplica a espera de 72 h; depois reavalia', async () => {
    await setup();
    const e = (await req('POST', '/v1/agent/purchases', { ...buy, mood: 'recompensa' })).json();
    expect(e).toMatchObject({ verdict: 'adiar', reason: 'regra-72h', status: 'espera-72h', canPlan: false });
    expect(e.explanation[0]).toContain('Quero me recompensar');
    let r = await req('POST', `/v1/agent/purchases/${e.id}/plan`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('COOLING_OFF');
    await h.ctx.col.purchaseEvaluations.updateOne({ _id: new ObjectId(e.id) }, { $set: { holdUntil: new Date(now.getTime() - 1000) } });
    expect((await req('GET', '/v1/agent/purchases')).json()[0].canPlan).toBe(true);
    r = await req('POST', `/v1/agent/purchases/${e.id}/plan`);
    expect(r.json()).toMatchObject({ status: 'planejada', verdict: 'aprovar' });
  });

  it('financiado com reserva baixa: recusa mostrando o custo dos juros; vira meta', async () => {
    await req('PUT', '/v1/agent/profile', { netIncomeMinor: 500_000, safetyMarginPct: 0 });
    await req('POST', '/v1/agent/fixed-expenses', { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 150_000, dueDay: 5, recurrence: 'monthly' });
    const e = (await req('POST', '/v1/agent/purchases', { ...buy, description: 'Moto', priceMinor: 1_000_000, payment: 'financed', installments: 24, monthlyRate: 0.03, reason: 'trabalho', urgency: 3 })).json();
    expect(e).toMatchObject({ verdict: 'recusar', reason: 'juros-sem-reserva' });
    expect(e.interestMinor).toBeGreaterThan(400_000);
    const draft = (await req('POST', `/v1/agent/purchases/${e.id}/to-goal`)).json();
    expect(draft).toMatchObject({ kind: 'purchase', title: 'Moto', answers: { targetMinor: 1_000_000, paymentMethod: 'financed', installments: 24, reason: 'trabalho' } });
    expect(draft.missing).not.toContain('targetMinor');
  });

  it('urgencia real que nao cabe: usa a reserva com plano de recomposicao', async () => {
    await setup();
    const e = (await req('POST', '/v1/agent/purchases', { ...buy, description: 'Conserto da geladeira', priceMinor: 450_000, reason: 'moradia', urgency: 5 })).json();
    expect(e).toMatchObject({ verdict: 'aprovar', reason: 'urgencia-reserva' });
    expect(e.reservePlan.useMinor).toBe(100_000);
    expect(e.headline).toContain('usando a reserva');
  });

  it('valida o pedido e isola usuarios', async () => {
    expect((await req('POST', '/v1/agent/purchases', { ...buy, payment: 'financed', installments: 10 })).statusCode).toBe(400);
    expect((await req('POST', '/v1/agent/purchases', { ...buy, priceMinor: 0 })).statusCode).toBe(400);
    await setup();
    const e = (await req('POST', '/v1/agent/purchases', buy)).json();
    const other = (await h.createUser({ email: 'outro@pluto.test' })).id;
    const r = await h.app.inject({ method: 'POST', url: `/v1/agent/purchases/${e.id}/plan`, headers: { authorization: `Bearer ${await h.token(other)}` } });
    expect(r.statusCode).toBe(404);
  });
});
