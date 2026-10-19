import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ShoppingEntryDoc, ShoppingListDoc } from '../../db/collections';
import { startHarness, type Harness } from '../../test/harness';
import { ensureList, planMonth } from './service';

const A = new ObjectId(), B = new ObjectId(), C = new ObjectId(), D = new ObjectId();
// B e D: limpeza, quase nunca comprados (o prior de um vem do outro).
const items = new Map<string, { category: 'mercearia' | 'limpeza' }>([
  [A.toHexString(), { category: 'mercearia' }],
  [B.toHexString(), { category: 'limpeza' }],
  [C.toHexString(), { category: 'mercearia' }],
  [D.toHexString(), { category: 'limpeza' }],
]);
const NOW = new Date('2026-10-01T12:00:00Z');

const entry = (itemId: ObjectId, bought: boolean, over: Partial<ShoppingEntryDoc> = {}): ShoppingEntryDoc => ({
  itemId, qty: 2, bought, boughtAt: bought ? NOW : null, priceEnc: null, suggested: false, class: null, reason: null, addedAt: NOW, removedAt: null, ...over,
});
const closedList = (month: string, entries: ShoppingEntryDoc[], dismissed: ObjectId[] = []): ShoppingListDoc => ({
  _id: new ObjectId(), userId: new ObjectId(), month, status: 'closed', entries, suggestions: [], rarely: [], dismissed, handledTxIds: [],
  createdAt: NOW, closedAt: NOW, updatedAt: NOW,
});

describe('planMonth (aprendizado da lista)', () => {
  it('comprado todo mes vira essencial com o motivo; nunca comprado vai para "costuma nao comprar"', () => {
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const closed = months.map((m) => closedList(m, [entry(A, true), entry(B, false), entry(D, false)]));
    const plan = planMonth(closed, items, '2026-10', 1, NOW);
    expect(plan.entries).toEqual([expect.objectContaining({ itemId: A, class: 'essential', suggested: true, qty: 2, bought: false })]);
    expect(plan.entries[0]!.reason).toBe('Comprado em 6 de 6 meses na lista');
    expect(plan.rarely.map((r) => r.itemId)).toEqual(expect.arrayContaining([B]));
  });

  it('partida a frio: comprado so no mes anterior e incerto, vira chip "talvez"', () => {
    const plan = planMonth([closedList('2026-09', [entry(A, true)])], items, '2026-10', 1, NOW);
    expect(plan.entries).toHaveLength(0);
    expect(plan.suggestions).toEqual([expect.objectContaining({ itemId: A, source: 'history' })]);
  });

  it('RN-L08: rejeitado 3 meses seguidos sai das sugestoes ate ser adicionado a mao de novo', () => {
    const rej = (m: string) => closedList(m, [entry(A, true), entry(C, false, { suggested: true, removedAt: NOW })]);
    const base = [closedList('2026-05', [entry(C, true)]), rej('2026-06'), rej('2026-07'), rej('2026-08')];
    expect(planMonth(base, items, '2026-09', 1, NOW).rarely.map((r) => r.itemId)).toContainEqual(C);
    // RN-L05: rejeicao nao conta como "nao comprado".
    const plan = planMonth(base, items, '2026-09', 1, NOW);
    expect([...plan.entries, ...plan.suggestions].some((x) => x.itemId.equals(C))).toBe(false);
    // Adicionado a mao em setembro: volta a ser sugerido.
    const again = [...base, closedList('2026-09', [entry(C, true, { suggested: false })])];
    const p2 = planMonth(again, items, '2026-10', 1, NOW);
    expect([...p2.entries, ...p2.suggestions].some((x) => x.itemId.equals(C))).toBe(true);
  });

  it('e reproduzivel com a mesma semente (Thompson sampling)', () => {
    const closed = ['2026-06', '2026-07', '2026-08', '2026-09'].map((m, i) => closedList(m, [entry(A, i % 2 === 0), entry(B, i % 2 === 1)]));
    expect(planMonth(closed, items, '2026-10', 42, NOW)).toEqual(planMonth(closed, items, '2026-10', 42, NOW));
  });
});

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

