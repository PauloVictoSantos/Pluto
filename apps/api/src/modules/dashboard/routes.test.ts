import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../db/migrations';
import { addMonth, monthOf } from '../../lib/time';
import { startHarness, type Harness } from '../../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

const TZ = 'America/Manaus';
let alice: ObjectId;
const bob = new ObjectId();
const get = async (url: string, u = alice) => (await h.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await h.token(u)}` } })).json();

async function seed() {
  alice = (await h.createUser()).id;
  const now = new Date();
  const conn = new ObjectId(), checking = new ObjectId(), savings = new ObjectId(), card = new ObjectId();
  await h.ctx.col.connections.insertOne({
    _id: conn, userId: alice, pluggyItemIdEnc: 'v1.x', pluggyItemIdHash: 'h', source: 'MEU_PLUGGY', connectorId: 200, institutionName: 'Banco Bradesco',
    imageUrl: null, primaryColor: '#CC092F', status: 'UPDATED', needsAction: false, active: true, consentExpiresAt: null, lastSyncAt: now,
    lastTransactionsSyncAt: now, lastError: null, syncingUntil: null, removedAt: null, createdAt: now, updatedAt: now,
  } as never);
  const acc = (_id: ObjectId, type: string, balanceMinor: number, extra = {}) => ({
    _id, userId: alice, connectionId: conn, pluggyAccountId: String(_id), type, name: type === 'CREDIT_CARD' ? 'NEO VISA' : 'Bradesco', numberMasked: '1234',
    balanceMinor, currency: 'BRL', creditLimitMinor: null, availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null,
    createdAt: now, updatedAt: now, ...extra,
  });
  await h.ctx.col.accounts.insertMany([
    acc(checking, 'CHECKING', 100_000),
    acc(savings, 'SAVINGS', 50_000),
    acc(card, 'CREDIT_CARD', 30_000, { creditLimitMinor: 500_000, availableCreditMinor: 470_000, dueDay: 10, closingDay: 3, brand: 'VISA' }),
  ] as never);

  // Meio do mes atual e do anterior no fuso do usuario.
  const cur = monthOf(now, TZ), prev = addMonth(cur, -1);
  const at = (month: string, day: number) => new Date(`${month}-${String(day).padStart(2, '0')}T16:00:00Z`);
  const tx = (date: Date, amountMinor: number, type: string, categoryKey: string, accountId = checking) => ({
    userId: alice, accountId, connectionId: conn, pluggyTransactionId: String(new ObjectId()), date, description: 'x', descriptionNorm: 'x', merchant: null,
    amountMinor, currency: 'BRL', type, status: 'POSTED', pluggyCategory: null, pluggyCategoryId: null, pluggyBillId: null, categoryKey, installment: null,
    categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, createdAt: now, updatedAt: now,
  });
  await h.ctx.col.transactions.insertMany([
    tx(at(cur, 2), 500_000, 'INCOME', 'salario'),
    tx(at(cur, 3), -12_000, 'EXPENSE', 'mercado', card),
    tx(at(cur, 3), -3_000, 'EXPENSE', 'mercado', card),
    tx(at(cur, 4), -8_000, 'EXPENSE', 'delivery', card),
    tx(at(cur, 5), -30_000, 'CARD_PAYMENT', 'fatura'),
    tx(at(cur, 5), -20_000, 'TRANSFER', 'entre-contas'),
    tx(at(cur, 6), -10_000, 'INVESTMENT', 'investimentos'),
    tx(at(prev, 10), 400_000, 'INCOME', 'salario'),
    tx(at(prev, 11), -50_000, 'EXPENSE', 'moradia'),
  ] as never);
  await h.ctx.col.invoices.insertMany([
    { userId: alice, accountId: card, pluggyBillId: 'b1', closingDate: null, dueDate: new Date(Date.now() - 60 * 86_400_000), totalMinor: 1, paidMinor: 0, status: 'CLOSED', createdAt: now, updatedAt: now },
    { userId: alice, accountId: card, pluggyBillId: 'b2', closingDate: null, dueDate: new Date(Date.now() - 20 * 86_400_000), totalMinor: 25_000, paidMinor: 0, status: 'OVERDUE', createdAt: now, updatedAt: now },
  ] as never);
  return { cur, prev };
}

describe('dashboard', () => {
  it('resumo: saldo de corrente+poupanca, mes atual x anterior, 6 meses', async () => {
    const { cur, prev } = await seed();
    const s = await get('/v1/dashboard/summary');
    expect(s.balanceMinor).toBe(150_000);
    expect(s.banks).toEqual([expect.objectContaining({ institutionName: 'Banco Bradesco', balanceMinor: 150_000 })]);
    // Fatura e transferencia propria nao entram (RN-13/14).
    expect(s.current).toEqual({ month: cur, incomeMinor: 500_000, expensesMinor: 23_000, investedMinor: 10_000 });
    expect(s.previous).toEqual({ month: prev, incomeMinor: 400_000, expensesMinor: 50_000, investedMinor: 0 });
    expect(s.monthly).toHaveLength(6);
    expect(s.monthly[5].month).toBe(cur);
    expect(s.monthly[0].incomeMinor).toBe(0);
  });

  it('gastos por categoria do mes', async () => {
    const { prev } = await seed();
    expect(await get('/v1/dashboard/spending')).toMatchObject({
      totalMinor: 23_000,
      categories: [
        { key: 'mercado', spentMinor: 15_000, count: 2 },
        { key: 'delivery', spentMinor: 8_000, count: 1 },
      ],
    });
    expect((await get(`/v1/dashboard/spending?month=${prev}`)).categories).toEqual([{ key: 'moradia', spentMinor: 50_000, count: 1 }]);
  });

  it('cartoes com fatura atual e ultima fatura fechada', async () => {
    await seed();
    const [c] = await get('/v1/cards');
    expect(c).toMatchObject({ name: 'NEO VISA', brand: 'VISA', currentBillMinor: 30_000, usedMinor: 30_000, dueDay: 10, invoice: { totalMinor: 25_000, status: 'OVERDUE' } });
    expect(await get('/v1/invoices')).toHaveLength(2);
  });

  it('isolamento: outro usuario ve tudo vazio', async () => {
    await seed();
    expect((await get('/v1/dashboard/summary', bob)).balanceMinor).toBe(0);
    expect(await get('/v1/cards', bob)).toEqual([]);
    expect((await get('/v1/dashboard/spending', bob)).categories).toEqual([]);
  });
});

describe('orcamentos e metas', () => {
  it('orcamento do mes: substitui, ignora zero e e por usuario', async () => {
    await seed();
    const put = (body: object, u = alice) =>
      h.token(u).then((t) => h.app.inject({ method: 'PUT', url: '/v1/budgets', headers: { authorization: `Bearer ${t}` }, payload: body }));
    await put({ month: '2026-11', items: [{ categoryKey: 'mercado', limitMinor: 150_000 }, { categoryKey: 'lazer', limitMinor: 0 }] });
    await put({ month: '2026-11', items: [{ categoryKey: 'mercado', limitMinor: 160_000 }, { categoryKey: 'delivery', limitMinor: 50_000 }] });
    expect((await get('/v1/budgets?month=2026-11')).items).toEqual([
      { categoryKey: 'delivery', limitMinor: 50_000 },
      { categoryKey: 'mercado', limitMinor: 160_000 },
    ]);
    expect((await get('/v1/budgets?month=2026-11', bob)).items).toEqual([]);
  });

  it('metas: criar, guardar dinheiro, editar e excluir; isolamento', async () => {
    await seed();
    const auth = async (u = alice) => ({ authorization: `Bearer ${await h.token(u)}` });
    const created = (await h.app.inject({ method: 'POST', url: '/v1/goals', headers: await auth(), payload: { name: 'Viagem', targetMinor: 1_000_000, deadline: '2027-06-30' } })).json();
    expect(created).toMatchObject({ name: 'Viagem', savedMinor: 0, icon: 'target' });
    const add = await h.app.inject({ method: 'PATCH', url: `/v1/goals/${created.id}`, headers: await auth(), payload: { addMinor: 25_000 } });
    expect(add.json().savedMinor).toBe(25_000);
    expect((await h.app.inject({ method: 'PATCH', url: `/v1/goals/${created.id}`, headers: await auth(bob), payload: { addMinor: 1 } })).statusCode).toBe(404);
    expect(await get('/v1/goals', bob)).toEqual([]);
    expect((await h.app.inject({ method: 'DELETE', url: `/v1/goals/${created.id}`, headers: await auth() })).statusCode).toBe(204);
    expect(await get('/v1/goals')).toEqual([]);
  });
});

describe('migracoes', () => {
  it('preenche categoryKey, reclassifica faturas antigas e remove indice antigo', async () => {
    const userId = new ObjectId(), now = new Date();
    await h.db.collection('transactions').insertMany([
      { userId, connectionId: userId, pluggyTransactionId: 'm0', type: 'EXPENSE', pluggyCategory: 'Groceries', amountMinor: -100, deletedAt: null },
      { userId, connectionId: userId, pluggyTransactionId: 'm1', type: 'CARD_PAYMENT', pluggyCategory: 'Transfer - PIX', amountMinor: -100, deletedAt: null },
      { userId, connectionId: userId, pluggyTransactionId: 'm2', type: 'INCOME', pluggyCategory: 'Transfer - PIX', amountMinor: 100, deletedAt: null },
    ], { bypassDocumentValidation: true });
    await h.db.collection('invoices').insertOne(
      { userId, accountId: new ObjectId(), pluggyBillId: 'old', dueDate: new Date(Date.now() - 90 * 86_400_000), totalMinor: 1, paidMinor: 0, status: 'OVERDUE', createdAt: now, updatedAt: now },
      { bypassDocumentValidation: true },
    );
    await h.db.collection('budgets').createIndex({ userId: 1, month: 1, categoryId: 1 }, { unique: true });

    await runMigrations(h.db);
    const keys = (await h.db.collection('transactions').find({ userId }).sort({ amountMinor: 1, type: 1 }).toArray()).map((t) => [t.type, t.categoryKey]);
    expect(keys).toEqual([
      ['CARD_PAYMENT', 'fatura'],
      ['EXPENSE', 'mercado'],
      ['INCOME', 'entradas'],
    ]);
    expect((await h.db.collection('invoices').findOne({ pluggyBillId: 'old' }))!.status).toBe('CLOSED');
    expect((await h.db.collection('budgets').indexes()).some((i) => i.name === 'userId_1_month_1_categoryId_1')).toBe(false);
    // Regra mudou: categoria derivada e recalculada; categoria manual do usuario fica (RN-12).
    await h.db.collection('transactions').updateOne({ pluggyTransactionId: 'm0' }, { $set: { categoryKey: 'taxas' } }, { bypassDocumentValidation: true });
    await h.db.collection('transactions').insertOne(
      { userId, connectionId: userId, pluggyTransactionId: 'manual', type: 'EXPENSE', pluggyCategory: 'Groceries', amountMinor: -5, categoryKey: 'lazer', categorySource: 'MANUAL' },
      { bypassDocumentValidation: true },
    );
    await runMigrations(h.db);
    expect((await h.db.collection('transactions').findOne({ pluggyTransactionId: 'm0' }))!.categoryKey).toBe('mercado');
    expect((await h.db.collection('transactions').findOne({ pluggyTransactionId: 'manual' }))!.categoryKey).toBe('lazer');
  });
});
