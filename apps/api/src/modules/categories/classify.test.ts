import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../db/migrations';
import { matchKeyOf } from '../../lib/text';
import { startHarness, type Harness } from '../../test/harness';
import { classifyUncertain } from './classify';
import { applyUserRules } from './rules';

// Pix e forma de pagamento, nao categoria (doc. Melhorias, passo 8): regras > palavras > IA (so
// empresa, com consentimento) > "Revisar".

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId;
let prompts: string[];
let answer: (items: { i: number; texto: string }[]) => { i: number; categoria: string; confianca: number }[];
const checking = new ObjectId();
const tx = (description: string, amountMinor: number, extra: Record<string, unknown> = {}) => ({
  userId, accountId: checking, connectionId: new ObjectId(), pluggyTransactionId: String(new ObjectId()), date: new Date(), description,
  descriptionNorm: description.toLowerCase(), matchKey: matchKeyOf(description), merchant: null, amountMinor, currency: 'BRL', type: amountMinor < 0 ? 'EXPENSE' : 'INCOME',
  status: 'POSTED', pluggyCategory: 'Transfer - PIX', pluggyCategoryId: null, pluggyBillId: null, categoryKey: amountMinor < 0 ? 'outros' : 'entradas', installment: null,
  categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  paymentMethod: 'pix', counterpartyKind: null, classifiedAt: null, ...extra,
});
const get = async (description: string) => (await h.ctx.col.transactions.findOne({ userId, description }))!;
const consent = (on: boolean) => h.ctx.col.users.updateOne({ _id: userId }, { $set: { 'settings.aiConsentAt': on ? new Date().toISOString() : null } });
const auth = async () => ({ authorization: `Bearer ${await h.token(userId)}` });

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
  prompts = [];
  answer = (items) => items.map(({ i }) => ({ i, categoria: 'educacao', confianca: 0.92 }));
  h.ctx.llm = {
    generate: async ({ prompt }) => {
      prompts.push(prompt);
      return JSON.stringify({ itens: answer(JSON.parse(prompt).pagamentos) });
    },
  };
});

