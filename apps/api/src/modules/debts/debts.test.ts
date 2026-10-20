import { installmentAmount, scheduleIn } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMonth, monthOf } from '../../lib/time';
import { startHarness, type Harness } from '../../test/harness';

// Divida manual: compra parcelada e mensalidade no cartao de um parente, pagas a ele por boleto.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

// As rotas usam o relogio real: o cenario e montado em torno do mes atual.
const month = monthOf(new Date(), 'America/Manaus');
let userId: ObjectId;
const req = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });

describe('parcelas', () => {
  it('divide o total em centavos sem perder nada', () => {
    expect(installmentAmount(577_536, 12, 1)).toBe(48_128);
    expect(Array.from({ length: 3 }, (_, i) => installmentAmount(1000, 3, i + 1))).toEqual([334, 333, 333]);
    const c = { kind: 'installments' as const, firstMonth: '2026-08', installments: 12, totalMinor: 577_536, monthlyMinor: null, lastMonth: null };
    expect(scheduleIn(c, '2026-10')).toEqual({ n: 3, total: 12, amountMinor: 48_128 });
    expect(scheduleIn(c, '2027-08')).toBeNull();
    expect(scheduleIn(c, '2026-07')).toBeNull();
  });
});

describe('cartao da tia', () => {
  async function seed() {
    userId = (await h.createUser()).id;
    let r = await req('POST', '/v1/debts/sources', {
      name: 'Cartão da Melry', method: 'third_party_card', holder: 'Melry', bank: 'Itaú', cardProduct: 'Azul Platinum', brand: 'Visa', last4: '5586', dueDay: 10,
    });
    expect(r.statusCode).toBe(200);
    const sourceId = r.json()[0].id;
    r = await req('POST', '/v1/debts/commitments', {
      sourceId, merchant: 'Casas Bahia', categoryKey: 'compras', approvedAt: `${addMonth(month, -3)}-15`, kind: 'installments', totalMinor: 577_536, installments: 12,
      firstMonth: addMonth(month, -2), notes: 'Geladeira',
    });
    expect(r.statusCode).toBe(200);
    r = await req('POST', '/v1/debts/commitments', {
      sourceId, merchant: 'Faculdade', categoryKey: 'educacao', approvedAt: `${addMonth(month, -8)}-01`, kind: 'monthly', monthlyMinor: 66_000, firstMonth: addMonth(month, -8),
    });
    return { sourceId, list: r.json() };
  }

  it('mostra a parcela do mes, o que falta e gera o boleto do mes com a soma', async () => {
    const { list } = await seed();
    expect(list[0]).toMatchObject({ name: 'Cartão da Melry', last4: '5586', monthTotalMinor: 114_128 });
    const casas = list[0].items.find((i: { merchant: string }) => i.merchant === 'Casas Bahia');
    expect(casas.current).toEqual({ n: 3, total: 12, amountMinor: 48_128 });
    expect(casas.remainingMinor).toBe(48_128 * 10);

    const bills = (await req('GET', '/v1/bills')).json();
    const now = bills.find((b: { dueDate: string }) => b.dueDate === `${month}-10`);
    expect(now).toMatchObject({ payee: 'Cartão da Melry', amountMinor: 114_128 });
    expect(now.items.map((i: { label: string }) => i.label)).toEqual(['Casas Bahia · parcela 3/12', 'Faculdade · mensalidade']);
    // O proximo mes ja aparece (parcela 4/12).
    expect(bills.find((b: { dueDate: string }) => b.dueDate === `${addMonth(month, 1)}-10`).items[0].label).toBe('Casas Bahia · parcela 4/12');
    // Boleto gerado pela divida nao se apaga por fora.
    expect((await req('DELETE', `/v1/bills/${now.id}`)).statusCode).toBe(404);
  });

  it('pagamento conciliado e dividido por compra e pode ser desfeito', async () => {
    await seed();
    const { insertedId } = await h.ctx.col.transactions.insertOne({
      userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: 'boleto-tia', date: new Date(`${month}-09T15:00:00Z`),
      description: 'PAGAMENTO DE BOLETO ITAU', descriptionNorm: 'pagamento de boleto itau', matchKey: 'pagamento de boleto itau', merchant: null, amountMinor: -114_128,
      currency: 'BRL', type: 'EXPENSE', status: 'POSTED', pluggyCategory: 'Bank slip', pluggyCategoryId: null, pluggyBillId: null, categoryKey: 'outros', installment: null,
      categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, hasTime: true,
      counterpartyKey: null, createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const bill = (await req('GET', '/v1/bills')).json().find((b: { dueDate: string }) => b.dueDate === `${month}-10`);
    expect(bill.match.transactionId).toBe(insertedId.toHexString());

    const paid = await req('PATCH', `/v1/bills/${bill.id}`, { status: 'paid', transactionId: insertedId.toHexString() });
    expect(paid.json()).toMatchObject({ status: 'paid' });
    const parts = await h.ctx.col.transactions.find({ splitOf: insertedId }).sort({ amountMinor: 1 }).toArray();
    expect(parts.map((p) => [p.categoryKey, p.amountMinor, p.type])).toEqual([
      ['educacao', -66_000, 'EXPENSE'],
      ['compras', -48_128, 'EXPENSE'],
    ]);
    expect(await h.ctx.col.transactions.findOne({ _id: insertedId })).toMatchObject({ categoryKey: 'pago-dividido', type: 'TRANSFER' });
    // O total do mes conta o gasto uma vez so (nas partes).
    const sum = (await req('GET', `/v1/transactions/summary?from=${month}-01T00:00:00Z`)).json();
    expect(sum.expensesMinor).toBe(114_128);

    // Compra com pagamento registrado nao se apaga, so se encerra.
    const casas = (await req('GET', '/v1/debts')).json()[0].items.find((i: { merchant: string }) => i.merchant === 'Casas Bahia');
    expect((await req('DELETE', `/v1/debts/commitments/${casas.id}`)).statusCode).toBe(409);

    await req('PATCH', `/v1/bills/${bill.id}`, { status: 'pending' });
    expect(await h.ctx.col.transactions.countDocuments({ splitOf: insertedId })).toBe(0);
    expect(await h.ctx.col.transactions.findOne({ _id: insertedId })).toMatchObject({ type: 'EXPENSE', categorySource: null });
  });

  it('encerrar uma compra tira dos proximos boletos', async () => {
    await seed();
    const list = (await req('GET', '/v1/debts')).json();
    const fac = list[0].items.find((i: { merchant: string }) => i.merchant === 'Faculdade');
    const after = (await req('PATCH', `/v1/debts/commitments/${fac.id}`, { active: false })).json();
    expect(after[0].monthTotalMinor).toBe(48_128);
    expect((await req('POST', '/v1/debts/sources', { name: 'X', method: 'third_party_card', last4: '123', dueDay: 5 })).statusCode).toBe(400);
  });
});
