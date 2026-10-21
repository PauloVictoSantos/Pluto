import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';

// Saude financeira com dados reais: faturas pagas x vencidas e uso do limite.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

describe('saude financeira', () => {
  it('nota, faixa e indicadores a partir das faturas e do limite', async () => {
    const userId = (await h.createUser()).id, card = new ObjectId(), now = new Date();
    await h.ctx.col.accounts.insertOne({
      _id: card, userId, connectionId: new ObjectId(), pluggyAccountId: 'k', type: 'CREDIT_CARD', name: 'Inter Gold', numberMasked: '1234', balanceMinor: 100_000,
      currency: 'BRL', creditLimitMinor: 1_000_000, availableCreditMinor: 900_000, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: now, updatedAt: now,
    } as never);
    const inv = (daysAgo: number, status: string, id: string) => ({
      userId, accountId: card, pluggyBillId: id, closingDate: null, dueDate: new Date(now.getTime() - daysAgo * 86_400_000), totalMinor: 100_000, paidMinor: status === 'PAID' ? 100_000 : 0,
      status, createdAt: now, updatedAt: now,
    });
    await h.ctx.col.invoices.insertMany([inv(20, 'PAID', 'a'), inv(5, 'OVERDUE', 'b')] as never);
    const r = await h.app.inject({ method: 'GET', url: '/v1/analytics/health?period=month', headers: { authorization: `Bearer ${await h.token(userId)}` } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b).toMatchObject({ score: 726, band: { label: 'Muito bom' }, onTime: { pct: 0.5, paid: 1, due: 2 }, negatives: { overdue: 1 } });
    expect(b.limitUse.pct).toBeCloseTo(0.1);
  });
});