describe('classificacao em camadas do Pix', () => {
  it('Pix de escola cai em Educacao pelo texto, sem IA', async () => {
    await h.ctx.col.transactions.insertOne(tx('PIX ENVIADO COLEGIO SAO JOSE', -66_000, { counterpartyKind: 'pj' }) as never);
    await consent(true);
    expect(await classifyUncertain(h.ctx, userId)).toEqual({ keyword: 1, llm: 0, review: 0 });
    expect(await get('PIX ENVIADO COLEGIO SAO JOSE')).toMatchObject({ categoryKey: 'educacao', categorySource: 'KEYWORD', needsReview: false, paymentMethod: 'pix' });
    expect(prompts).toHaveLength(0);
  });

  it('empresa sem pista no texto: IA com consentimento; abaixo de 70% vai para Revisar com sugestao', async () => {
    await h.ctx.col.transactions.insertMany([tx('PIX ENVIADO ABC SERVICOS LTDA', -50_000, { counterpartyKind: 'pj' }), tx('PIX ENVIADO XPTO EIRELI', -9_000, { counterpartyKind: 'pj' })] as never);
    await consent(true);
    answer = (items) => items.map(({ i, texto }) => (texto.includes('ABC') ? { i, categoria: 'educacao', confianca: 0.91 } : { i, categoria: 'lazer', confianca: 0.5 }));
    expect(await classifyUncertain(h.ctx, userId)).toEqual({ keyword: 0, llm: 1, review: 1 });
    expect(await get('PIX ENVIADO ABC SERVICOS LTDA')).toMatchObject({ categoryKey: 'educacao', categorySource: 'LLM', categoryConfidence: 0.91 });
    expect(await get('PIX ENVIADO XPTO EIRELI')).toMatchObject({ categoryKey: 'outros', needsReview: true, aiSuggestion: { categoryKey: 'lazer', p: 0.5 } });
    // So o nome da empresa e o valor vao para a IA: nada de conta, CPF ou outras transacoes.
    const sent = JSON.parse(prompts[0]!).pagamentos.map((p: { texto: string; valor: number }) => [p.texto, p.valor]).sort();
    expect(sent).toEqual([['PIX ENVIADO ABC SERVICOS LTDA', 500], ['PIX ENVIADO XPTO EIRELI', 90]]);
  });

  it('Pix para pessoa nunca vai para a IA; sem consentimento, nada vai', async () => {
    await h.ctx.col.transactions.insertMany([tx('PIX ENVIADO MARIA DA SILVA', -20_000, { counterpartyKind: 'pf' }), tx('PIX ENVIADO ABC SERVICOS LTDA', -50_000, { counterpartyKind: 'pj' })] as never);
    await consent(false);
    expect(await classifyUncertain(h.ctx, userId)).toEqual({ keyword: 0, llm: 0, review: 2 });
    expect(prompts).toHaveLength(0);
    await consent(true);
    await h.ctx.col.transactions.updateMany({ userId }, { $set: { classifiedAt: null } });
    await classifyUncertain(h.ctx, userId);
    expect(prompts.join()).not.toContain('MARIA');
    expect(await get('PIX ENVIADO MARIA DA SILVA')).toMatchObject({ needsReview: true });
  });

  it('confirmar no Revisar vira regra: o proximo Pix ao mesmo destinatario ja vem certo', async () => {
    await h.ctx.col.transactions.insertOne(tx('PIX ENVIADO MARIA DA SILVA', -20_000, { counterpartyKind: 'pf', counterpartyKey: 'cp:maria' }) as never);
    await classifyUncertain(h.ctx, userId);
    const review = (await h.app.inject({ method: 'GET', url: '/v1/transactions?review=1', headers: await auth() })).json();
    expect(review.items.map((t: { description: string; paymentMethod: string }) => [t.description, t.paymentMethod])).toEqual([['PIX ENVIADO MARIA DA SILVA', 'pix']]);
    await h.app.inject({ method: 'PATCH', url: `/v1/transactions/${review.items[0].id}/category`, payload: { categoryKey: 'educacao', applyToSimilar: true }, headers: await auth() });
    expect(await get('PIX ENVIADO MARIA DA SILVA')).toMatchObject({ categoryKey: 'educacao', needsReview: false });
    await h.ctx.col.transactions.insertOne(tx('PIX ENVIADO MARIA S', -20_000, { counterpartyKind: 'pf', counterpartyKey: 'cp:maria', needsReview: true }) as never);
    await applyUserRules(h.ctx.col, userId);
    expect(await get('PIX ENVIADO MARIA S')).toMatchObject({ categoryKey: 'educacao', categorySource: 'RULE', needsReview: false });
    expect((await h.app.inject({ method: 'GET', url: '/v1/transactions?review=1', headers: await auth() })).json().items).toEqual([]);
  });

  it('gastos por categoria somam o total, sem Pix como categoria', async () => {
    await h.ctx.col.transactions.insertMany([
      tx('PIX ENVIADO COLEGIO SAO JOSE', -66_000, { counterpartyKind: 'pj' }),
      tx('PIX ENVIADO MARIA DA SILVA', -63_712, { counterpartyKind: 'pf' }),
      tx('COMPRA SUPERMERCADO BOM PRECO', -10_000, { paymentMethod: 'debito', pluggyCategory: 'Groceries', categoryKey: 'mercado' }),
    ] as never);
    await classifyUncertain(h.ctx, userId);
    const s = (await h.app.inject({ method: 'GET', url: '/v1/dashboard/spending', headers: await auth() })).json();
    expect(s.categories.map((c: { key: string }) => c.key).sort()).toEqual(['educacao', 'mercado', 'outros']);
    expect(s.categories.reduce((t: number, c: { spentMinor: number }) => t + c.spentMinor, 0)).toBe(s.totalMinor);
    expect(s.totalMinor).toBe(139_712);
    // Pix como filtro: as duas transferencias, de categorias diferentes.
    const pix = (await h.app.inject({ method: 'GET', url: '/v1/transactions?paymentMethod=pix', headers: await auth() })).json();
    expect(pix.items).toHaveLength(2);
  });
});

describe('migracao', () => {
  it('"Pix e transferencias" sai das categorias; forma de pagamento preenchida', async () => {
    const card = new ObjectId();
    const now = new Date();
    await h.ctx.col.accounts.insertOne({
      _id: card, userId, connectionId: new ObjectId(), pluggyAccountId: 'c1', type: 'CREDIT_CARD', name: 'Cartao', numberMasked: '1234', balanceMinor: 0, currency: 'BRL',
      creditLimitMinor: null, availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: now, updatedAt: now,
    } as never);
    // Transacoes de antes do campo paymentMethod.
    const old: Record<string, unknown> = tx('PIX ENVIADO JOAO', -5_000);
    const oldCard: Record<string, unknown> = tx('LOJA X', -3_000, { accountId: card, categoryKey: 'compras' });
    delete old.paymentMethod;
    delete oldCard.paymentMethod;
    await h.ctx.col.transactions.insertMany([{ ...old, categoryKey: 'pix-enviado', categorySource: 'MANUAL' }, oldCard] as never);
    await h.ctx.col.categoryRules.insertOne({ userId, matchKey: 'joao', direction: 'out', categoryKey: 'pix-enviado', createdAt: new Date(), updatedAt: new Date() } as never);
    await runMigrations(h.db);
    expect(await get('PIX ENVIADO JOAO')).toMatchObject({ categoryKey: 'outros', categorySource: null, paymentMethod: 'pix', classifiedAt: null });
    expect(await get('LOJA X')).toMatchObject({ paymentMethod: 'credito' });
    expect(await h.ctx.col.categoryRules.countDocuments({ categoryKey: 'pix-enviado' })).toBe(0);
  });
});
