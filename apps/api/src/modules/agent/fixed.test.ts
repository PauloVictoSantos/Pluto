import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';
import { monthOf } from '../../lib/time';

// Gastos fixos (doc. Pluton 3.1): CRUD com auditoria, media do variavel (GF-04), dividas como fixos
// temporarios (GF-06), sugestoes do extrato e isolamento entre usuarios.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId, seq = 0;
const URL = '/v1/agent/fixed-expenses';
const req = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url = URL, payload?: object, who = userId) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(who)}` } });
const now = new Date();
const ago = (m: number, day = 10) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, day, 15));
const tx = (matchKey: string, date: Date, amountMinor: number) => ({
  userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: `f${seq++}`, date, description: matchKey.toUpperCase(), descriptionNorm: matchKey, matchKey,
  merchant: null, amountMinor, currency: 'BRL', type: 'EXPENSE', status: 'POSTED', pluggyCategory: 'Electricity', pluggyCategoryId: null, pluggyBillId: null, categoryKey: 'contas-casa',
  installment: null, categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, hasTime: false,
  counterpartyKey: null, createdAt: date, updatedAt: date,
});
const aluguel = { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 150_000, dueDay: 5, recurrence: 'monthly' };

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
});

describe('gastos fixos', () => {
  it('cria, edita e remove com auditoria; soma o equivalente mensal', async () => {
    let r = await req('POST', URL, aluguel);
    expect(r.statusCode).toBe(200);
    await req('POST', URL, { name: 'IPVA', categoryKey: 'transporte', amountMinor: 120_000, dueDay: 15, dueMonth: 3, recurrence: 'yearly' });
    r = await req('POST', URL, { name: 'Feira', categoryKey: 'mercado', amountMinor: 6_000, dueDay: 7, recurrence: 'weekly', source: 'chat' });
    const body = r.json();
    expect(body.items.map((i: { name: string; monthlyMinor: number; source: string }) => [i.name, i.monthlyMinor, i.source])).toEqual([
      ['Aluguel', 150_000, 'manual'],
      ['IPVA', 10_000, 'manual'],
      ['Feira', 26_000, 'chat'],
    ]);
    expect(body.monthlyTotalMinor).toBe(186_000);
    expect(body.incomeShare).toBeNull();

    await h.app.inject({ method: 'PUT', url: '/v1/agent/profile', payload: { netIncomeMinor: 400_000 }, headers: { authorization: `Bearer ${await h.token(userId)}` } });
    const id = body.items[0].id;
    r = await req('PATCH', `${URL}/${id}`, { amountMinor: 160_000 });
    expect(r.json().items[0]).toMatchObject({ amountMinor: 160_000, recurrence: 'monthly', isVariable: false });
    expect(r.json().incomeShare).toBeCloseTo(196_000 / 400_000, 3);

    r = await req('DELETE', `${URL}/${id}`);
    expect(r.json().items).toHaveLength(2);
    expect((await h.ctx.col.fixedExpenses.findOne({ _id: new ObjectId(id) }))!.deletedAt).toBeInstanceOf(Date);
    const events = (await h.ctx.col.auditLogs.find({ userId, event: /^fixed_expense/ }).toArray()).map((a) => a.event);
    expect(events).toEqual(['fixed_expense.created', 'fixed_expense.created', 'fixed_expense.created', 'fixed_expense.updated', 'fixed_expense.deleted']);
    const upd = await h.ctx.col.auditLogs.findOne({ userId, event: 'fixed_expense.updated' });
    expect(upd!.meta).toMatchObject({ before: { amountMinor: 150_000 }, after: { amountMinor: 160_000 } });
  });

  it('valida campos e vencimento', async () => {
    for (const bad of [
      { ...aluguel, amountMinor: 0 },
      { ...aluguel, name: ' ' },
      { ...aluguel, categoryKey: 'salario' },
      { ...aluguel, dueDay: 32 },
      { ...aluguel, recurrence: 'daily' },
      { ...aluguel, recurrence: 'weekly', dueDay: 9 },
      { ...aluguel, recurrence: 'yearly' },
    ])
      expect((await req('POST', URL, bad)).statusCode).toBe(400);
    const id = (await req('POST', URL, aluguel)).json().items[0].id;
    // Update checa o resultado mesclado: anual sem mes nao passa.
    expect((await req('PATCH', `${URL}/${id}`, { recurrence: 'yearly' })).statusCode).toBe(400);
    expect((await req('PATCH', `${URL}/${id}`, { recurrence: 'yearly', dueMonth: 2 })).json().items[0]).toMatchObject({ recurrence: 'yearly', dueMonth: 2, monthlyMinor: 12_500 });
    expect((await req('PATCH', `${URL}/${id}`, {})).statusCode).toBe(400);
  });

  it('GF-04: valor variavel usa media e desvio dos ultimos 3 meses fechados', async () => {
    await h.ctx.col.transactions.insertMany([
      tx('enel energia', ago(1), -20_000),
      tx('enel energia', ago(2), -24_000),
      tx('enel energia', ago(3), -16_000),
      tx('enel energia', ago(4), -90_000), // fora da janela
      tx('enel energia', ago(0, 1), -99_000), // mes atual nao conta
    ] as never);
    const r = await req('POST', URL, { name: 'Luz', categoryKey: 'contas-casa', amountMinor: 1, isVariable: true, matchKey: 'enel energia', dueDay: 12, recurrence: 'monthly' });
    const luz = r.json().items[0];
    expect(luz.amountMinor).toBe(20_000);
    expect(luz.amountStdMinor).toBeGreaterThan(3_000);
    expect(luz.amountStdMinor).toBeLessThan(4_500);
    // Sem extrato, vale o valor digitado.
    const agua = (await req('POST', URL, { name: 'Água', categoryKey: 'contas-casa', amountMinor: 8_000, isVariable: true, dueDay: 20, recurrence: 'monthly' })).json().items[1];
    expect(agua).toMatchObject({ amountMinor: 8_000, amountStdMinor: null });
  });

  it('GF-06: parcelas de dividas entram como fixos temporarios, so leitura', async () => {
    const tz = 'America/Manaus', month = monthOf(now, tz);
    const sourceId = new ObjectId();
    await h.ctx.col.debtSources.insertOne({ _id: sourceId, userId, name: 'Cartão da tia', method: 'third_party_card', holder: null, bank: null, cardProduct: null, brand: null, last4: null, dueDay: 10, notes: null, createdAt: now, updatedAt: now });
    await h.ctx.col.commitments.insertOne({
      _id: new ObjectId(), userId, sourceId, merchant: 'Casas Bahia', categoryKey: 'compras', approvedAt: `${month}-01`, kind: 'installments', totalMinor: 120_000, installments: 12,
      monthlyMinor: null, firstMonth: month, lastMonth: null, notes: null, active: true, createdAt: now, updatedAt: now,
    });
    const r = (await req('GET')).json();
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: 'Casas Bahia', source: 'divida', amountMinor: 10_000, dueDay: 10, installment: { n: 1, total: 12 } });
    expect(r.items[0].endsOn > month).toBe(true);
    expect(r.monthlyTotalMinor).toBe(10_000);
  });

  it('sugere o que se repete no extrato (>= 3 meses, +-10%, +-3 dias); Remover nao volta', async () => {
    await h.ctx.col.transactions.insertMany([
      // Netflix: 3 meses, valor ate +7%, dias 8-10 -> sugestao.
      { ...tx('netflix com', ago(2, 8), -5_590), categoryKey: 'assinaturas' },
      { ...tx('netflix com', ago(1, 9), -5_590), categoryKey: 'assinaturas' },
      { ...tx('netflix com', ago(0, 10), -5_990), categoryKey: 'assinaturas' },
      // Academia: 3 meses, mas o ultimo 30% mais caro -> nao.
      ...[2, 1, 0].map((m, i) => ({ ...tx('smart fit', ago(m, 5), i === 2 ? -13_000 : -10_000), categoryKey: 'saude' })),
      // Uber: varias vezes por mes -> nao.
      ...[2, 1, 0].flatMap((m) => [{ ...tx('uber trip', ago(m, 3), -2_000), categoryKey: 'transporte' }, { ...tx('uber trip', ago(m, 18), -2_000), categoryKey: 'transporte' }]),
      // So 2 meses -> nao.
      ...[1, 0].map((m) => ({ ...tx('spotify', ago(m, 12), -2_190), categoryKey: 'assinaturas' })),
    ] as never);
    let r = (await req('GET')).json();
    expect(r.suggestions.map((s: { name: string }) => s.name)).toEqual(['NETFLIX COM']);
    expect(r.suggestions[0]).toMatchObject({ amountMinor: 5_723, recurrence: 'monthly', dueDay: 9, months: 3, matchKey: 'netflix com' });

    // Remover: some e nao volta, nem depois de uma nova cobranca.
    r = (await req('POST', `${URL}/suggestions/dismiss`, { matchKey: 'netflix com' })).json();
    expect(r.suggestions).toEqual([]);
    await h.ctx.col.transactions.insertOne({ ...tx('netflix com', now, -5_590), categoryKey: 'assinaturas' } as never);
    expect((await req('GET')).json().suggestions).toEqual([]);
  });

  it('sugestao adicionada vira gasto fixo e sai da lista', async () => {
    await h.ctx.col.transactions.insertMany([2, 1, 0].map((m) => ({ ...tx('vivo fibra', ago(m, 15), -9_990), categoryKey: 'contas-casa' })) as never);
    const s = (await req('GET')).json().suggestions[0];
    expect(s).toMatchObject({ name: 'VIVO FIBRA', dueDay: 15 });
    await req('POST', URL, { name: 'Internet', categoryKey: s.categoryKey, amountMinor: s.amountMinor, dueDay: s.dueDay, recurrence: 'monthly', matchKey: s.matchKey });
    expect((await req('GET')).json().suggestions).toEqual([]);
  });

  it('um usuario nao ve nem altera fixos de outro', async () => {
    const id = (await req('POST', URL, aluguel)).json().items[0].id;
    const other = (await h.createUser({ email: 'outro@pluto.test' })).id;
    expect((await req('GET', URL, undefined, other)).json().items).toEqual([]);
    expect((await req('PATCH', `${URL}/${id}`, { amountMinor: 1 }, other)).statusCode).toBe(404);
    expect((await req('DELETE', `${URL}/${id}`, undefined, other)).statusCode).toBe(404);
    expect((await req('GET')).json().items[0].amountMinor).toBe(150_000);
  });
});
