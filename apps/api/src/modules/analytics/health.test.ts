import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMonth, monthOf } from '../../lib/time';
import { startHarness, type Harness } from '../../test/harness';

// Saude financeira 0-100 (doc. Pluton 5.2) com dados reais: indicadores, contencao abaixo de 40,
// nota do mes anterior e sinais extras (faturas pagas e uso do limite).

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId, seq = 0;
const now = new Date();
const month = monthOf(now, 'America/Manaus');
const auth = async () => ({ authorization: `Bearer ${await h.token(userId)}` });
const health = async () => (await h.app.inject({ method: 'GET', url: '/v1/analytics/health', headers: await auth() })).json();
const put = async (url: string, payload: object, method: 'PUT' | 'POST' = 'POST') => h.app.inject({ method, url, payload, headers: await auth() });
const ago = (m: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 12, 15));
const tx = (date: Date, amountMinor: number, categoryKey: string) => ({
  userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: `h${seq++}`, date, description: 'X', descriptionNorm: 'x', matchKey: `k${seq}`, merchant: null,
  amountMinor, currency: 'BRL', type: amountMinor > 0 ? 'INCOME' : 'EXPENSE', status: 'POSTED', pluggyCategory: null, pluggyCategoryId: null, pluggyBillId: null, categoryKey,
  installment: null, categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, hasTime: false,
  counterpartyKey: null, createdAt: date, updatedAt: date,
});
const ind = (b: { indicators: { key: string }[] }, key: string) => b.indicators.find((i) => i.key === key) as Record<string, unknown>;

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
});

describe('saude financeira 0-100', () => {
  it('sem renda: sem nota e sem contencao', async () => {
    const b = await health();
    expect(b).toMatchObject({ score: null, band: null, containment: false, incomeKnown: false });
    expect(b.indicators).toHaveLength(5);
  });

  it('plano saudavel: nota alta e indicadores dentro da faixa do doc', async () => {
    await put('/v1/agent/profile', { netIncomeMinor: 1_000_000 }, 'PUT');
    await put('/v1/agent/fixed-expenses', { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 300_000, dueDay: 5, recurrence: 'monthly' });
    const g = await put('/v1/goals', { name: 'Reserva de emergência', icon: 'shield', targetMinor: 3_000_000, deadline: `${+month.slice(0, 4) + 2}-12-31`, priority: 1 });
    await h.app.inject({ method: 'PATCH', url: `/v1/goals/${g.json().id}`, payload: { addMinor: 2_000_000 }, headers: await auth() });
    await h.ctx.col.transactions.insertMany([
      ...[1, 2, 3].map((m) => tx(ago(m), -200_000, 'investimentos')),
      ...[1, 2, 3].map((m) => tx(ago(m), -250_000, 'mercado')),
    ] as never);
    const b = await health();
    expect(ind(b, 'commitment')).toMatchObject({ value: 0.3, healthy: true, points: 100 });
    expect(ind(b, 'debt')).toMatchObject({ value: 0, healthy: true });
    expect(ind(b, 'reserve')).toMatchObject({ healthy: true, desc: expect.stringMatching(/^R\$\s20\.000,00 na meta de reserva$/) });
    expect((ind(b, 'reserve').value as number) > 6).toBe(true);
    expect(ind(b, 'savingsRate')).toMatchObject({ value: 0.2, healthy: true });
    expect(ind(b, 'capacity')).toMatchObject({ value: 450_000, healthy: true });
    expect(b.score).toBeGreaterThanOrEqual(90);
    expect(b).toMatchObject({ containment: false, band: { key: 'excellent' } });
  });

  it('plano apertado: contencao abaixo de 40', async () => {
    await put('/v1/agent/profile', { netIncomeMinor: 300_000 }, 'PUT');
    await put('/v1/agent/fixed-expenses', { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 150_000, dueDay: 5, recurrence: 'monthly' });
    await put('/v1/agent/loans', { creditor: 'Financeira', kind: 'emprestimo', balanceMinor: 800_000, monthlyRate: 0.06, installmentMinor: 70_000, installmentsLeft: 24, dueDay: 10 });
    await h.ctx.col.transactions.insertMany([1, 2, 3].map((m) => tx(ago(m), -120_000, 'delivery')) as never);
    const b = await health();
    expect(ind(b, 'commitment')).toMatchObject({ healthy: false });
    expect(ind(b, 'reserve')).toMatchObject({ value: 0, healthy: false, desc: 'Nenhuma reserva encontrada' });
    expect(ind(b, 'capacity').value).toBe(300_000 - 220_000 - 120_000);
    expect(b.score).toBeLessThan(40);
    expect(b).toMatchObject({ containment: true, band: { key: 'containment', label: 'Contenção' } });
  });

  it('guarda a nota do mes e compara com a do mes anterior; sinais extras', async () => {
    await put('/v1/agent/profile', { netIncomeMinor: 500_000 }, 'PUT');
    await h.ctx.col.healthSnapshots.insertOne({ _id: new ObjectId(), userId, month: addMonth(month, -1), score: 30, at: now });
    const card = new ObjectId();
    await h.ctx.col.accounts.insertOne({
      _id: card, userId, connectionId: new ObjectId(), pluggyAccountId: 'k', type: 'CREDIT_CARD', name: 'Inter', numberMasked: '1234', balanceMinor: 100_000,
      currency: 'BRL', creditLimitMinor: 1_000_000, availableCreditMinor: 900_000, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: now, updatedAt: now,
    } as never);
    const inv = (daysAgo: number, status: string, id: string) => ({
      userId, accountId: card, pluggyBillId: id, closingDate: null, dueDate: new Date(now.getTime() - daysAgo * 86_400_000), totalMinor: 100_000, paidMinor: 0, status, createdAt: now, updatedAt: now,
    });
    await h.ctx.col.invoices.insertMany([inv(20, 'PAID', 'a'), inv(5, 'OVERDUE', 'b')] as never);
    const b = await health();
    expect(b.prevScore).toBe(30);
    expect(b.onTime).toEqual({ pct: 0.5, paid: 1, due: 2 });
    expect(b.limitUse.pct).toBeCloseTo(0.1);
    expect((await h.ctx.col.healthSnapshots.findOne({ userId, month }))!.score).toBe(b.score);
  });
});
