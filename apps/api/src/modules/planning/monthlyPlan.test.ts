import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMonth, monthOf, monthStart } from '../../lib/time';
import { startHarness, type Harness } from '../../test/harness';
import { budgetUsage, extraIncome, notifyPlanReady } from '../alerts/service';
import { buildMonthlyPlan, ensureMonthlyPlans, monthNamePt } from './monthlyPlan';

// Planejamento automatico (doc. Melhorias, passo 9).

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const TZ = 'America/Manaus';
let userId: ObjectId;
const checking = new ObjectId();
const auth = async () => ({ authorization: `Bearer ${await h.token(userId)}` });
const NOW = new Date();
const cur = monthOf(NOW, TZ);
const at = (month: string, day: number) => new Date(monthStart(month, TZ).getTime() + (day - 1) * 86_400_000 + 15 * 3_600_000);
const tx = (date: Date, amountMinor: number, categoryKey: string, description: string) => ({
  userId, accountId: checking, connectionId: new ObjectId(), pluggyTransactionId: String(new ObjectId()), date, description, descriptionNorm: description.toLowerCase(),
  matchKey: description.toLowerCase(), merchant: null, amountMinor, currency: 'BRL', type: amountMinor < 0 ? 'EXPENSE' : 'INCOME', status: 'POSTED', pluggyCategory: null,
  pluggyCategoryId: null, pluggyBillId: null, categoryKey, installment: null, categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [],
  notes: null, hidden: false, deletedAt: null, createdAt: date, updatedAt: date,
});
const invest = (currentValueMinor: number) =>
  h.ctx.col.investments.insertOne({
    userId, connectionId: new ObjectId(), pluggyInvestmentId: 'cdb', type: 'FIXED_INCOME', subtype: null, name: 'CDB', quantity: null, appliedMinor: currentValueMinor,
    currentValueMinor, dueDate: null, rateInfo: null, createdAt: NOW, updatedAt: NOW,
  } as never);
const sum = (a: { amountMinor: number }[]) => a.reduce((t, x) => t + x.amountMinor, 0);

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
  h.ctx.llm = null;
  // 3 meses fechados de gastos variaveis (mercado e restaurantes variam um pouco) e salario.
  const months = [3, 2, 1].map((n) => addMonth(cur, -n));
  await h.ctx.col.transactions.insertMany(
    months.flatMap((m, i) => [
      tx(at(m, 5), 500_000, 'salario', `SALARIO ${m}`),
      tx(at(m, 7), -(60_000 + i * 5_000), 'mercado', `MERCADO ${m}`),
      tx(at(m, 12), -(30_000 - i * 2_000), 'restaurantes', `RESTAURANTE ${m}`),
    ]) as never,
  );
  const a = await auth();
  await h.app.inject({ method: 'PUT', url: '/v1/agent/profile', payload: { netIncomeMinor: 500_000, referenceRateMonthly: 0.008 }, headers: a });
  await h.app.inject({ method: 'POST', url: '/v1/agent/fixed-expenses', payload: { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 150_000, dueDay: 5, recurrence: 'monthly' }, headers: a });
  // Rotativo: 12% ao mes (bem acima do rendimento de 0,8%).
  await h.app.inject({ method: 'POST', url: '/v1/agent/loans', payload: { creditor: 'Rotativo do cartão', kind: 'cartao-rotativo', balanceMinor: 40_000, monthlyRate: 0.12, installmentMinor: 10_000, dueDay: 10 }, headers: a });
  await h.ctx.col.goals.insertOne({ _id: new ObjectId(), userId, name: 'Viagem', icon: 'plane', targetMinor: 600_000, savedMinor: 0, deadline: '2027-12-01', monthlyContributionMinor: 30_000, priority: 3, status: 'ativa', createdAt: NOW, updatedAt: NOW } as never);
});

