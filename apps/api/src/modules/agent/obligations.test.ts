import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LlmContent, LlmPart } from '../../integrations/llm/gemini';
import { addMonth, monthOf } from '../../lib/time';
import { startHarness, type Harness } from '../../test/harness';
import { listObligations } from './obligations';
import { CONTEXT_TTL_MS, financialContext } from './plutao/context';

// Dividas numa lista so e contexto financeiro do Plutao (doc. Melhorias, passo 5).

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const TZ = 'America/Manaus';
let userId: ObjectId;
let card: ObjectId;
let checking: ObjectId;
let systems: string[];
let seen: LlmContent[][];
let script: LlmPart[][];
const auth = async () => ({ authorization: `Bearer ${await h.token(userId)}` });
const chat = async (message: string) => (await h.app.inject({ method: 'POST', url: '/v1/agent/chat', payload: { message }, headers: await auth() })).json();
const toolResponse = (name: string) => seen.flat().flatMap((c) => c.parts).find((p) => p.functionResponse?.name === name)?.functionResponse?.response.dados as Record<string, unknown>;

const now = new Date();
const cur = monthOf(now, TZ), prev = addMonth(cur, -1);
const at = (month: string, day: number) => new Date(`${month}-${String(day).padStart(2, '0')}T16:00:00Z`);

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
  await h.ctx.col.users.updateOne({ _id: userId }, { $set: { 'settings.aiConsentAt': new Date().toISOString() } });
  const conn = new ObjectId();
  card = new ObjectId();
  checking = new ObjectId();
  const acc = (_id: ObjectId, type: string, balanceMinor: number, extra = {}) => ({
    _id, userId, connectionId: conn, pluggyAccountId: String(_id), type, name: type === 'CREDIT_CARD' ? 'NEO VISA' : 'Bradesco', numberMasked: '1234',
    balanceMinor, currency: 'BRL', creditLimitMinor: null, availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null,
    createdAt: now, updatedAt: now, ...extra,
  });
  await h.ctx.col.accounts.insertMany([acc(checking, 'CHECKING', 250_000), acc(card, 'CREDIT_CARD', 80_000, { dueDay: 10 })] as never);
  await h.ctx.col.invoices.insertOne({
    userId, accountId: card, pluggyBillId: 'b1', closingDate: null, dueDate: new Date(now.getTime() + 10 * 86_400_000), totalMinor: 129_712, paidMinor: 0, status: 'CLOSED', createdAt: now, updatedAt: now,
  } as never);
  const tx = (date: Date, amountMinor: number, type: string, categoryKey: string, description: string, extra = {}) => ({
    userId, accountId: checking, connectionId: conn, pluggyTransactionId: String(new ObjectId()), date, description, descriptionNorm: description.toLowerCase(), merchant: null,
    amountMinor, currency: 'BRL', type, status: 'POSTED', pluggyCategory: null, pluggyCategoryId: null, pluggyBillId: null, categoryKey, installment: null,
    categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, createdAt: now, updatedAt: now, ...extra,
  });
  await h.ctx.col.transactions.insertMany([
    // Geladeira em 10x no cartao: parcela 3 de 10 (ja esta na fatura).
    tx(new Date(now.getTime() - 5 * 86_400_000), -30_000, 'EXPENSE', 'casa', 'Geladeira 03/10', { accountId: card, installment: { n: 3, total: 10, groupId: 'g1' } }),
    tx(at(prev, 3), -45_090, 'EXPENSE', 'mercado', 'Supermercado Carrefour'),
    tx(at(prev, 17), -12_345, 'EXPENSE', 'mercado', 'Atacadao'),
    tx(at(prev, 20), -66_000, 'EXPENSE', 'educacao', 'Pix Escola'),
    tx(at(prev, 5), 500_000, 'INCOME', 'salario', 'Salario'),
  ] as never);
  await h.app.inject({ method: 'POST', url: '/v1/agent/fixed-expenses', payload: { name: 'Aluguel', categoryKey: 'moradia', amountMinor: 150_000, dueDay: 5, recurrence: 'monthly' }, headers: await auth() });
  await h.app.inject({ method: 'POST', url: '/v1/agent/loans', payload: { creditor: 'Banco X', kind: 'emprestimo', balanceMinor: 1_000_000, monthlyRate: 0.03, installmentMinor: 59_047, installmentsLeft: 24, dueDay: 8 }, headers: await auth() });

  systems = [];
  seen = [];
  script = [];
  h.ctx.llm = {
    generate: async () => '',
    chat: async ({ system, contents }) => {
      systems.push(system);
      seen.push(JSON.parse(JSON.stringify(contents)));
      const next = script.shift();
      if (!next) throw new Error('roteiro acabou');
      return next;
    },
  };
});

