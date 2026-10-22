import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';

// Perfil financeiro do agente: padroes, renda criptografada, sugestao pela mediana e auditoria sem valor.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId, seq = 0;
const req = async (method: 'GET' | 'PUT', payload?: object) =>
  h.app.inject({ method, url: '/v1/agent/profile', payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });
const income = (date: Date, amountMinor: number) => ({
  userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: `p${seq++}`, date, description: 'SALARIO', descriptionNorm: 'salario', matchKey: 'salario',
  merchant: null, amountMinor, currency: 'BRL', type: 'INCOME', status: 'POSTED', pluggyCategory: 'Salary', pluggyCategoryId: null, pluggyBillId: null, categoryKey: 'salario',
  installment: null, categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, hasTime: false,
  counterpartyKey: null, createdAt: date, updatedAt: date,
});

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
});

describe('perfil financeiro', () => {
  it('perfil novo vem com os padroes e sem renda', async () => {
    const r = await req('GET');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ netIncomeMinor: null, suggestedIncomeMinor: null, safetyMarginPct: 5, yearObjective: null, referenceRateMonthly: 0.008, updatedAt: null });
  });

  it('sugere a renda pela mediana dos meses fechados (o mes atual nao conta)', async () => {
    const now = new Date();
    const ago = (m: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 10, 15));
    await h.ctx.col.transactions.insertMany([income(ago(1), 400_000), income(ago(2), 380_000), income(ago(2), 20_000), income(ago(3), 900_000), income(ago(0), 5_000_000)] as never);
    // Meses: 400k, 400k, 900k -> mediana 400k.
    expect((await req('GET')).json().suggestedIncomeMinor).toBe(400_000);
  });

  it('grava a renda criptografada, valida limites e audita sem o valor', async () => {
    const r = await req('PUT', { netIncomeMinor: 523_456, yearObjective: 'quitar-dividas', safetyMarginPct: 10 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ netIncomeMinor: 523_456, yearObjective: 'quitar-dividas', safetyMarginPct: 10, referenceRateMonthly: 0.008 });
    const doc = await h.ctx.col.financialProfiles.findOne({ userId });
    expect(doc!.netIncomeEnc).toMatch(/^v1\./);
    expect(JSON.stringify(doc)).not.toContain('523456');
    const log = await h.ctx.col.auditLogs.findOne({ userId, event: 'agent_profile.updated' });
    expect(JSON.stringify(log)).not.toContain('523456');
    expect(log!.meta).toMatchObject({ before: { safetyMarginPct: 5, netIncomeSet: false }, after: { safetyMarginPct: 10, netIncomeSet: true, netIncomeChanged: true } });

    // Atualizacao parcial preserva o resto.
    expect((await req('PUT', { safetyMarginPct: 0 })).json()).toMatchObject({ netIncomeMinor: 523_456, safetyMarginPct: 0, yearObjective: 'quitar-dividas' });
    expect((await req('PUT', { netIncomeMinor: null })).json().netIncomeMinor).toBeNull();

    for (const bad of [{ safetyMarginPct: 16 }, { referenceRateMonthly: 0.2 }, { yearObjective: 'ficar-rico' }, { netIncomeMinor: -1 }, {}]) expect((await req('PUT', bad)).statusCode).toBe(400);
  });

  it('exige login', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/agent/profile' })).statusCode).toBe(401);
  });
});
