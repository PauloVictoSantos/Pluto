import { parseBoletoLine } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';
import { markOverdueBills } from '../bills/routes';
import { budgetSuggestion, forecast, goalInsights, paymentPlan } from './forecast';
import { refreshRecurrences } from './service';

// Fase 3: previsao do saldo, orcamento sugerido, chance das metas e contas a pagar.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

const NOW = new Date('2026-10-16T15:00:00Z');
const DAY = 86_400_000;
let userId: ObjectId, checking: ObjectId, card: ObjectId, conn: ObjectId;
let seq = 0;

const tx = (accountId: ObjectId, date: Date, amountMinor: number, over: Record<string, unknown> = {}) => ({
  userId, accountId, connectionId: conn, pluggyTransactionId: `t${seq++}`, date, description: 'COMPRA', descriptionNorm: `compra ${seq}`, matchKey: `compra ${seq}`,
  merchant: null, amountMinor, currency: 'BRL', type: amountMinor > 0 ? 'INCOME' : 'EXPENSE', status: 'POSTED', pluggyCategory: null, pluggyCategoryId: null,
  pluggyBillId: null, categoryKey: amountMinor > 0 ? 'salario' : 'mercado', installment: null, categoryId: null, categorySource: null, categoryConfidence: null,
  invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, hasTime: true, counterpartyKey: null, createdAt: NOW, updatedAt: NOW, ...over,
});

/**
 * Historico de 01/05 a 16/10: no debito, R$ 30 por dia util (mercado) e R$ 100 por dia de fim de semana
 * (lazer); salario de R$ 10.000 todo dia 5.
 */
async function seed() {
  userId = (await h.createUser()).id;
  conn = new ObjectId();
  checking = new ObjectId();
  card = new ObjectId();
  await h.ctx.col.accounts.insertMany([
    { _id: checking, userId, connectionId: conn, pluggyAccountId: 'c', type: 'CHECKING', name: 'Conta', numberMasked: null, balanceMinor: 500_000, currency: 'BRL', creditLimitMinor: null, availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: NOW, updatedAt: NOW },
    { _id: card, userId, connectionId: conn, pluggyAccountId: 'k', type: 'CREDIT_CARD', name: 'Cartão Roxo', numberMasked: null, balanceMinor: 0, currency: 'BRL', creditLimitMinor: null, availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: NOW, updatedAt: NOW },
  ] as never);
  const docs = [];
  for (let t = Date.UTC(2026, 4, 1, 16); t < NOW.getTime() - DAY / 2; t += DAY) {
    const d = new Date(t), dow = d.getUTCDay(), weekend = dow === 0 || dow === 6;
    docs.push(tx(checking, d, weekend ? -10_000 : -3_000, { categoryKey: weekend ? 'lazer' : 'mercado' }));
    if (d.getUTCDate() === 5) docs.push(tx(checking, d, 1_000_000, { matchKey: 'acme salario', descriptionNorm: 'acme salario' }));
  }
  // Compra no cartao: so pesa no saldo pela fatura.
  docs.push(tx(card, new Date('2026-10-10T18:00:00Z'), -99_999, { categoryKey: 'compras' }));
  await h.ctx.col.transactions.insertMany(docs as never);
  await refreshRecurrences(h.ctx.col, userId, NOW);
  await h.ctx.col.invoices.insertOne({
    userId, accountId: card, pluggyBillId: 'b1', closingDate: new Date('2026-10-15T03:00:00Z'), dueDate: new Date('2026-10-25T03:00:00Z'),
    totalMinor: 200_000, paidMinor: 0, status: 'CLOSED', createdAt: NOW, updatedAt: NOW,
  } as never);
}

const req = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });

/** Linha digitavel valida (DVs modulo 10) com o vencimento e o valor pedidos. */
function boletoLine(due: string, amountMinor: number) {
  const mod10 = (n: string) => {
    let s = 0;
    for (let i = n.length - 1, w = 2; i >= 0; i--, w = w === 2 ? 1 : 2) {
      const p = +n[i]! * w;
      s += p > 9 ? p - 9 : p;
    }
    return (10 - (s % 10)) % 10;
  };
  const f1 = '001912345', f2 = '6789012345', f3 = '6789012345';
  const factor = 1000 + (Date.parse(`${due}T00:00:00Z`) - Date.UTC(2025, 1, 22)) / DAY;
  return `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}1${factor}${String(amountMinor).padStart(10, '0')}`;
}

