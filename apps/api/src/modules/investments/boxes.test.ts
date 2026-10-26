import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetMarketRates } from '../../lib/marketRates';
import { startHarness, type Harness } from '../../test/harness';
import { listBoxes } from './boxes';

// Caixinhas: card por aplicacao, banco, saldo, meta ligada e rendimento em 1 mes, 1 ano e 5 anos.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId;
const conn = new ObjectId();
const now = new Date();
const auth = async () => ({ authorization: `Bearer ${await h.token(userId)}` });
const inv = (name: string, value: number, extra: Record<string, unknown>) => ({
  _id: new ObjectId(), userId, connectionId: conn, pluggyInvestmentId: name, type: 'FIXED_INCOME', subtype: 'CDB', name, quantity: null, appliedMinor: value - 1_000,
  currentValueMinor: value, dueDate: null, rateInfo: null, createdAt: now, updatedAt: now, ...extra,
});
// Banco Central respondendo: CDI 14%, Selic 14,15%, IPCA 4,5%.
const bcb = (async (url: string) => {
  const v = url.includes('.4389/') ? '14.00' : url.includes('.432/') ? '14.15' : '4.50';
  return new Response(JSON.stringify([{ data: '24/10/2026', valor: v }]));
}) as unknown as typeof fetch;

beforeEach(async () => {
  await h.reset();
  resetMarketRates();
  userId = (await h.createUser()).id;
  await h.ctx.col.connections.insertOne({
    _id: conn, userId, pluggyItemIdEnc: 'v1.x', pluggyItemIdHash: 'h', source: 'MEU_PLUGGY', connectorId: 1, institutionName: 'Nubank', imageUrl: null, primaryColor: null,
    status: 'UPDATED', needsAction: false, active: true, consentExpiresAt: null, lastSyncAt: now, lastTransactionsSyncAt: now, lastError: null, syncingUntil: null, removedAt: null, createdAt: now, updatedAt: now,
  } as never);
});

describe('caixinhas', () => {
  it('card por caixinha com banco, saldo, taxa e rendimento em 1 mes, 1 ano e 5 anos', async () => {
    await h.ctx.col.investments.insertMany([inv('Caixinha Viagem', 1_000_000, { rate: 100, rateType: 'CDI' }), inv('Tesouro IPCA', 500_000, { rateType: 'IPCA', fixedAnnualRate: 6 })] as never);
    const r = await listBoxes(h.ctx, userId, bcb);
    expect(r.rates).toMatchObject({ cdi: 0.14, ipca: 0.045, source: 'bcb' });
    expect(r.rates.selic).toBeCloseTo(0.1415);
    const cx = r.items.find((i) => i.name === 'Caixinha Viagem')!;
    expect(cx).toMatchObject({ institutionName: 'Nubank', valueMinor: 1_000_000, rateLabel: '100% do CDI', estimated: false });
    expect(cx.projection).toEqual({ monthMinor: 10_979, yearMinor: 140_000, fiveYearsMinor: 925_415 });
    expect(r.items.find((i) => i.name === 'Tesouro IPCA')!.annualRate).toBeCloseTo(1.045 * 1.06 - 1);
  });

  it('Banco Central fora do ar: usa a referencia do usuario e avisa', async () => {
    await h.ctx.col.investments.insertOne(inv('Porquinho', 100_000, { rate: 100, rateType: 'CDI' }) as never);
    const down = (async () => new Response('erro', { status: 502 })) as unknown as typeof fetch;
    const r = await listBoxes(h.ctx, userId, down);
    expect(r.rates.source).toBe('referencia');
    expect(r.items[0]!.annualRate).toBeCloseTo(Math.pow(1.008, 12) - 1);
  });

  it('liga a caixinha a uma meta: mostra quanto ja tem e quando chega', async () => {
    const box = inv('Caixinha Viagem', 300_000, { rate: 100, rateType: 'CDI' });
    await h.ctx.col.investments.insertOne(box as never);
    const goalId = new ObjectId();
    await h.ctx.col.goals.insertOne({ _id: goalId, userId, name: 'Viagem', icon: 'plane', targetMinor: 600_000, savedMinor: 0, deadline: '2027-12-01', monthlyContributionMinor: 50_000, priority: 3, status: 'ativa', createdAt: now, updatedAt: now } as never);
    const r = await h.app.inject({ method: 'PUT', url: `/v1/investments/boxes/inv:${box._id.toHexString()}/goal`, payload: { goalId: goalId.toHexString() }, headers: await auth() });
    expect(r.statusCode).toBe(200);
    const goal = r.json().items[0].goal;
    expect(goal).toMatchObject({ name: 'Viagem', targetMinor: 600_000, savedMinor: 300_000, monthlyMinor: 50_000 });
    expect(goal.monthsToTarget).toBeGreaterThan(4);
    expect(goal.monthsToTarget).toBeLessThanOrEqual(6);
    // Meta de outro usuario nao pode ser ligada.
    const other = new ObjectId();
    await h.ctx.col.goals.insertOne({ _id: other, userId: new ObjectId(), name: 'X', icon: 'x', targetMinor: 1, savedMinor: 0, deadline: null, monthlyContributionMinor: 0, priority: 3, status: 'ativa', createdAt: now, updatedAt: now } as never);
    expect((await h.app.inject({ method: 'PUT', url: `/v1/investments/boxes/inv:${box._id.toHexString()}/goal`, payload: { goalId: other.toHexString() }, headers: await auth() })).statusCode).toBe(404);
  });
});