describe('dividas do mes (lista unica)', () => {
  it('junta fatura, parcelamento, fixo e emprestimo; parcela no cartao nao soma duas vezes', async () => {
    const o = await listObligations(h.ctx, userId);
    const byName = Object.fromEntries(o.items.map((i) => [i.name, i]));
    expect(byName['Fatura NEO VISA']).toMatchObject({ kind: 'fatura', monthMinor: 129_712, inInvoice: false });
    expect(byName['Geladeira 03/10']).toMatchObject({ kind: 'parcelamento', monthMinor: 30_000, remainingInstallments: 7, remainingMinor: 210_000, inInvoice: true });
    expect(byName['Aluguel']).toMatchObject({ kind: 'fixo', monthMinor: 150_000, dueDay: 5 });
    expect(byName['Banco X']).toMatchObject({ kind: 'emprestimo', monthMinor: 59_047, remainingMinor: 1_000_000 });
    expect(o.byKind).toEqual({ fatura: 129_712, parcelamento: 0, fixo: 150_000, emprestimo: 59_047 });
    expect(o.monthTotalMinor).toBe(129_712 + 150_000 + 59_047);
  });

  it('a rota das telas (Metas, Planejamento) devolve a mesma lista do chat', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/v1/agent/obligations', headers: await auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(JSON.parse(JSON.stringify(await listObligations(h.ctx, userId))));
  });
});

describe('Plutao com contexto financeiro', () => {
  it('"Quais minhas dívidas?" lista cartao e fixos com valores (lista unica)', async () => {
    script = [[{ functionCall: { name: 'listar_dividas', args: {} } }], [{ text: 'Suas dívidas do mês somam R$ 3.387,59: fatura NEO VISA R$ 1.297,12, aluguel R$ 1.500,00 e Banco X R$ 590,47. Quer um plano?' }]];
    const r = await chat('Quais minhas dívidas?');
    const res = toolResponse('listar_dividas');
    expect(res.totalDoMes).toBe(3387.59);
    const itens = (res.itens as { tipo: string; nome: string; valorNoMes: number }[]).map((i) => [i.tipo, i.nome, i.valorNoMes]);
    expect(itens).toEqual(expect.arrayContaining([['fatura', 'Fatura NEO VISA', 1297.12], ['fixo', 'Aluguel', 1500], ['emprestimo', 'Banco X', 590.47]]));
    expect(r.messages.at(-1).text).toContain('R$ 1.297,12');
    // O resumo vai junto do prompt, com a data de hoje e as dividas.
    expect(systems[0]).toContain('CONTEXTO FINANCEIRO ATUAL');
    const ctx = JSON.parse(systems[0]!.split('\n').at(-1)!);
    expect(ctx).toMatchObject({ mesAtual: cur, saldoEmContas: 2500, dividasDoMes: { total: 3387.59, faturas: 1297.12, gastosFixos: 1500, emprestimos: 590.47 } });
    expect(systems[0]).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/); // nada de CPF
  });

  it('"Quanto gastei com mercado em <mes>?" soma a categoria certa no mes certo', async () => {
    script = [[{ functionCall: { name: 'consultar_gastos', args: { mes: prev, categoria: 'Mercado' } } }], [{ text: 'Foram R$ 574,35 com mercado.' }]];
    const r = await chat('Quanto gastei com mercado no mês passado?');
    expect(toolResponse('consultar_gastos')).toMatchObject({ mes: prev, categoria: 'Mercado', total: 574.35, quantidade: 2 });
    expect(r.messages.at(-1).text).toBe('Foram R$ 574,35 com mercado.');
  });

  it('numero que veio so do contexto conta como conferido (nao e cortado)', async () => {
    script = [[{ text: 'Seu saldo em contas é R$ 2.500,00. Quer ver as dívidas?' }]];
    const r = await chat('Qual meu saldo?');
    expect(r.messages.at(-1).text).toBe('Seu saldo em contas é R$ 2.500,00. Quer ver as dívidas?');
  });

  it('cache de 5 min; escrita (tela ou chat) atualiza na hora', async () => {
    const t0 = new Date();
    const a = await financialContext(h.ctx, userId, t0);
    await h.ctx.col.accounts.updateOne({ _id: checking }, { $set: { balanceMinor: 999_900 } });
    expect((await financialContext(h.ctx, userId, new Date(t0.getTime() + 60_000))).saldoEmContas).toBe(a.saldoEmContas);
    expect((await financialContext(h.ctx, userId, new Date(t0.getTime() + CONTEXT_TTL_MS + 1))).saldoEmContas).toBe(9999);
    // Novo gasto fixo pela tela: o proximo contexto ja traz.
    await h.app.inject({ method: 'POST', url: '/v1/agent/fixed-expenses', payload: { name: 'Internet', categoryKey: 'moradia', amountMinor: 12_000, dueDay: 15, recurrence: 'monthly' }, headers: await auth() });
    const c = await financialContext(h.ctx, userId, new Date(t0.getTime() + CONTEXT_TTL_MS + 2));
    expect(c.dividasDoMes.gastosFixos).toBe(1620);
  });
});
