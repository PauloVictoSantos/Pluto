import type { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ITEM_ID, fakeAccount, fakeItem, fakeTx } from '../../integrations/pluggy/fixtures';
import { startHarness, type Harness } from '../../test/harness';
import { syncConnection } from '../sync/service';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

let userId: ObjectId;
let connId: ObjectId;
const req = async (method: 'GET' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });
const sync = () => syncConnection({ col: h.ctx.col, pluggy: h.pluggy, crypto: h.ctx.crypto }, connId, { force: true });
const txOf = (pluggyTransactionId: string) => h.ctx.col.transactions.findOne({ pluggyTransactionId });

async function seed() {
  userId = (await h.createUser()).id;
  const now = new Date();
  connId = (
    await h.ctx.col.connections.insertOne({
      userId, pluggyItemIdEnc: h.ctx.crypto.encrypt(ITEM_ID), pluggyItemIdHash: h.ctx.crypto.hash(ITEM_ID), source: 'MEU_PLUGGY', connectorId: 200,
      institutionName: 'Banco Bradesco', imageUrl: null, primaryColor: null, status: 'UPDATED', needsAction: false, active: true, consentExpiresAt: null,
      lastSyncAt: null, lastTransactionsSyncAt: null, lastError: null, syncingUntil: null, removedAt: null, createdAt: now, updatedAt: now,
    } as never)
  ).insertedId;
  h.pluggy.items.set(ITEM_ID, fakeItem());
  h.pluggy.accounts.set(ITEM_ID, [fakeAccount()]);
  h.pluggy.transactions.set('acc-checking', [
    fakeTx({ id: 'p1', description: 'PIX ENVIADO FACULDADE NORTE COM SALDO', category: 'Transfer - PIX', amount: 450 }),
    fakeTx({ id: 'p2', description: 'PIX ENVIADO - DES  Faculdade Norte 05/09 - DOCTO: 123', category: 'Transfer - PIX', amount: 450 }),
    fakeTx({ id: 'p3', description: 'PIX RECEBIDO FACULDADE NORTE', category: 'Transfer - PIX', type: 'CREDIT', amount: 50 }),
    fakeTx({ id: 'p4', description: 'PIX ENVIADO OUTRA PESSOA', category: 'Transfer - PIX', amount: 20 }),
  ]);
  await sync();
}

describe('categoria escolhida pelo usuario', () => {
  it('muda so a transacao e sobrevive a nova sincronizacao (RN-12)', async () => {
    await seed();
    const p1 = await txOf('p1');
    // Pix e forma de pagamento: "FACULDADE" no texto ja classifica como Educacao (doc. Melhorias, passo 8).
    expect(p1).toMatchObject({ categoryKey: 'educacao', categorySource: 'KEYWORD', paymentMethod: 'pix' });

    const res = await req('PATCH', `/v1/transactions/${p1!._id.toHexString()}/category`, { categoryKey: 'saude' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 1, ruleId: null });

    await sync();
    expect(await txOf('p1')).toMatchObject({ categoryKey: 'saude', categorySource: 'MANUAL', type: 'EXPENSE' });
    expect((await txOf('p2'))!.categoryKey).toBe('educacao');
  });

  it('regra aplica ao mesmo destinatario no mesmo sentido, inclusive em transacoes novas', async () => {
    await seed();
    const p1 = await txOf('p1');
    const similar = (await req('GET', `/v1/transactions/${p1!._id.toHexString()}/similar`)).json();
    expect(similar).toMatchObject({ matchKey: 'faculdade norte', count: 2, byCounterparty: false });

    const res = (await req('PATCH', `/v1/transactions/${p1!._id.toHexString()}/category`, { categoryKey: 'educacao', applyToSimilar: true })).json();
    expect(res.updated).toBe(2);
    expect(await txOf('p2')).toMatchObject({ categoryKey: 'educacao', categorySource: 'RULE' });
    expect((await txOf('p3'))!.categoryKey).toBe('entradas'); // Pix recebido nao e mensalidade
    expect(await txOf('p4')).toMatchObject({ categoryKey: 'outros', needsReview: true }); // Pix para pessoa: Revisar

    h.pluggy.transactions.get('acc-checking')!.push(fakeTx({ id: 'p5', description: 'PIX ENVIADO FACULDADE NORTE', category: 'Transfer - PIX', amount: 450 }));
    await sync();
    expect(await txOf('p5')).toMatchObject({ categoryKey: 'educacao', categorySource: 'RULE' });

    // Gasto do mes passa a aparecer em Educacao
    const rules = (await req('GET', '/v1/category-rules')).json();
    expect(rules).toEqual([expect.objectContaining({ matchKey: 'faculdade norte', direction: 'out', categoryKey: 'educacao' })]);

    // Remover a regra devolve a categoria do Pluggy, mas mantem a escolha manual
    expect((await req('DELETE', `/v1/category-rules/${rules[0].id}`)).statusCode).toBe(204);
    expect(await txOf('p2')).toMatchObject({ categoryKey: 'outros', categorySource: null, type: 'EXPENSE' });
    expect((await txOf('p1'))!.categoryKey).toBe('educacao');
  });

  it('"Entre minhas contas" tira a transacao dos gastos (RN-13)', async () => {
    await seed();
    const p4 = await txOf('p4');
    await req('PATCH', `/v1/transactions/${p4!._id.toHexString()}/category`, { categoryKey: 'entre-contas' });
    expect((await txOf('p4'))!.type).toBe('TRANSFER');
  });

  it('valida categoria e dono da transacao', async () => {
    await seed();
    const p1 = await txOf('p1');
    expect((await req('PATCH', `/v1/transactions/${p1!._id.toHexString()}/category`, { categoryKey: 'nao-existe' })).statusCode).toBe(400);
    const other = (await h.createUser({ email: 'outro@pluto.test' })).id;
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/v1/transactions/${p1!._id.toHexString()}/category`,
      payload: { categoryKey: 'educacao' },
      headers: { authorization: `Bearer ${await h.token(other)}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
