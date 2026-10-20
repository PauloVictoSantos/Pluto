import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../test/harness';
import { groupMerchants } from './service';

// Estabelecimentos agrupados por similaridade + IA, editaveis pelo usuario.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId, card: ObjectId, seq = 0;
let prompts: string[];
const NOW = new Date('2026-10-16T15:00:00Z');

const tx = (matchKey: string, amountMinor: number, over: Record<string, unknown> = {}) => ({
  userId, accountId: card, connectionId: new ObjectId(), pluggyTransactionId: `m${seq++}`, date: new Date(NOW.getTime() - seq * 3_600_000), description: matchKey.toUpperCase(),
  descriptionNorm: matchKey, matchKey, merchant: null, amountMinor, currency: 'BRL', type: 'EXPENSE', status: 'POSTED', pluggyCategory: 'Taxi and ride-hailing',
  pluggyCategoryId: null, pluggyBillId: null, categoryKey: 'transporte', installment: null, categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null,
  tags: [], notes: null, hidden: false, deletedAt: null, hasTime: true, counterpartyKey: null, createdAt: NOW, updatedAt: NOW, ...over,
});
const req = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });
const groupOf = async (matchKey: string) => {
  const t = await h.ctx.col.transactions.findOne({ userId, matchKey });
  return { cat: t!.categoryKey, src: t!.categorySource, group: t!.merchantGroupId ? (await h.ctx.col.merchantGroups.findOne({ _id: t!.merchantGroupId }))!.name : null };
};

beforeEach(async () => {
  await h.reset();
  prompts = [];
  userId = (await h.createUser()).id;
  card = new ObjectId();
  await h.ctx.col.accounts.insertOne({
    _id: card, userId, connectionId: new ObjectId(), pluggyAccountId: 'k', type: 'CREDIT_CARD', name: 'Cartão', numberMasked: null, balanceMinor: 0, currency: 'BRL',
    creditLimitMinor: null, availableCreditMinor: null, closingDay: null, dueDay: null, brand: null, syncError: null, createdAt: NOW, updatedAt: NOW,
  } as never);
  await h.ctx.col.transactions.insertMany([
    tx('uber trip sp', -2350),
    tx('uber trip sp', -1890),
    tx('uber uber trip help uber com', -3100),
    tx('99 pop', -1700),
    tx('99 pop', -2200),
    tx('ifood restaurante', -5400, { categoryKey: 'outros', pluggyCategory: 'Food' }),
    // Pix para pessoa: nunca vai ao Gemini.
    tx('joao da silva', -15_000, { accountId: new ObjectId(), categoryKey: 'pix-enviado', pluggyCategory: 'Transfer - PIX' }),
    // Escolha manual do usuario.
    tx('uber trip rj', -1000, { categoryKey: 'lazer', categorySource: 'MANUAL' }),
  ] as never);
  const groups: Record<string, [string, string]> = {
    'uber trip sp': ['Uber', 'transporte-app'],
    'uber uber trip help uber com': ['Uber', 'transporte-app'],
    'uber trip rj': ['Uber', 'transporte-app'],
    '99 pop': ['99', 'transporte-app'],
    'ifood restaurante': ['iFood', 'delivery'],
  };
  h.ctx.llm = {
    generate: async (i) => {
      prompts.push(i.prompt);
      const asked = JSON.parse(i.prompt).descricoes as string[];
      return JSON.stringify({ grupos: asked.filter((k) => groups[k]).map((k) => ({ texto: k, grupo: groups[k]![0], categoria: groups[k]![1] })) });
    },
  };
});