describe('rotas da lista de compras', () => {
  let userId: ObjectId;
  const req = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });

  it('padroniza com o Gemini, cria o item com o nome digitado como apelido e soma quantidade repetida', async () => {
    userId = (await h.createUser()).id;
    const calls: { prompt: string }[] = [];
    h.ctx.llm = { generate: async (i) => (calls.push(i), JSON.stringify({ name: 'leite integral', category: 'laticinios', unit: 'L' })) };

    const r = (await req('POST', '/v1/shopping/items/resolve', { raw: 'Leite Integral 1L Itambé' })).json();
    expect(r).toEqual({ item: null, proposal: { name: 'Leite integral', category: 'laticinios', unit: 'L' }, source: 'gemini' });
    // RN-I02: o Gemini so recebe o nome digitado e as categorias.
    expect(Object.keys(JSON.parse(calls[0]!.prompt))).toEqual(['raw', 'categories']);

    // Sem confirmacao, nome desconhecido nao entra.
    expect((await req('POST', '/v1/shopping/list/entries', { raw: 'Leite Integral 1L Itambé', qty: 6 })).statusCode).toBe(422);
    let list = (await req('POST', '/v1/shopping/list/entries', { raw: 'Leite Integral 1L Itambé', qty: 6, confirm: r.proposal })).json();
    expect(list.entries).toEqual([expect.objectContaining({ name: 'Leite integral', qty: 6, suggested: false })]);

    // O nome digitado virou apelido: proxima vez casa direto no catalogo, sem Gemini, e soma (RN-L02).
    expect((await req('POST', '/v1/shopping/items/resolve', { raw: 'leite integral 1l itambe' })).json().source).toBe('catalog');
    list = (await req('POST', '/v1/shopping/list/entries', { raw: 'leite integral 1l itambe', qty: 2 })).json();
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0].qty).toBe(8);
    expect(calls).toHaveLength(1);
  });

  it('Gemini fora do ar ou resposta invalida cai na proposta local (RN-I03)', async () => {
    userId = (await h.createUser()).id;
    h.ctx.llm = { generate: async () => 'isto nao e json' };
    expect((await req('POST', '/v1/shopping/items/resolve', { raw: 'pão de queijo' })).json()).toEqual({
      item: null,
      proposal: { name: 'Pão de queijo', category: 'outros', unit: 'un' },
      source: 'local',
    });
  });

  it('marca com data, guarda o preco cifrado, desmarca apagando a data e desfaz a remocao (RN-L03)', async () => {
    userId = (await h.createUser()).id;
    h.ctx.llm = null;
    const add = (await req('POST', '/v1/shopping/list/entries', { raw: 'Arroz', qty: 1, confirm: { name: 'Arroz', category: 'mercearia', unit: 'kg' } })).json();
    const id = add.entries[0].itemId;

    let list = (await req('PATCH', `/v1/shopping/list/entries/${id}`, { bought: true, priceMinor: 2490 })).json();
    expect(list.entries[0]).toMatchObject({ bought: true, priceMinor: 2490 });
    expect(list.entries[0].boughtAt).not.toBeNull();
    const raw = await h.ctx.col.shoppingLists.findOne({ userId });
    expect(raw!.entries[0]!.priceEnc).toMatch(/^v1\./);

    list = (await req('PATCH', `/v1/shopping/list/entries/${id}`, { bought: false })).json();
    expect(list.entries[0]).toMatchObject({ bought: false, boughtAt: null, priceMinor: null });

    expect((await req('PATCH', `/v1/shopping/list/entries/${id}`, { removed: true })).json().entries).toHaveLength(0);
    expect((await req('PATCH', `/v1/shopping/list/entries/${id}`, { removed: false })).json().entries).toHaveLength(1);
  });

  it('fecha no virar do mes e abre a nova com sugestoes (RN-L01, RN-L04)', async () => {
    userId = (await h.createUser()).id;
    const sept = new Date('2026-09-10T15:00:00Z');
    const { list } = await ensureList(h.ctx, userId, sept);
    const item = await h.ctx.col.shoppingItems.insertOne({
      userId, name: 'Café', nameNorm: 'cafe', aliases: [], category: 'mercearia', unit: 'pct', createdAt: sept, updatedAt: sept,
    } as never);
    await h.ctx.col.shoppingLists.updateOne({ _id: list._id }, { $set: { entries: [entry(item.insertedId, true)] } });

    // Dia 1 de outubro, 00:05 em Manaus (04:05 UTC).
    const { list: oct } = await ensureList(h.ctx, userId, new Date('2026-10-01T04:05:00Z'));
    expect(oct.month).toBe('2026-10');
    expect((await h.ctx.col.shoppingLists.findOne({ _id: list._id }))!.status).toBe('closed');
    expect(oct.suggestions.map((s) => s.itemId)).toContainEqual(item.insertedId);
    expect(await h.ctx.col.shoppingLists.countDocuments({ userId, status: 'open' })).toBe(1);

    const hist = (await req('GET', '/v1/shopping/lists')).json();
    expect(hist).toEqual([{ month: '2026-09', bought: 1, total: 1 }]);
  });

  it('pergunta o que foi comprado numa compra de mercado e so marca o que o usuario escolheu (RN-L07)', async () => {
    userId = (await h.createUser()).id;
    h.ctx.llm = null;
    const mk = async (name: string) =>
      (await req('POST', '/v1/shopping/list/entries', { raw: name, qty: 1, confirm: { name, category: 'mercearia', unit: 'un' } })).json();
    await mk('Feijão');
    const list0 = await mk('Açúcar');
    const [feijao, acucar] = list0.entries.map((e: { itemId: string }) => e.itemId);
    const { insertedId } = await h.ctx.col.transactions.insertOne({
      userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: 'm1', date: new Date(), description: 'SUPERMERCADO NORTE',
      descriptionNorm: 'supermercado norte', matchKey: 'supermercado norte', merchant: null, amountMinor: -15000, currency: 'BRL', type: 'EXPENSE', status: 'POSTED',
      pluggyCategory: 'Groceries', pluggyCategoryId: null, pluggyBillId: null, categoryKey: 'mercado', installment: null, categoryId: null, categorySource: null,
      categoryConfidence: null, invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    } as never);

    const list = (await req('GET', '/v1/shopping/list')).json();
    expect(list.marketPrompt).toMatchObject({ transactionId: insertedId.toHexString(), amountMinor: -15000 });
    // Nada marcado sozinho.
    expect(list.entries.every((e: { bought: boolean }) => !e.bought)).toBe(true);

    const after = (await req('POST', '/v1/shopping/list/market', { transactionId: insertedId.toHexString(), itemIds: [feijao] })).json();
    expect(after.entries.find((e: { itemId: string }) => e.itemId === feijao).bought).toBe(true);
    expect(after.entries.find((e: { itemId: string }) => e.itemId === acucar).bought).toBe(false);
    expect(after.marketPrompt).toBeNull();
  });
});
