import { priceInstallment } from '@pluto/finance-engine';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMonth, monthOf } from '../../lib/time';
import { startHarness, type Harness } from '../../test/harness';

// Dividas com juros: valores criptografados, taxa implicita, ordem avalanche, MT-07, amortizacao
// extra, saldo projetado com o tempo, entrada nos fixos (GF-06) e isolamento entre usuarios.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId;
const URL = '/v1/agent/loans';
const req = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url = URL, payload?: object, who = userId) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(who)}` } });
const P = priceInstallment(1_000_000, 0.03, 24);
const emprestimo = { creditor: 'Banco X', kind: 'emprestimo', balanceMinor: 1_000_000, monthlyRate: 0.03, installmentMinor: P, installmentsLeft: 24, dueDay: 8 };

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
});

describe('dividas com juros', () => {
  it('cadastra com saldo e parcela criptografados, calcula prazo e juros, audita sem valores', async () => {
    const r = await req('POST', URL, emprestimo);
    expect(r.statusCode).toBe(200);
    const l = r.json().items[0];
    expect(l).toMatchObject({ creditor: 'Banco X', balanceMinor: 1_000_000, payoffMonths: 24, monthlyInterestMinor: 30_000, highInterest: true, payoffRank: 1, rateInferred: false });
    expect(l.totalInterestMinor).toBeGreaterThan(410_000);
    const doc = await h.ctx.col.loans.findOne({ userId });
    expect(doc!.balanceEnc).toMatch(/^v1\./);
    expect(JSON.stringify(doc)).not.toContain('1000000');
    const log = await h.ctx.col.auditLogs.findOne({ userId, event: 'loan.created' });
    expect(JSON.stringify(log)).not.toContain('1000000');
    expect(JSON.stringify(log)).not.toContain(String(P));
  });

  it('sem taxa, calcula pela parcela e prazo; sem nenhum dos dois, recusa', async () => {
    const r = await req('POST', URL, { ...emprestimo, monthlyRate: null });
    expect(r.json().items[0].rateInferred).toBe(true);
    expect(r.json().items[0].monthlyRate).toBeCloseTo(0.03, 4);
    expect((await req('POST', URL, { ...emprestimo, monthlyRate: undefined, installmentsLeft: null })).statusCode).toBe(400);
    for (const bad of [{ ...emprestimo, balanceMinor: 0 }, { ...emprestimo, monthlyRate: 0.9 }, { ...emprestimo, kind: 'agiota' }, { ...emprestimo, creditor: '' }])
      expect((await req('POST', URL, bad)).statusCode).toBe(400);
  });

  it('ordena por maior taxa; rotativo sem parcela nunca acaba e mostra o juro do mes', async () => {
    await req('POST', URL, { ...emprestimo, creditor: 'Consignado', monthlyRate: 0.015, installmentMinor: 40_000, installmentsLeft: 30 });
    const r = (await req('POST', URL, { creditor: 'Cartão Y', kind: 'cartao-rotativo', balanceMinor: 300_000, monthlyRate: 0.12, dueDay: 15 })).json();
    expect(r.items.map((l: { creditor: string }) => l.creditor)).toEqual(['Cartão Y', 'Consignado']);
    expect(r.items[0]).toMatchObject({ payoffMonths: null, totalInterestMinor: null, monthlyInterestMinor: 36_000, highInterest: true, endsOn: null });
    expect(r.items[1].highInterest).toBe(false);
    expect(r.monthlyInterestMinor).toBe(36_000 + 15_000);
    expect(r.monthlyInstallmentsMinor).toBe(40_000);
  });

  it('simula amortizacao extra: juros evitados e meses a menos', async () => {
    const id = (await req('POST', URL, emprestimo)).json().items[0].id;
    const r = await req('GET', `${URL}/${id}/extra?amountMinor=200000`);
    expect(r.statusCode).toBe(200);
    expect(r.json().interestSavedMinor).toBeGreaterThan(100_000);
    expect(r.json().monthsSaved).toBeGreaterThanOrEqual(5);
    expect((await req('GET', `${URL}/${id}/extra?amountMinor=0`)).statusCode).toBe(400);
  });

  it('o saldo envelhece com as parcelas; atualizar zera o relogio', async () => {
    const id = (await req('POST', URL, emprestimo)).json().items[0].id;
    const month = monthOf(new Date(), 'America/Manaus');
    await h.ctx.col.loans.updateOne({ _id: new ObjectId(id) }, { $set: { balanceAsOf: addMonth(month, -3) } });
    let l = (await req('GET')).json().items[0];
    expect(l.balanceMinor).toBeLessThan(1_000_000);
    expect(l.installmentsLeft).toBe(21);
    expect(l.payoffMonths).toBe(21);
    l = (await req('PATCH', `${URL}/${id}`, { dueDay: 12 })).json().items[0];
    expect(l).toMatchObject({ dueDay: 12, installmentsLeft: 21, balanceAsOf: month });
    expect((await h.ctx.col.auditLogs.findOne({ userId, event: 'loan.updated' }))!.meta).toMatchObject({ balanceChanged: false, after: { dueDay: 12 } });
  });

  it('parcelas entram nos gastos fixos e no endividamento', async () => {
    await h.app.inject({ method: 'PUT', url: '/v1/agent/profile', payload: { netIncomeMinor: 500_000 }, headers: { authorization: `Bearer ${await h.token(userId)}` } });
    const r = (await req('POST', URL, emprestimo)).json();
    expect(r.incomeShare).toBeCloseTo(P / 500_000, 3);
    const fixed = (await req('GET', '/v1/agent/fixed-expenses')).json();
    expect(fixed.items).toEqual([expect.objectContaining({ name: 'Banco X', source: 'divida', categoryKey: 'dividas', amountMinor: P, dueDay: 8 })]);
    expect(fixed.monthlyTotalMinor).toBe(P);
  });

  it('um usuario nao ve nem altera dividas de outro', async () => {
    const id = (await req('POST', URL, emprestimo)).json().items[0].id;
    const other = (await h.createUser({ email: 'outro@pluto.test' })).id;
    expect((await req('GET', URL, undefined, other)).json().items).toEqual([]);
    expect((await req('PATCH', `${URL}/${id}`, { dueDay: 1 }, other)).statusCode).toBe(404);
    expect((await req('GET', `${URL}/${id}/extra?amountMinor=100`, undefined, other)).statusCode).toBe(404);
    expect((await req('DELETE', `${URL}/${id}`, undefined, other)).statusCode).toBe(404);
    expect((await req('DELETE', `${URL}/${id}`)).json().items).toEqual([]);
  });
});
