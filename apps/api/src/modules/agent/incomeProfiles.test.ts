import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { matchKeyOf } from '../../lib/text';
import { startHarness, type Harness } from '../../test/harness';

// Configuracoes (doc. Melhorias, passo 6): perfis financeiros (max. 2, renda = soma) e o modal de
// regras de categoria (adicionar, mover, remover e salvar de uma vez).

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId;
const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });
const salario = { name: 'Salário', cover: 'violeta', netIncomeMinor: 500_000, payDay: 5, incomeType: 'clt' };
const freela = { name: 'Freela', cover: 'lima', netIncomeMinor: 200_000, payDay: 20, incomeType: 'autonomo', notes: 'Projetos de design' };

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
});

describe('perfis financeiros', () => {
  it('ate 2 perfis; o terceiro e bloqueado no servidor com mensagem clara', async () => {
    expect((await call('POST', '/v1/agent/income-profiles', salario)).statusCode).toBe(200);
    const two = await call('POST', '/v1/agent/income-profiles', freela);
    expect(two.json()).toMatchObject({ totalIncomeMinor: 700_000, max: 2 });
    expect(two.json().items.map((p: { name: string }) => p.name)).toEqual(['Salário', 'Freela']);
    const third = await call('POST', '/v1/agent/income-profiles', { ...salario, name: 'Aluguel recebido' });
    expect(third.statusCode).toBe(409);
    expect(third.json().error).toEqual({ code: 'PROFILE_LIMIT', message: 'Limite de 2 perfis. Edite ou exclua um perfil para criar outro.' });
    // Dois pedidos simultaneos tambem nao passam do limite.
    await call('DELETE', `/v1/agent/income-profiles/${two.json().items[1].id}`);
    const race = await Promise.all([call('POST', '/v1/agent/income-profiles', freela), call('POST', '/v1/agent/income-profiles', freela)]);
    expect(race.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await h.ctx.col.incomeProfiles.countDocuments({ userId })).toBe(2);
  });

  it('renda do plano = soma dos perfis; editar e excluir atualizam; renda fica criptografada', async () => {
    await call('POST', '/v1/agent/income-profiles', salario);
    const r = (await call('POST', '/v1/agent/income-profiles', freela)).json();
    let p = (await call('GET', '/v1/agent/profile')).json();
    expect(p).toMatchObject({ netIncomeMinor: 700_000, incomeFromProfiles: true });
    await call('PATCH', `/v1/agent/income-profiles/${r.items[1].id}`, { netIncomeMinor: 250_000, cover: 'oceano' });
    p = (await call('GET', '/v1/agent/profile')).json();
    expect(p.netIncomeMinor).toBe(750_000);
    // O limite do mes e recalculado com a renda nova.
    expect(await h.ctx.col.auditLogs.findOne({ userId, event: 'limit.recalculated', 'meta.reason': { $regex: 'income-profiles' } })).not.toBeNull();
    const raw = await h.ctx.col.incomeProfiles.findOne({ userId, name: 'Freela' });
    expect(raw?.netIncomeEnc).toMatch(/^v1\./);
    expect(JSON.stringify(raw)).not.toContain('250000');
    await call('DELETE', `/v1/agent/income-profiles/${r.items[0].id}`);
    await call('DELETE', `/v1/agent/income-profiles/${r.items[1].id}`);
    p = (await call('GET', '/v1/agent/profile')).json();
    expect(p.incomeFromProfiles).toBe(false);
  });

  it('perfil de outro usuario nao pode ser editado', async () => {
    const r = (await call('POST', '/v1/agent/income-profiles', salario)).json();
    const other = userId;
    userId = (await h.createUser({ email: 'outro@pluto.test' })).id;
    expect((await call('PATCH', `/v1/agent/income-profiles/${r.items[0].id}`, { name: 'x' })).statusCode).toBe(404);
    userId = other;
  });
});

describe('modal de regras de categoria', () => {
  const tx = (description: string, amountMinor: number, categoryKey: string) => ({
    userId, accountId: new ObjectId(), connectionId: new ObjectId(), pluggyTransactionId: String(new ObjectId()), date: new Date(), description,
    descriptionNorm: description.toLowerCase(), matchKey: matchKeyOf(description), merchant: null, amountMinor, currency: 'BRL', type: 'EXPENSE', status: 'POSTED',
    pluggyCategory: null, pluggyCategoryId: null, pluggyBillId: null, categoryKey, installment: null, categoryId: null, categorySource: null, categoryConfidence: null,
    invoiceId: null, tags: [], notes: null, hidden: false, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });

  it('adicionar, mover e remover estabelecimentos de uma vez no Salvar', async () => {
    await h.ctx.col.transactions.insertMany([tx('ATACADAO', -10_000, 'outros'), tx('CARREFOUR', -5_000, 'outros'), tx('PADARIA PAO', -1_500, 'outros')] as never);
    let rules = (await call('PUT', '/v1/category-rules', { create: [{ label: 'Atacadão', categoryKey: 'mercado' }, { label: 'Carrefour', categoryKey: 'mercado' }, { label: 'Padaria Pão', categoryKey: 'mercado' }] })).json();
    expect(rules).toHaveLength(3);
    const cat = async (d: string) => (await h.ctx.col.transactions.findOne({ userId, description: d }))!.categoryKey;
    expect([await cat('ATACADAO'), await cat('CARREFOUR'), await cat('PADARIA PAO')]).toEqual(['mercado', 'mercado', 'mercado']);

    const id = (label: string) => rules.find((r: { label: string }) => r.label === label).id;
    rules = (await call('PUT', '/v1/category-rules', { move: [{ id: id('Padaria Pão'), categoryKey: 'restaurantes' }], remove: [id('Carrefour')] })).json();
    expect(rules.map((r: { label: string; categoryKey: string }) => [r.label, r.categoryKey]).sort()).toEqual([['Atacadão', 'mercado'], ['Padaria Pão', 'restaurantes']]);
    expect(await cat('PADARIA PAO')).toBe('restaurantes');
    expect(await cat('CARREFOUR')).not.toBe('mercado'); // voltou para a categoria do banco
  });

  it('regra de outro usuario: nada e alterado', async () => {
    const other = await h.ctx.col.categoryRules.insertOne({ userId: new ObjectId(), matchKey: 'x', direction: 'out', categoryKey: 'mercado', createdAt: new Date(), updatedAt: new Date() } as never);
    const r = await call('PUT', '/v1/category-rules', { remove: [other.insertedId.toHexString()] });
    expect(r.statusCode).toBe(404);
    expect(await h.ctx.col.categoryRules.countDocuments({ _id: other.insertedId })).toBe(1);
  });
});