describe('saldo no fim do mes', () => {
  it('liga o modelo (vence a linha de base), desconta fatura e boleto e da a faixa', async () => {
    await seed();
    const line = boletoLine('2026-10-28', 50_000);
    expect(parseBoletoLine(line)).toEqual({ amountMinor: 50_000, dueDate: '2026-10-28', kind: 'bank' });
    expect((await req('POST', '/v1/bills', { payee: 'Energia', line })).statusCode).toBe(201);

    const f = await forecast(h.ctx, userId, NOW);
    expect(f.status).toBe('ready');
    expect(f.backtest.n).toBeGreaterThan(5);
    expect(f.backtest.maeModelMinor!).toBeLessThanOrEqual(f.backtest.maeBaselineMinor!);
    expect(f.known).toMatchObject({ invoicesMinor: 200_000, billsMinor: 50_000, incomeMinor: 0 });
    // 17 a 31/10: 10 dias uteis x R$ 30 + 5 de fim de semana (17, 18, 24, 25, 31) x R$ 100 = R$ 800.
    expect(f.variable.remaining!.p50).toBe(80_000);
    // R$ 5.000 - fatura R$ 2.000 - boleto R$ 500 - variavel R$ 800.
    expect(f.range).toEqual({ p10: 170_000, p50: 170_000, p90: 170_000 });
    expect(f.probPositive).toBe(1);
    expect(f.crossCheck.divergent).toBe(false);
  });

  it('historico curto: fica aprendendo e diz quantas semanas faltam', async () => {
    userId = (await h.createUser()).id;
    await h.ctx.col.transactions.insertOne(tx(new ObjectId(), new Date('2026-10-10T15:00:00Z'), -1000) as never);
    const f = await forecast(h.ctx, userId, NOW);
    expect(f).toMatchObject({ status: 'learning', range: null, probPositive: null });
    expect(f.needWeeks).toBeGreaterThan(0);
  });
});

describe('orcamento sugerido e metas', () => {
  it('sugere limites perto do habito e calcula a chance da meta', async () => {
    await seed();
    const s = await budgetSuggestion(h.ctx, userId, NOW);
    expect(s).toMatchObject({ status: 'ready', months: 5, incomeMedianMinor: 1_000_000, fits: true });
    expect(s.lines.map((l) => l.categoryKey)).toEqual(expect.arrayContaining(['mercado', 'lazer']));
    // Nada e aplicado sem aceite (RN-M06).
    expect(await h.ctx.col.budgets.countDocuments({ userId })).toBe(0);

    const goal = await req('POST', '/v1/goals', { name: 'Reserva', targetMinor: 600_000, deadline: '2027-03-31', priority: 1 });
    expect(goal.json()).toMatchObject({ priority: 1 });
    expect((await req('POST', '/v1/goals', { name: 'Passado', targetMinor: 1, deadline: '2020-01-01' })).statusCode).toBe(400);
    const g = await goalInsights(h.ctx, userId, NOW);
    expect(g.goals[0]).toMatchObject({ chance: 1, months: 6, requiredMonthlyMinor: 100_000 });
  });
});

describe('contas a pagar', () => {
  it('ordena pelo custo de atrasar, concilia so com confirmacao e marca vencidos', async () => {
    await seed();
    const bill = (await req('POST', '/v1/bills', { payee: 'Condomínio', amountMinor: 50_000, dueDate: '2026-10-01' })).json();
    expect(bill.status).toBe('overdue');
    const late = (await req('POST', '/v1/bills', { payee: 'Escola', amountMinor: 80_000, dueDate: '2026-12-01' })).json();
    expect(late.status).toBe('pending');
    // Cifrado no banco.
    const raw = await h.ctx.col.bills.findOne({ userId, dueDate: '2026-10-01' });
    expect(raw!.payeeEnc).toMatch(/^v1\./);
    expect(JSON.stringify(raw)).not.toContain('Condom');

    const plan = await paymentPlan(h.ctx, userId, NOW);
    expect(plan.items[0]).toMatchObject({ kind: 'invoice', amountMinor: 200_000 });
    expect(plan.items[0]!.costPerReal).toBeGreaterThan(plan.items[1]!.costPerReal);
    expect(plan).toMatchObject({ availableMinor: 500_000, totalDueMinor: 330_000, short: false });

    // Pagamento do mesmo valor perto do vencimento: so sugestao.
    await h.ctx.col.transactions.insertOne(tx(checking, new Date('2026-10-02T13:00:00Z'), -50_000, { description: 'PIX CONDOMINIO' }) as never);
    const list = (await req('GET', '/v1/bills')).json();
    const cond = list.find((b: { id: string }) => b.id === bill.id);
    expect(cond.status).toBe('overdue');
    expect(cond.match).toMatchObject({ label: 'PIX CONDOMINIO' });
    expect((await req('PATCH', `/v1/bills/${late.id}`, { status: 'paid', transactionId: cond.match.transactionId })).statusCode).toBe(422);
    const paid = (await req('PATCH', `/v1/bills/${bill.id}`, { status: 'paid', transactionId: cond.match.transactionId })).json();
    expect(paid).toMatchObject({ status: 'paid', paidTransactionId: cond.match.transactionId });

    // Job diario (RN-M03).
    await h.ctx.col.bills.updateOne({ _id: new ObjectId(late.id) }, { $set: { dueDate: '2026-10-10' } });
    expect(await markOverdueBills(h.ctx, NOW)).toBe(1);
  });
});
