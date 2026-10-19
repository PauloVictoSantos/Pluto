import type { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ITEM_ID, fakeAccount, fakeItem, fakeTx } from '../../integrations/pluggy/fixtures';
import type { PluggyTransaction } from '../../integrations/pluggy/gateway';
import { startHarness, type Harness } from '../../test/harness';
import { syncConnection } from '../sync/service';

// Fase 1 da camada analitica: dados limpos antes de qualquer modelo.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

let userId: ObjectId;
let connId: ObjectId;
const NOW = new Date('2026-10-16T12:00:00Z');
const req = async (method: 'GET' | 'PATCH', url: string, payload?: object) =>
  h.app.inject({ method, url, payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });
const sync = () => syncConnection({ col: h.ctx.col, pluggy: h.pluggy, crypto: h.ctx.crypto, now: () => NOW }, connId, { force: true });
const txOf = (pluggyTransactionId: string) => h.ctx.col.transactions.findOne({ pluggyTransactionId });

const pix = (id: string, doc: string, description: string, date = '2026-10-10T14:31:07Z'): PluggyTransaction =>
  fakeTx({
    id,
    description,
    category: 'Transfer - PIX',
    amount: 450,
    date: new Date(date),
    paymentData: { receiver: { documentNumber: { type: 'CPF', value: doc }, name: 'x' }, boletoMetadata: null },
  });

async function seed(txs: PluggyTransaction[]) {
  userId = (await h.createUser()).id;
  connId = (
    await h.ctx.col.connections.insertOne({
      userId, pluggyItemIdEnc: h.ctx.crypto.encrypt(ITEM_ID), pluggyItemIdHash: h.ctx.crypto.hash(ITEM_ID), source: 'MEU_PLUGGY', connectorId: 200,
      institutionName: 'Banco Bradesco', imageUrl: null, primaryColor: null, status: 'UPDATED', needsAction: false, active: true, consentExpiresAt: null,
      lastSyncAt: null, lastTransactionsSyncAt: null, lastError: null, syncingUntil: null, removedAt: null, createdAt: NOW, updatedAt: NOW,
    } as never)
  ).insertedId;
  h.pluggy.items.set(ITEM_ID, fakeItem());
  h.pluggy.accounts.set(ITEM_ID, [fakeAccount()]);
  h.pluggy.transactions.set('acc-checking', txs);
  await sync();
}

describe('Pix por destinatario (RN-D02)', () => {
  it('guarda so o hash do CPF e a regra vale para o mesmo destinatario, nao para o mesmo nome', async () => {
    await seed([
      pix('a1', '123.456.789-09', 'PIX ENVIADO JOAO SILVA'),
      pix('a2', '12345678909', 'PIX ENVIADO - DES J SILVA 05/09'),
      pix('b1', '98765432100', 'PIX ENVIADO JOAO SILVA'),
    ]);
    const a1 = await txOf('a1'), a2 = await txOf('a2'), b1 = await txOf('b1');
    expect(a1!.counterpartyKey).toMatch(/^cp:/);
    expect(a1!.counterpartyKey).toBe(a2!.counterpartyKey);
    expect(b1!.counterpartyKey).not.toBe(a1!.counterpartyKey);
    // O CPF nunca e gravado.
    expect(JSON.stringify(await h.ctx.col.transactions.find({}).toArray())).not.toContain('12345678909');

    const similar = (await req('GET', `/v1/transactions/${a1!._id.toHexString()}/similar`)).json();
    expect(similar).toMatchObject({ count: 2, byCounterparty: true });

    const res = await req('PATCH', `/v1/transactions/${a1!._id.toHexString()}/category`, { categoryKey: 'educacao', applyToSimilar: true });
    expect(res.json()).toMatchObject({ updated: 2 });
    expect((await txOf('a2'))!.categoryKey).toBe('educacao');
    expect((await txOf('b1'))!.categoryKey).not.toBe('educacao');

    // Pix novo para o mesmo CPF herda o rotulo na proxima sincronizacao.
    h.pluggy.transactions.set('acc-checking', [...h.pluggy.transactions.get('acc-checking')!, pix('a3', '12345678909', 'PIX ENVIADO JOAO')]);
    await sync();
    expect(await txOf('a3')).toMatchObject({ categoryKey: 'educacao', categorySource: 'RULE' });

    const rules = (await req('GET', '/v1/category-rules')).json();
    expect(rules[0]).toMatchObject({ byCounterparty: true, categoryKey: 'educacao' });
    expect(rules[0].label).not.toMatch(/^cp:/);
  });
});

describe('qualidade do dado', () => {
  it('marca horario falso (so data), le parcela da descricao e deduplica pendente liquidada com outro id', async () => {
    await seed([
      fakeTx({ id: 'h1', date: new Date('2026-10-14T23:00:00.000Z') }),
      fakeTx({ id: 'h2', date: new Date('2026-10-14T18:42:13.000Z') }),
      fakeTx({ id: 'parc', description: 'SHOPEE *SHPSTEPARC07/09', amount: 59.9, date: new Date('2026-10-12T10:11:12Z') }),
      fakeTx({ id: 'pend', description: 'IFOOD *RESTAURANTE', amount: 42, status: 'PENDING' as never, date: new Date('2026-10-13T23:00:00Z') }),
      fakeTx({ id: 'post', description: 'IFOOD RESTAURANTE', amount: 42, date: new Date('2026-10-14T15:20:01Z') }),
    ]);
    expect((await txOf('h1'))!.hasTime).toBe(false);
    expect((await txOf('h2'))!.hasTime).toBe(true);
    expect((await txOf('parc'))!.installment).toMatchObject({ n: 7, total: 9 });

    const pend = await txOf('pend'), post = await txOf('post');
    expect(pend!.deletedAt).toBeInstanceOf(Date);
    expect(pend!.duplicateOf).toEqual(post!._id);
    expect(post!.deletedAt).toBeNull();

    const list = (await req('GET', '/v1/transactions')).json();
    expect(list.items.map((t: { id: string }) => t.id)).not.toContain(pend!._id.toHexString());
    const h1 = (await txOf('h1'))!._id.toHexString();
    expect(list.items.find((t: { id: string }) => t.id === h1).hasTime).toBe(false);
  });
});

describe('compromissos', () => {
  it('detecta assinatura mensal e lista parcelas por vir', async () => {
    const sub = (id: string, date: string) => fakeTx({ id, description: 'NETFLIX.COM', category: 'Video streaming', amount: 39.9, date: new Date(date) });
    await seed([
      sub('n1', '2026-07-03T10:01:02Z'),
      sub('n2', '2026-08-03T10:01:02Z'),
      sub('n3', '2026-09-03T10:01:02Z'),
      sub('n4', '2026-10-03T10:01:02Z'),
      fakeTx({ id: 'parc', description: 'MAGALU PARC03/10', amount: 120, date: new Date('2026-10-08T10:11:12Z') }),
    ]);
    const res = await req('GET', '/v1/analytics/commitments');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recurring).toHaveLength(1);
    expect(body.recurring[0]).toMatchObject({ period: 30, amountMinor: -3990, count: 4, direction: 'out' });
    expect(body.recurring[0].nextDate.slice(0, 10)).toBe('2026-11-02');
    expect(body.installments).toEqual([expect.objectContaining({ n: 3, total: 10, remaining: 7, remainingMinor: -84000 })]);

    const list = (await req('GET', '/v1/transactions')).json();
    const n4 = (await txOf('n4'))!._id.toHexString();
    expect(list.items.find((t: { id: string }) => t.id === n4).recurring).toBe(true);
  });
});