describe('plano do mes', () => {
  it('usa dados reais e toda a sobra tem destino (soma fecha em R$ 0,00)', async () => {
    // Reserva completa (3 x 1.600 de compromissos = 4.800): a divida cara entra antes da meta.
    await invest(500_000);
    const p = await buildMonthlyPlan(h.ctx, userId, NOW);
    expect(p.month).toBe(cur);
    expect(p).toMatchObject({ incomeMinor: 500_000, incomeSource: 'perfil' });
    expect(p.commitments.map((c) => c.name).sort()).toEqual(['Aluguel', 'Rotativo do cartão']);
    expect(p.commitmentsMinor).toBe(160_000);
    expect(p.surplusMinor).toBe(340_000);
    expect(p.limits.map((l) => l.categoryKey).sort()).toEqual(['mercado', 'restaurantes']);
    // Media dos meses completos (o primeiro mes com dados conta como incompleto): 65.000 e 70.000.
    expect(p.limits.find((l) => l.categoryKey === 'mercado')!.averageMinor).toBe(67_500);
    // Toda sobra com destino.
    expect(p.limitsMinor + sum(p.destinations)).toBe(p.surplusMinor);
    expect(p.destinations.map((d) => d.kind)).toEqual(['divida', 'meta', 'investimento']);
    // Cada decisao com explicacao (a da divida diz quanto economiza).
    expect(p.destinations.every((d) => d.why.length > 20)).toBe(true);
    expect(p.destinations[0]!.why).toMatch(/economiza R\$\s[\d.,]+ de juros: o juro dela \(12,0% ao mês\) é maior que o rendimento/);
    expect(p.previous).toMatchObject({ month: addMonth(cur, -1), incomeMinor: 500_000 });
    // Limites viram o orcamento do mes.
    expect(await h.ctx.col.budgets.countDocuments({ userId, month: cur })).toBe(2);
    expect(p.summary).toContain('Nenhum real fica sem destino');
  });

  it('gasto habitual maior que a sobra: limites cortam na proporcao e nunca passam da sobra', async () => {
    await h.app.inject({ method: 'PUT', url: '/v1/agent/profile', payload: { netIncomeMinor: 240_000 }, headers: await auth() });
    const p = await buildMonthlyPlan(h.ctx, userId, NOW);
    expect(p.surplusMinor).toBe(80_000);
    expect(p.limitsMinor).toBeLessThanOrEqual(p.surplusMinor);
    expect(p.limitsMinor + sum(p.destinations)).toBe(p.surplusMinor);
    // So o arredondamento dos limites (R$ 10) sobra: vai para investimento, sem real parado.
    expect(p.freeMinor).toBeLessThan(1_000 * p.limits.length);
  });

  it('reserva incompleta vem antes de adiantar divida', async () => {
    const p = await buildMonthlyPlan(h.ctx, userId, NOW);
    expect(p.destinations[0]!.kind).toBe('reserva');
    expect(p.destinations.some((d) => d.kind === 'divida')).toBe(false);
    expect(p.limitsMinor + sum(p.destinations)).toBe(p.surplusMinor);
  });

  it('ajuste do usuario vale para o mes; o investimento absorve; nunca passa da sobra', async () => {
    await invest(500_000);
    const p = await buildMonthlyPlan(h.ctx, userId, NOW);
    const meta = p.destinations.find((d) => d.kind === 'meta')!;
    const r = await h.app.inject({
      method: 'PATCH',
      url: `/v1/planning/monthly/${cur}`,
      payload: { limits: [{ categoryKey: 'mercado', limitMinor: 70_000 }], destinations: [{ ...meta, amountMinor: 50_000, why: undefined }] },
      headers: await auth(),
    });
    expect(r.statusCode).toBe(200);
    const adj = r.json();
    expect(adj.adjusted).toBe(true);
    expect(adj.limitsMinor).toBe(70_000);
    expect(adj.limitsMinor + sum(adj.destinations)).toBe(adj.surplusMinor);
    expect(adj.destinations.find((d: { kind: string }) => d.kind === 'meta').amountMinor).toBe(50_000);
    expect((await h.ctx.col.budgets.find({ userId, month: cur }).toArray()).map((b) => [b.categoryKey, b.limitMinor])).toEqual([['mercado', 70_000]]);
    const over = await h.app.inject({ method: 'PATCH', url: `/v1/planning/monthly/${cur}`, payload: { destinations: [{ ...meta, amountMinor: 9_999_999, why: undefined }] }, headers: await auth() });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.code).toBe('OVER_SURPLUS');
  });

  it('resumo da IA so com consentimento e sem numero inventado', async () => {
    await h.ctx.col.users.updateOne({ _id: userId }, { $set: { 'settings.aiConsentAt': new Date().toISOString() } });
    let reply = 'Em novembro sobram R$ 3.400,00 depois dos compromissos. Vale guardar R$ 999,99 extras.';
    h.ctx.llm = { generate: async () => reply };
    expect((await buildMonthlyPlan(h.ctx, userId, NOW)).summary).toContain('Nenhum real fica sem destino'); // R$ 999,99 inventado
    reply = 'Sobram R$ 3.400,00 depois dos compromissos de R$ 1.600,00; tudo já tem destino.';
    expect((await buildMonthlyPlan(h.ctx, userId, NOW)).summary).toBe(reply);
  });
});

