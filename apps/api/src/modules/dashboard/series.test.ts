import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';

// Series dos sparklines da Visao geral (30 dias, dados reais).

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

describe('series dos sparklines', () => {
  it('receitas, despesas, saldo acumulado e saldo do banco voltando no tempo', async () => {
    const userId = (await h.createUser()).id, conn = new ObjectId(), acc = new ObjectId(), now = new Date();
    await h.ctx.col.connections.insertOne({
      _id: conn, userId, pluggyItemIdEnc: h.ctx.crypto.encrypt('item'), pluggyItemIdHash: 'h-series', source: 'WIDGET', connectorId: 1, institutionName: 'Inter',
      imageUrl: null, primaryColor: null, status: 'UPDATED', needsAction: false, active: true, consentExpiresAt: null, lastSyncAt: null, lastTransactionsSyncAt: null,
      lastError: null, syncingUntil: null, removedAt: null, createdAt: now, updatedAt: now,
    } as never);
    await h.ctx.col.accounts.insertOne({
      _id: acc, userId, connectionId: conn, pluggyAccountId: 'a', type: 'CHECKING', name: 'Conta', numberMasked: null, balanceMinor: 10_000, currency: 'BRL',
      creditLimitMinor: null, availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: now, updatedAt: now,
    } as never);
    const tx = (daysAgo: number, amountMinor: number, type: string) => ({
      userId, accountId: acc, connectionId: conn, pluggyTransactionId: `s${daysAgo}${type}`, date: new Date(now.getTime() - daysAgo * 86_400_000), description: 'X',
      descriptionNorm: 'x', matchKey: 'x', merchant: null, amountMinor, currency: 'BRL', type, status: 'POSTED', pluggyCategory: null, pluggyCategoryId: null,
      pluggyBillId: null, categoryKey: 'outros', installment: null, categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [],
      notes: null, hidden: false, deletedAt: null, createdAt: now, updatedAt: now,
    });
    await h.ctx.col.transactions.insertMany([tx(0, 5000, 'INCOME'), tx(1, -2000, 'EXPENSE')] as never);
    const r = await h.app.inject({ method: 'GET', url: '/v1/dashboard/series', headers: { authorization: `Bearer ${await h.token(userId)}` } });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.days).toHaveLength(30);
    expect(s.incomeMinor.at(-1)).toBe(5000);
    expect(s.expensesMinor.at(-2)).toBe(2000);
    expect(s.netMinor.at(-1)).toBe(3000);
    expect(s.banks[0].balanceMinor.slice(-3)).toEqual([7000, 5000, 10_000]);
  });
});
