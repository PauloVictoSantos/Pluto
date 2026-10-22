import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMonth, monthOf } from '../../lib/time';
import { startHarness, type Harness } from '../../test/harness';
import { limitUsage } from '../alerts/service';
import { ensureMonthLimits } from './limit';

// Limite de gasto (doc. Pluton 3.3): LG-01 calculo, LG-03 recalculo a cada mudanca e na virada,
// LG-04 sobrescrita com alerta e auditoria, LG-05 avisos de consumo, LG-06 por semana.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId, seq = 0;
const req = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });
const limit = async () => (await req('GET', '/v1/agent/limit')).json();
const now = new Date();
const month = monthOf(now, 'America/Manaus');
const tx = (matchKey: string, amountMinor: number, categoryKey: string, over: Record<string, unknown> = {}) => ({
  userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: `l${seq++}`, date: new Date(now.getTime() - 3_600_000), description: matchKey.toUpperCase(),
  descriptionNorm: matchKey, matchKey, merchant: null, amountMinor, currency: 'BRL', type: 'EXPENSE', status: 'POSTED', pluggyCategory: null, pluggyCategoryId: null, pluggyBillId: null,
  categoryKey, installment: null, categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, hasTime: true,
  counterpartyKey: null, createdAt: now, updatedAt: now, ...over,
});

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
});