describe('agrupamento de estabelecimentos', () => {
  it('a IA agrupa so compras em estabelecimento; a escolha manual fica', async () => {
    const r = await groupMerchants(h.ctx, userId, NOW);
    expect(r.ai).toBe(5);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toMatch(/joao|15000|2350|-\d/);

    expect(await groupOf('uber trip sp')).toEqual({ cat: 'transporte-app', src: 'AI', group: 'Uber' });
    expect(await groupOf('uber uber trip help uber com')).toMatchObject({ group: 'Uber' });
    expect(await groupOf('99 pop')).toEqual({ cat: 'transporte-app', src: 'AI', group: '99' });
    expect(await groupOf('ifood restaurante')).toMatchObject({ cat: 'delivery', group: 'iFood' });
    expect(await groupOf('uber trip rj')).toMatchObject({ cat: 'lazer', src: 'MANUAL' });
    expect(await groupOf('joao da silva')).toMatchObject({ group: null, cat: 'pix-enviado' });

    // Descricao nova parecida entra pelo texto, sem chamar a IA.
    await h.ctx.col.transactions.insertOne(tx('uber br trip help', -1500) as never);
    expect(await groupMerchants(h.ctx, userId, NOW)).toEqual({ local: 1, ai: 0 });
    expect(prompts).toHaveLength(1);
    expect(await groupOf('uber br trip help')).toMatchObject({ group: 'Uber', cat: 'transporte-app' });
  });

  it('o usuario junta "99" em "Uber", troca categoria e tira descricao (vale como regra dele)', async () => {
    await groupMerchants(h.ctx, userId, NOW);
    let list = (await req('GET', '/v1/merchant-groups')).json();
    const uber = list.groups.find((g: { name: string }) => g.name === 'Uber');
    const nine = list.groups.find((g: { name: string }) => g.name === '99');

    list = (await req('POST', `/v1/merchant-groups/${nine.id}/merge`, { intoId: uber.id })).json();
    expect(list.groups.map((g: { name: string }) => g.name)).toEqual(['iFood', 'Uber']);
    expect(await groupOf('99 pop')).toEqual({ cat: 'transporte-app', src: 'RULE', group: 'Uber' });

    await req('PATCH', `/v1/merchant-groups/${uber.id}`, { name: 'Uber e 99', categoryKey: 'transporte' });
    expect(await groupOf('uber trip sp')).toEqual({ cat: 'transporte', src: 'RULE', group: 'Uber e 99' });

    await req('DELETE', `/v1/merchant-groups/${uber.id}/keys`, { key: '99 pop' });
    expect(await groupOf('99 pop')).toEqual({ cat: 'transporte', src: null, group: null });
    // A IA nao poe de volta no mesmo grupo.
    await groupMerchants(h.ctx, userId, NOW);
    expect((await groupOf('99 pop')).group).not.toBe('Uber e 99');

    const tlist = (await req('GET', '/v1/transactions')).json();
    expect(tlist.items.find((t: { description: string }) => t.description === 'UBER TRIP SP').merchantGroup).toBe('Uber e 99');
  });

  it('renomear vale para todas as compras da mesma descricao e pode voltar ao automatico', async () => {
    const t = await h.ctx.col.transactions.findOne({ userId, matchKey: 'ifood restaurante' });
    expect((await req('POST', `/v1/transactions/${t!._id.toHexString()}/rename`, { name: 'Restaurante da Ana' })).json()).toEqual({ name: 'Restaurante da Ana' });
    const list = (await req('GET', '/v1/transactions')).json();
    expect(list.items.find((x: { id: string }) => x.id === t!._id.toHexString()).nameOverride).toBe('Restaurante da Ana');
    // A IA nao mexe no nome dado pelo usuario.
    await groupMerchants(h.ctx, userId, NOW);
    expect(await groupOf('ifood restaurante')).toMatchObject({ group: 'Restaurante da Ana' });

    await req('POST', `/v1/transactions/${t!._id.toHexString()}/rename`, { name: null });
    const after = (await req('GET', '/v1/transactions')).json();
    expect(after.items.find((x: { id: string }) => x.id === t!._id.toHexString()).nameOverride).toBeNull();
  });

  it('com a IA desligada nas configuracoes, so similaridade local', async () => {
    await h.ctx.col.users.updateOne({ _id: userId }, { $set: { 'settings.aiEnabled': false } });
    expect(await groupMerchants(h.ctx, userId, NOW)).toEqual({ local: 0, ai: 0 });
    expect(prompts).toHaveLength(0);
  });
});
