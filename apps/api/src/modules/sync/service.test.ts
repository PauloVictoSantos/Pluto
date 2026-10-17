import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ITEM_ID, fakeAccount, fakeBill, fakeCard, fakeInvestment, fakeItem, fakeTx } from '../../integrations/pluggy/fixtures';
import { startHarness, type Harness } from '../../test/harness';
import { syncConnection } from './service';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

const userId = new ObjectId();
const deps = (now = new Date('2026-10-16T12:00:00Z')) => ({ col: h.ctx.col, pluggy: h.pluggy, crypto: h.ctx.crypto, now: () => now });

async function seedConnection(over: Record<string, unknown> = {}) {
  const now = new Date();
  const { insertedId } = await h.ctx.col.connections.insertOne({
    userId,
    pluggyItemIdEnc: h.ctx.crypto.encrypt(ITEM_ID),
    pluggyItemIdHash: h.ctx.crypto.hash(ITEM_ID),
    source: 'WIDGET',
    connectorId: 212,
    institutionName: 'Nubank',
    imageUrl: null,
    primaryColor: null,
    status: 'UPDATED',
    needsAction: false,
    active: true,
    consentExpiresAt: null,
    lastSyncAt: null,
    lastTransactionsSyncAt: null,
    lastError: null,
    syncingUntil: null,
    removedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as never);
  return insertedId;
}

function seedPluggy() {
  h.pluggy.items.set(ITEM_ID, fakeItem());
  h.pluggy.accounts.set(ITEM_ID, [fakeAccount(), fakeCard()]);
  h.pluggy.transactions.set('acc-checking', [
    fakeTx({ id: 't1' }),
    fakeTx({ id: 't2', description: 'SALARIO ACME', type: 'CREDIT', amount: 12500, date: new Date('2026-10-05T10:00:00Z') }),
  ]);
  h.pluggy.transactions.set('acc-card', [
    fakeTx({ id: 'c1', accountId: 'acc-card', description: 'IFOOD', amount: 68.9, creditCardMetadata: { billId: 'bill-1' } }),
  ]);
  h.pluggy.bills.set('acc-card', [fakeBill()]);
  h.pluggy.investments.set(ITEM_ID, [fakeInvestment()]);
}

describe('syncConnection', () => {
  it('importa contas, transacoes, faturas e investimentos', async () => {
    seedPluggy();
    const id = await seedConnection();
    const r = await syncConnection(deps(), id);
    expect(r).toMatchObject({ status: 'SYNCED', accounts: 2, transactions: 3, investments: 1, errors: [] });

    const txs = await h.ctx.col.transactions.find({}).sort({ pluggyTransactionId: 1 }).toArray();
    expect(txs.map((t) => [t.pluggyTransactionId, t.amountMinor, t.type])).toEqual([
      ['c1', -6890, 'EXPENSE'],
      ['t1', -18734, 'EXPENSE'],
      ['t2', 1250000, 'INCOME'],
    ]);
    const invoice = await h.ctx.col.invoices.findOne({});
    expect(invoice).toMatchObject({ totalMinor: 234010, status: 'OPEN' });
    expect(txs[0]!.invoiceId).toEqual(invoice!._id);
    expect(await h.ctx.col.investmentSnapshots.countDocuments({ month: '2026-10' })).toBe(1);

    const conn = await h.ctx.col.connections.findOne({ _id: id });
    expect(conn).toMatchObject({ syncingUntil: null, lastError: null, primaryColor: '#820AD1' });
    expect(conn!.lastSyncAt).toBeInstanceOf(Date);
  });

  it('reimportar nunca duplica (RN-01) e preserva edicoes do usuario (RN-12)', async () => {
    seedPluggy();
    const id = await seedConnection();
    await syncConnection(deps(), id);
    const catId = new ObjectId();
    await h.ctx.col.transactions.updateOne({ pluggyTransactionId: 't1' }, { $set: { categoryId: catId, categorySource: 'MANUAL', notes: 'feira' } });

    await syncConnection(deps(), id);
    expect(await h.ctx.col.transactions.countDocuments({})).toBe(3);
    expect(await h.ctx.col.transactions.findOne({ pluggyTransactionId: 't1' })).toMatchObject({ categoryId: catId, categorySource: 'MANUAL', notes: 'feira' });
  });

  it('PENDING vira POSTED com valor final (RN-02) e pendente sumida e descartada', async () => {
    seedPluggy();
    h.pluggy.transactions.set('acc-checking', [fakeTx({ id: 'p1', status: 'PENDING' as never, amount: -10 }), fakeTx({ id: 'p2', status: 'PENDING' as never })]);
    const id = await seedConnection();
    await syncConnection(deps(), id);

    h.pluggy.transactions.set('acc-checking', [fakeTx({ id: 'p1', status: 'POSTED' as never, amount: -12.5 })]);
    await syncConnection(deps(new Date('2026-10-17T12:00:00Z')), id);
    expect(await h.ctx.col.transactions.findOne({ pluggyTransactionId: 'p1' })).toMatchObject({ status: 'POSTED', amountMinor: -1250, deletedAt: null });
    expect((await h.ctx.col.transactions.findOne({ pluggyTransactionId: 'p2' }))!.deletedAt).toBeInstanceOf(Date);
  });

  it('sincronizacao incremental usa janela de 30 dias', async () => {
    seedPluggy();
    const id = await seedConnection({ lastTransactionsSyncAt: new Date('2026-10-10T00:00:00Z') });
    await syncConnection(deps(), id);
    expect(h.pluggy.calls).toContain('tx:acc-checking:2026-09-10');
  });

  it('falha em uma conta nao aborta as demais (RN-05)', async () => {
    seedPluggy();
    h.pluggy.failAccounts.add('acc-checking');
    const id = await seedConnection();
    const r = await syncConnection(deps(), id);
    expect(r.errors).toHaveLength(1);
    expect(await h.ctx.col.transactions.countDocuments({ pluggyTransactionId: 'c1' })).toBe(1);
    expect(await h.ctx.col.accounts.findOne({ pluggyAccountId: 'acc-checking' })).toMatchObject({ syncError: 'Falha ao sincronizar esta conta' });
    const conn = await h.ctx.col.connections.findOne({ _id: id });
    expect(conn).toMatchObject({ lastError: 'Sincronização parcial', lastTransactionsSyncAt: null });
  });

  it('item que exige acao do usuario nao e importado (RN-03)', async () => {
    seedPluggy();
    h.pluggy.items.set(ITEM_ID, fakeItem({ status: 'LOGIN_ERROR' }));
    const id = await seedConnection();
    expect((await syncConnection(deps(), id)).status).toBe('NEEDS_ACTION');
    expect(await h.ctx.col.transactions.countDocuments({})).toBe(0);
    expect(await h.ctx.col.connections.findOne({ _id: id })).toMatchObject({ needsAction: true, status: 'LOGIN_ERROR' });
  });

  it('consentimento vencido desativa a conexao e mantem o historico (RN-04)', async () => {
    seedPluggy();
    const id = await seedConnection();
    await syncConnection(deps(), id);
    h.pluggy.items.set(ITEM_ID, fakeItem({ consentExpiresAt: new Date('2026-10-01T00:00:00Z') }));
    expect((await syncConnection(deps(), id)).status).toBe('INACTIVE');
    expect(await h.ctx.col.connections.findOne({ _id: id })).toMatchObject({ active: false });
    expect(await h.ctx.col.transactions.countDocuments({})).toBe(3);
  });

  it('nao roda duas vezes ao mesmo tempo', async () => {
    seedPluggy();
    const id = await seedConnection({ syncingUntil: new Date('2026-10-16T12:05:00Z') });
    expect((await syncConnection(deps(), id)).status).toBe('SKIPPED');
  });
});
