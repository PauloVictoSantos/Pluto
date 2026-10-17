import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ITEM_ID, fakeAccount, fakeItem, fakeTx } from '../../integrations/pluggy/fixtures';
import { startHarness, type Harness } from '../../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

const alice = new ObjectId(), bob = new ObjectId();
const auth = async (u: ObjectId, authAgeSec = 0) => ({ authorization: `Bearer ${await h.token(u, { authAgeSec })}` });
const waitFor = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 50 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 20));
};

function seedItem(owner = alice) {
  h.pluggy.items.set(ITEM_ID, fakeItem({ clientUserId: owner.toHexString() }));
  h.pluggy.accounts.set(ITEM_ID, [fakeAccount()]);
  h.pluggy.transactions.set('acc-checking', [fakeTx({ id: 't1' }), fakeTx({ id: 't2', description: 'PADARIA SOL', amount: -9.5 })]);
}

async function connect(u = alice) {
  const res = await h.app.inject({ method: 'POST', url: '/v1/connections', headers: await auth(u), payload: { itemId: ITEM_ID } });
  return res;
}

describe('autenticacao', () => {
  it('rejeita sem token ou token invalido', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/connections' })).statusCode).toBe(401);
    const res = await h.app.inject({ method: 'GET', url: '/v1/connections', headers: { authorization: 'Bearer abc' } });
    expect(res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária' } });
  });

  it('acoes sensiveis exigem autenticacao recente (secao 6.2)', async () => {
    seedItem();
    const res = await h.app.inject({ method: 'POST', url: '/v1/connections', headers: await auth(alice, 3600), payload: { itemId: ITEM_ID } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('REAUTH_REQUIRED');
  });
});

describe('/v1/connections', () => {
  it('emite connect token com o usuario do token', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/connections/token', headers: await auth(alice) });
    expect(res.json()).toEqual({ accessToken: 'connect-token' });
    expect(h.pluggy.calls).toContain(`token:${alice.toHexString()}:`);
  });

  it('registra o item, criptografa o itemId e sincroniza em segundo plano', async () => {
    seedItem();
    const res = await connect();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ institutionName: 'Nubank', status: 'UPDATED', needsAction: false, active: true });
    expect(JSON.stringify(body)).not.toContain(ITEM_ID);

    const doc = await h.ctx.col.connections.findOne({});
    expect(doc!.pluggyItemIdEnc).not.toContain(ITEM_ID);
    expect(h.ctx.crypto.decrypt(doc!.pluggyItemIdEnc)).toBe(ITEM_ID);
    await waitFor(async () => (await h.ctx.col.transactions.countDocuments({})) === 2);
    expect(await h.ctx.col.transactions.countDocuments({ userId: alice })).toBe(2);
    expect(await h.ctx.col.auditLogs.countDocuments({ event: 'connection.created' })).toBe(1);
  });

  it('recusa item de outro usuario e item inexistente', async () => {
    seedItem(bob);
    expect((await connect(alice)).json().error.code).toBe('FORBIDDEN_ITEM');
    h.pluggy.items.clear();
    expect((await connect(alice)).json().error.code).toBe('INVALID_ITEM');
  });

  it('valida o corpo (itemId precisa ser UUID)', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/connections', headers: await auth(alice), payload: { itemId: { $gt: '' } } });
    expect(res.statusCode).toBe(400);
  });

  it('isolamento por usuario: bob nao ve nem sincroniza a conexao de alice', async () => {
    seedItem();
    const { id } = (await connect()).json();
    expect((await h.app.inject({ method: 'GET', url: '/v1/connections', headers: await auth(bob) })).json()).toEqual([]);
    expect((await h.app.inject({ method: 'POST', url: `/v1/connections/${id}/sync`, headers: await auth(bob) })).statusCode).toBe(404);
  });

  it('remove mantendo o historico (RN-06)', async () => {
    seedItem();
    const { id } = (await connect()).json();
    await waitFor(async () => (await h.ctx.col.transactions.countDocuments({})) === 2);
    await new Promise((r) => setTimeout(r, 50));
    const res = await h.app.inject({ method: 'DELETE', url: `/v1/connections/${id}`, headers: await auth(alice) });
    expect(res.statusCode).toBe(204);
    expect(h.pluggy.calls).toContain(`delete:${ITEM_ID}`);
    expect(await h.ctx.col.transactions.countDocuments({})).toBe(2);
    expect((await h.app.inject({ method: 'GET', url: '/v1/connections', headers: await auth(alice) })).json()).toEqual([]);
  });

  it('remove apagando o historico (RN-06)', async () => {
    seedItem();
    const { id } = (await connect()).json();
    await waitFor(async () => (await h.ctx.col.transactions.countDocuments({})) === 2);
    await new Promise((r) => setTimeout(r, 50));
    await h.app.inject({ method: 'DELETE', url: `/v1/connections/${id}?keepHistory=false`, headers: await auth(alice) });
    expect(await h.ctx.col.transactions.countDocuments({})).toBe(0);
    expect(await h.ctx.col.accounts.countDocuments({})).toBe(0);
    expect(await h.ctx.col.connections.countDocuments({})).toBe(0);
  });
});

