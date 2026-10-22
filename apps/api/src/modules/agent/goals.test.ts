import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';

// Metas v2 (doc. Pluton 3.2, 4, 5.4): entrevista obrigatoria, diagnostico com regras MT-04..07,
// cenarios, confirmacao com cronograma, descarte com motivo, pausa e plano das metas.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId, seq = 0;
const now = new Date();
const year = now.getUTCFullYear();
const inMonths = (m: number) => new Date(Date.UTC(year, now.getUTCMonth() + m, 15)).toISOString().slice(0, 10);
const ago = (m: number) => new Date(Date.UTC(year, now.getUTCMonth() - m, 12, 15));
const req = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });
const tx = (date: Date, amountMinor: number, categoryKey: string) => ({
  userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: `g${seq++}`, date, description: 'X', descriptionNorm: 'x', matchKey: `k${seq}`, merchant: null,
  amountMinor, currency: 'BRL', type: 'EXPENSE', status: 'POSTED', pluggyCategory: null, pluggyCategoryId: null, pluggyBillId: null, categoryKey, installment: null, categoryId: null,
  categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, hasTime: false, counterpartyKey: null, createdAt: date, updatedAt: date,
});
/** Renda 10 mil, fixos 3 mil, variaveis 2 mil: sobra 5 mil/mes; reserva de 6 meses ja guardada. */
async function healthyUser() {
  await req('PUT', '/v1/agent/profile', { netIncomeMinor: 1_000_000 });
  await req('POST', '/v1/agent/fixed-expenses', { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 300_000, dueDay: 5, recurrence: 'monthly' });
  await h.ctx.col.transactions.insertMany([1, 2, 3].map((m) => tx(ago(m), -200_000, 'mercado')) as never);
  await h.ctx.col.goals.insertOne({ _id: new ObjectId(), userId, name: 'Reserva de emergência', icon: 'shield', targetMinor: 1_800_000, savedMinor: 1_800_000, deadline: inMonths(12), monthlyContributionMinor: 0, createdAt: now, updatedAt: now } as never);
}
const purchase = { targetMinor: 1_000_000, priceResearched: true, reason: 'trabalho', urgency: 4, store: 'Loja online', paymentMethod: 'cash', cashDiscount: 0.1, alternative: 'nenhuma', savedMinor: 0 };
async function draft(kind: string, title: string, answers: object) {
  const id = (await req('POST', '/v1/agent/goal-drafts', { kind, title })).json().id;
  await req('PATCH', `/v1/agent/goal-drafts/${id}`, answers);
  return id as string;
}

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
});