describe('rotina do dia 1', () => {
  it('gera as 06:00 do dia 1 no fuso do usuario, avisa uma vez e nao repete', async () => {
    const day1 = (hourLocal: number) => new Date(monthStart(cur, TZ).getTime() + hourLocal * 3_600_000);
    const sent: string[] = [];
    const notify = async (id: ObjectId, plan: { month: string; summary: string }) => {
      await notifyPlanReady(h.ctx, id, plan, monthNamePt(plan.month), day1(6));
      sent.push(plan.month);
    };
    expect(await ensureMonthlyPlans(h.ctx, day1(5), notify)).toBe(0);
    expect(await ensureMonthlyPlans(h.ctx, day1(6), notify)).toBe(1);
    expect(await ensureMonthlyPlans(h.ctx, day1(7), notify)).toBe(0);
    expect(sent).toEqual([cur]);
    expect(await h.ctx.col.monthlyPlans.findOne({ userId, month: cur })).toMatchObject({ trigger: 'auto' });
    expect(await h.ctx.col.alerts.findOne({ userId, type: 'plan_ready' })).toMatchObject({ title: `Seu planejamento de ${monthNamePt(cur)} está pronto`, action: { page: 'plan' } });
  });
});

describe('durante o mes', () => {
  it('alerta em 80% e 100% do limite de uma categoria, uma vez por faixa', async () => {
    await h.ctx.col.budgets.insertOne({ userId, month: cur, categoryKey: 'mercado', limitMinor: 50_000, createdAt: NOW, updatedAt: NOW } as never);
    await h.ctx.col.transactions.insertOne(tx(NOW, -41_000, 'mercado', 'MERCADO HOJE') as never);
    const a = await budgetUsage(h.ctx, userId, TZ, NOW);
    expect(a.map((x) => x.title)).toEqual(['Mercado: 80% do limite usado']);
    await h.ctx.col.alerts.insertOne({ ...a[0]!, userId, createdAt: NOW } as never);
    expect(await budgetUsage(h.ctx, userId, TZ, NOW)).toEqual([]);
    await h.ctx.col.transactions.insertOne(tx(NOW, -10_000, 'mercado', 'MERCADO DE NOVO') as never);
    expect((await budgetUsage(h.ctx, userId, TZ, NOW)).map((x) => x.title)).toEqual(['Mercado: limite do mês atingido']);
  });

  it('dinheiro extra: sugere o destino na hora', async () => {
    await buildMonthlyPlan(h.ctx, userId, NOW);
    await h.ctx.col.transactions.insertMany([tx(NOW, 500_000, 'salario', 'SALARIO'), tx(NOW, 120_000, 'entradas', 'FREELA')] as never);
    const a = await extraIncome(h.ctx, userId, TZ, NOW);
    expect(a).toHaveLength(1);
    expect(a[0]!.title).toMatch(/^Entrou R\$\s1\.200,00 a mais este mês$/);
    expect(a[0]!.body).toContain('a reserva de emergência');
  });
});