describe('/v1/connections/import (Meu Pluggy)', () => {
  // Itens do Meu Pluggy nao tem o nosso clientUserId.
  const seedMeuPluggy = () => seedItem(new ObjectId());
  const importItem = async (u = alice, itemId = ITEM_ID) =>
    h.app.inject({ method: 'POST', url: '/v1/connections/import', headers: await auth(u), payload: { itemId } });

  it('importa pelo Item ID, sincroniza e usa o nome do banco das contas', async () => {
    seedMeuPluggy();
    h.pluggy.items.set(ITEM_ID, fakeItem({ connector: { id: 200, name: 'MeuPluggy', imageUrl: '', primaryColor: '' } as never }));
    h.pluggy.accounts.set(ITEM_ID, [fakeAccount({ name: 'Banco Bradesco' }), fakeAccount({ id: 'acc-2', subtype: 'SAVINGS_ACCOUNT', name: 'Banco Bradesco' })]);
    const res = await importItem();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ source: 'MEU_PLUGGY' });
    await waitFor(async () => (await h.ctx.col.transactions.countDocuments({})) === 2);
    expect(await h.ctx.col.transactions.countDocuments({ userId: alice })).toBe(2);
    await waitFor(async () => (await h.ctx.col.connections.findOne({}))?.institutionName === 'Banco Bradesco');
    expect((await h.ctx.col.connections.findOne({}))!.institutionName).toBe('Banco Bradesco');
  });

  it('exige autenticacao recente e Item ID valido', async () => {
    seedMeuPluggy();
    const old = await h.app.inject({ method: 'POST', url: '/v1/connections/import', headers: await auth(alice, 3600), payload: { itemId: ITEM_ID } });
    expect(old.json().error.code).toBe('REAUTH_REQUIRED');
    expect((await importItem(alice, 'nao-e-uuid')).statusCode).toBe(400);
  });

  it('um item pertence a um unico usuario', async () => {
    seedMeuPluggy();
    expect((await importItem(alice)).statusCode).toBe(201);
    expect((await importItem(bob)).json().error.code).toBe('FORBIDDEN_ITEM');
  });

  it('reconexao, sincronizacao e remocao respeitam o Meu Pluggy', async () => {
    seedMeuPluggy();
    const { id } = (await importItem()).json();
    await waitFor(async () => (await h.ctx.col.transactions.countDocuments({})) === 2);
    await new Promise((r) => setTimeout(r, 50));

    const token = await h.app.inject({ method: 'POST', url: '/v1/connections/token', headers: await auth(alice), payload: { connectionId: id } });
    expect(token.json().error.code).toBe('MANAGED_BY_MEU_PLUGGY');

    const sync = await h.app.inject({ method: 'POST', url: `/v1/connections/${id}/sync`, headers: await auth(alice) });
    expect(sync.json().status).toBe('SYNCED');
    expect(h.pluggy.calls.some((c) => c.startsWith('update:'))).toBe(false);

    expect((await h.app.inject({ method: 'DELETE', url: `/v1/connections/${id}`, headers: await auth(alice) })).statusCode).toBe(204);
    expect(h.pluggy.calls.some((c) => c.startsWith('delete:'))).toBe(false);
  });
});

describe('/v1/accounts e /v1/transactions', () => {
  it('lista contas e pagina transacoes por cursor, com busca', async () => {
    seedItem();
    h.pluggy.transactions.set(
      'acc-checking',
      Array.from({ length: 5 }, (_, i) => fakeTx({ id: `t${i}`, description: i === 2 ? 'PADARIA SÃO JOÃO' : `LOJA ${i}`, date: new Date(Date.UTC(2026, 9, 10 + i)) })),
    );
    const { id } = (await connect()).json();
    await waitFor(async () => (await h.ctx.col.transactions.countDocuments({})) === 5);

    const accounts = (await h.app.inject({ method: 'GET', url: '/v1/accounts', headers: await auth(alice) })).json();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ connectionId: id, type: 'CHECKING', balanceMinor: 842035, numberMasked: '5678' });

    const p1 = (await h.app.inject({ method: 'GET', url: '/v1/transactions?limit=2', headers: await auth(alice) })).json();
    expect(p1.items.map((t: { description: string }) => t.description)).toEqual(['LOJA 4', 'LOJA 3']);
    const p2 = (await h.app.inject({ method: 'GET', url: `/v1/transactions?limit=2&cursor=${p1.nextCursor}`, headers: await auth(alice) })).json();
    expect(p2.items.map((t: { description: string }) => t.description)).toEqual(['PADARIA SÃO JOÃO', 'LOJA 1']);

    const search = (await h.app.inject({ method: 'GET', url: '/v1/transactions?q=sao%20joao', headers: await auth(alice) })).json();
    expect(search.items).toHaveLength(1);
    // "+" sem escape viraria quantificador e casaria "loja"; escapado, e literal.
    const regexAttack = (await h.app.inject({ method: 'GET', url: '/v1/transactions?q=loja%2B', headers: await auth(alice) })).json();
    expect(regexAttack.items).toHaveLength(0);

    expect((await h.app.inject({ method: 'GET', url: '/v1/transactions', headers: await auth(bob) })).json().items).toEqual([]);

    // Resumo: 5 despesas de R$ 187,34; pagamento de fatura nao conta (RN-14).
    await h.ctx.col.transactions.updateOne({ pluggyTransactionId: 't0' }, { $set: { type: 'CARD_PAYMENT' } });
    const sum = (await h.app.inject({ method: 'GET', url: '/v1/transactions/summary?from=2026-10-01T00:00:00Z', headers: await auth(alice) })).json();
    expect(sum).toEqual({ incomeMinor: 0, expensesMinor: 4 * 18734, count: 5 });
    expect((await h.app.inject({ method: 'GET', url: '/v1/transactions?cursor=lixo', headers: await auth(alice) })).statusCode).toBe(400);
  });
});