describe('limite de gasto', () => {
  it('sem renda: limite zero e status sem-renda', async () => {
    const l = await limit();
    expect(l).toMatchObject({ month, limitMinor: 0, status: 'sem-renda', overrideMinor: null });
  });

  it('LG-01 e LG-03: renda - fixos - parcelas - aportes - margem, recalculado a cada mudanca', async () => {
    await req('PUT', '/v1/agent/profile', { netIncomeMinor: 500_000, safetyMarginPct: 10 });
    expect((await limit()).limitMinor).toBe(450_000);

    await req('POST', '/v1/agent/fixed-expenses', { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 150_000, dueDay: 5, recurrence: 'monthly' });
    expect((await limit()).limitMinor).toBe(300_000);

    await req('POST', '/v1/agent/loans', { creditor: 'Banco', kind: 'emprestimo', balanceMinor: 300_000, monthlyRate: 0.02, installmentMinor: 30_000, installmentsLeft: 12, dueDay: 8 });
    expect((await limit()).limitMinor).toBe(270_000);

    const g = await req('POST', '/v1/goals', { name: 'Reserva', icon: 'shield', targetMinor: 1_000_000, deadline: `${+month.slice(0, 4) + 2}-12-31`, priority: 1 });
    expect(g.statusCode).toBe(201);
    await req('PATCH', `/v1/goals/${g.json().id}`, { monthlyContributionMinor: 70_000 });
    const l = await limit();
    expect(l).toMatchObject({ limitMinor: 200_000, status: 'ok', breakdown: { incomeMinor: 500_000, fixedMinor: 180_000, goalsMinor: 70_000, marginMinor: 50_000, deficitMinor: 0 } });

    // Margem mudou: recalcula.
    await req('PUT', '/v1/agent/profile', { safetyMarginPct: 0 });
    expect((await limit()).limitMinor).toBe(250_000);
    const reasons = (await h.ctx.col.auditLogs.find({ userId, event: 'limit.recalculated' }).toArray()).map((a) => a.meta.reason);
    expect(reasons).toEqual(expect.arrayContaining(['PUT /v1/agent/profile', 'POST /v1/agent/fixed-expenses', 'POST /v1/agent/loans', 'PATCH /v1/goals/:id']));
  });

  it('gasto variavel: conta consumo, ignora fixos vinculados, parcelas divididas e meses passados; LG-06 por semana', async () => {
    await req('PUT', '/v1/agent/profile', { netIncomeMinor: 400_000, safetyMarginPct: 0 });
    await req('POST', '/v1/agent/fixed-expenses', { name: 'Netflix', categoryKey: 'assinaturas', amountMinor: 5_590, dueDay: 3, recurrence: 'monthly', matchKey: 'netflix com' });
    await h.ctx.col.transactions.insertMany([
      tx('ifood', -10_000, 'delivery'),
      tx('mercado bom', -30_000, 'mercado'),
      tx('netflix com', -5_590, 'assinaturas'),
      tx('casas bahia', -48_000, 'compras', { splitOf: new ObjectId() }),
      tx('fatura', -90_000, 'fatura'),
      tx('salario', 400_000, 'salario', { type: 'INCOME' }),
      tx('ifood', -99_000, 'delivery', { date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 10)) }),
    ] as never);
    const l = await limit();
    expect(l.spentMinor).toBe(40_000);
    expect(l.remainingMinor).toBe(l.limitMinor - 40_000);
    expect(l.weekMinor).toBe(Math.floor(l.remainingMinor / l.weeksLeft));
    expect(l.typicalMinor).toBe(99_000);
  });

  it('LG-04: sobrescrita vale so no mes, gera alerta e auditoria; null volta ao calculado', async () => {
    await req('PUT', '/v1/agent/profile', { netIncomeMinor: 300_000, safetyMarginPct: 0 });
    let r = await req('PUT', '/v1/agent/limit/override', { amountMinor: 350_000 });
    expect(r.json()).toMatchObject({ computedMinor: 300_000, overrideMinor: 350_000, limitMinor: 350_000 });
    // Mudanca no plano recalcula o calculado mas mantem a sobrescrita do mes.
    await req('POST', '/v1/agent/fixed-expenses', { name: 'Luz', categoryKey: 'contas-casa', amountMinor: 20_000, dueDay: 5, recurrence: 'monthly' });
    expect(await limit()).toMatchObject({ computedMinor: 280_000, limitMinor: 350_000 });
    const alert = await h.ctx.col.alerts.findOne({ userId, type: 'limit_override' });
    expect(alert!.body).toContain('No mês que vem o limite volta a ser calculado');
    expect(await h.ctx.col.auditLogs.findOne({ userId, event: 'limit.override' })).not.toBeNull();
    r = await req('PUT', '/v1/agent/limit/override', { amountMinor: null });
    expect(r.json()).toMatchObject({ overrideMinor: null, limitMinor: 280_000 });
    expect(await h.ctx.col.alerts.countDocuments({ userId, type: 'limit_override' })).toBe(1);
    // Mes seguinte comeca sem sobrescrita.
    const next = new Date(Date.UTC(+addMonth(month, 1).slice(0, 4), +addMonth(month, 1).slice(5) - 1, 15, 12));
    expect(await ensureMonthLimits(h.ctx, next)).toBe(1);
    expect(await h.ctx.col.spendingLimits.findOne({ userId, month: addMonth(month, 1) })).toMatchObject({ overrideMinor: null, computedMinor: 280_000 });
    expect(await ensureMonthLimits(h.ctx, next)).toBe(0);
  });

  it('LG-05: avisa em 50/80/100%, uma vez por faixa no mes', async () => {
    await req('PUT', '/v1/agent/profile', { netIncomeMinor: 100_000, safetyMarginPct: 0 });
    await h.ctx.col.transactions.insertOne(tx('loja', -55_000, 'compras') as never);
    let c = await limitUsage(h.ctx, userId, now);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ type: 'limit_usage', target: `limit:${month}:0.5` });
    await h.ctx.col.alerts.insertOne({ _id: new ObjectId(), userId, type: 'limit_usage', target: `limit:${month}:0.5`, createdAt: now } as never);
    expect(await limitUsage(h.ctx, userId, now)).toEqual([]);
    await h.ctx.col.transactions.insertOne(tx('loja', -50_000, 'compras') as never);
    c = await limitUsage(h.ctx, userId, now);
    expect(c[0]!.title).toBe('Você chegou ao limite de gasto do mês');
    expect((await limit()).status).toBe('estourado');
  });

  it('requer login', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/agent/limit' })).statusCode).toBe(401);
  });
});