describe('metas v2', () => {
  it('entrevista: pergunta 1-2 por vez e so diagnostica com tudo respondido (MT-02)', async () => {
    const d = (await req('POST', '/v1/agent/goal-drafts', { kind: 'purchase', title: 'Computador' })).json();
    expect(d).toMatchObject({ status: 'rascunho', diagnosis: null });
    expect(d.next.map((q: { field: string }) => q.field)).toEqual(['targetMinor', 'priceResearched']);
    expect(d.next[0].question).toBe('Qual o valor exato?');
    let r = await req('PATCH', `/v1/agent/goal-drafts/${d.id}`, { targetMinor: 500_000, priceResearched: true, paymentMethod: 'financed' });
    expect(r.json().missing).toEqual(expect.arrayContaining(['installments', 'monthlyRate', 'reason', 'targetDate']));
    r = await req('POST', `/v1/agent/goal-drafts/${d.id}/diagnose`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('INTERVIEW_INCOMPLETE');
    expect((await req('PATCH', `/v1/agent/goal-drafts/${d.id}`, { targetDate: '2000-01-01' })).statusCode).toBe(400);
    expect((await req('PATCH', `/v1/agent/goal-drafts/${d.id}`, { urgency: 9 })).statusCode).toBe(400);
  });

  it('aprova quando cabe, confirma com cronograma e recalcula o limite', async () => {
    await healthyUser();
    const id = await draft('purchase', 'Computador de trabalho', { ...purchase, targetDate: inMonths(10) });
    const d = (await req('POST', `/v1/agent/goal-drafts/${id}/diagnose`)).json();
    expect(d.status).toBe('em-analise');
    expect(d.diagnosis).toMatchObject({ verdict: 'aprovar', targetMinor: 900_000, capacityMinor: 500_000, freeMinor: 500_000 });
    expect(d.diagnosis.scenarios[0]).toMatchObject({ key: 'no-prazo' });
    expect(d.diagnosis.score).toBeGreaterThan(0.5);
    const monthly = d.diagnosis.requiredMonthlyMinor;
    expect(monthly).toBeLessThan(100_000); // rende enquanto junta
    const before = (await req('GET', '/v1/agent/limit')).json().limitMinor;
    const c = (await req('POST', `/v1/agent/goal-drafts/${id}/confirm`, { scenario: 'no-prazo' })).json();
    expect(c).toMatchObject({ status: 'confirmada' });
    const goal = await h.ctx.col.goals.findOne({ _id: new ObjectId(c.goalId) });
    expect(goal).toMatchObject({ status: 'ativa', kind: 'purchase', monthlyContributionMinor: monthly, targetMinor: 900_000 });
    expect(goal!.rationale!.at(-1)).toContain('Cenário escolhido: No prazo');
    expect((await req('GET', '/v1/agent/limit')).json().limitMinor).toBe(before - monthly);
    expect((await req('GET', '/v1/goals')).json().find((g: { id: string }) => g.id === c.goalId)).toMatchObject({ status: 'ativa', kind: 'purchase' });
    expect((await req('POST', `/v1/agent/goal-drafts/${id}/confirm`, { scenario: 'no-prazo' })).statusCode).toBe(409);
  });

  it('MT-07: divida acima de 2% a.m. adia a compra de desejo e mostra os juros', async () => {
    await healthyUser();
    await req('POST', '/v1/agent/loans', { creditor: 'Financeira', kind: 'emprestimo', balanceMinor: 500_000, monthlyRate: 0.08, installmentMinor: 60_000, installmentsLeft: 12, dueDay: 5 });
    const id = await draft('experience', 'Viagem', { ...purchase, reason: 'desejo', store: 'Agência', targetDate: inMonths(8) });
    const d = (await req('POST', `/v1/agent/goal-drafts/${id}/diagnose`)).json().diagnosis;
    expect(d.verdict).toBe('adiar');
    expect(d.rationale[0]).toContain('juros acima de 2% ao mês');
    expect(d.rationale[0]).toContain('Quitar vem antes');
    expect(d.scenarios.map((s: { key: string }) => s.key)).toEqual(['adiar']);
  });

  it('MT-06: sem reserva, compra de desejo espera; reserva tem prioridade', async () => {
    await req('PUT', '/v1/agent/profile', { netIncomeMinor: 1_000_000 });
    await req('POST', '/v1/agent/fixed-expenses', { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 300_000, dueDay: 5, recurrence: 'monthly' });
    const wish = await draft('purchase', 'Videogame', { ...purchase, reason: 'desejo', targetMinor: 400_000, targetDate: inMonths(6) });
    const dw = (await req('POST', `/v1/agent/goal-drafts/${wish}/diagnose`)).json().diagnosis;
    expect(dw.verdict).toBe('adiar');
    expect(dw.rationale[0]).toContain('reserva');
    const reserve = await draft('fixed', 'Reserva de emergência', { targetMonths: 6, savedMinor: 0, monthlyCapacityMinor: 200_000, whereStored: 'CDB liquidez diária', liquidity: true });
    const dr = (await req('POST', `/v1/agent/goal-drafts/${reserve}/diagnose`)).json().diagnosis;
    expect(dr).toMatchObject({ verdict: 'aprovar', targetMinor: 1_800_000 });
    expect(dr.score).toBeGreaterThan(dw.score);
  });

  it('MT-05: nao cabe -> adiar, reduzir ou pausar meta menor; MT-04 na confirmacao', async () => {
    await healthyUser();
    // Meta antiga de baixa prioridade usando 400 mil da sobra de 500 mil.
    const viagemId = new ObjectId();
    await h.ctx.col.goals.insertOne({ _id: viagemId, userId, name: 'Viagem', icon: 'plane', targetMinor: 5_000_000, savedMinor: 0, deadline: inMonths(24), monthlyContributionMinor: 400_000, priority: 5, createdAt: now, updatedAt: now } as never);
    const id = await draft('purchase', 'Computador', { ...purchase, reason: 'renda', targetMinor: 2_000_000, cashDiscount: 0, targetDate: inMonths(6) });
    const d = (await req('POST', `/v1/agent/goal-drafts/${id}/diagnose`)).json().diagnosis;
    expect(d.verdict).toBe('adiar');
    expect(d.freeMinor).toBe(100_000);
    expect(d.scenarios.map((s: { key: string }) => s.key)).toEqual(['adiar', 'reduzir', 'pausar']);
    expect(d.scenarios[2].pauseGoalId).toBe(String(viagemId));
    // Confirmar "pausar": a viagem pausa e a nova meta recebe o aporte.
    const c = (await req('POST', `/v1/agent/goal-drafts/${id}/confirm`, { scenario: 'pausar' })).json();
    expect((await h.ctx.col.goals.findOne({ _id: viagemId }))!.status).toBe('pausada');
    const plan = (await req('GET', '/v1/agent/goals/plan')).json();
    expect(plan.goals.find((g: { goalId: string }) => g.goalId === c.goalId)).toMatchObject({ waiting: false });
    expect(plan.goals.find((g: { goalId: string }) => g.goalId === String(viagemId))).toMatchObject({ status: 'pausada', allocatedMinor: 0 });
    // Retomar a viagem passaria da capacidade (MT-04).
    const r = await req('PATCH', `/v1/agent/goals/${viagemId}/status`, { status: 'ativa' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('OVER_CAPACITY');
  });

  it('MT-08: objetivo do ano sobe o score da meta alinhada', async () => {
    await healthyUser();
    const a = await draft('experience', 'Viagem', { ...purchase, reason: 'desejo', store: 'Agência', targetMinor: 300_000, targetDate: inMonths(10) });
    const s1 = (await req('POST', `/v1/agent/goal-drafts/${a}/diagnose`)).json().diagnosis.score;
    await req('PUT', '/v1/agent/profile', { yearObjective: 'viajar' });
    const s2 = (await req('POST', `/v1/agent/goal-drafts/${a}/diagnose`)).json().diagnosis;
    expect(s2.factors.R).toBe(1);
    expect(s2.score - s1).toBeCloseTo(0.15, 3);
    expect(s2.rationale).toContain('Está alinhada ao seu objetivo do ano: ganhou peso extra na prioridade.');
  });

  it('descarta com motivo auditado; financiado mostra o custo dos juros', async () => {
    await healthyUser();
    const id = await draft('purchase', 'Carro', { ...purchase, paymentMethod: 'financed', installments: 24, monthlyRate: 0.02, targetDate: inMonths(12) });
    const d = (await req('POST', `/v1/agent/goal-drafts/${id}/diagnose`)).json().diagnosis;
    expect(d.financedInterestMinor).toBeGreaterThan(260_000);
    const r = (await req('POST', `/v1/agent/goal-drafts/${id}/discard`, { reason: 'Vou esperar o ano que vem' })).json();
    expect(r.status).toBe('descartada');
    expect(await h.ctx.col.auditLogs.findOne({ userId, event: 'goal_draft.discarded', 'meta.reason': 'Vou esperar o ano que vem' })).not.toBeNull();
    expect((await req('GET', '/v1/agent/goal-drafts')).json()).toEqual([]);
  });

  it('rascunho de outro usuario nao existe para mim', async () => {
    const id = await draft('purchase', 'Computador', {});
    const other = (await h.createUser({ email: 'outro@pluto.test' })).id;
    const r = await h.app.inject({ method: 'POST', url: `/v1/agent/goal-drafts/${id}/diagnose`, headers: { authorization: `Bearer ${await h.token(other)}` } });
    expect(r.statusCode).toBe(404);
  });
});
