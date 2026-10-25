import type { ClientSession, MongoClient } from 'mongodb';

const support = new WeakMap<MongoClient, Promise<boolean>>();

/** Transacoes exigem replica set ou mongos (o Atlas e um replica set; o mongod de testes nao). */
function supportsTransactions(client: MongoClient) {
  let p = support.get(client);
  if (!p) {
    p = client
      .db('admin')
      .command({ hello: 1 })
      .then((h) => Boolean(h.setName) || h.msg === 'isdbgrid')
      .catch(() => false);
    support.set(client, p);
  }
  return p;
}

/**
 * Escritas multiplas tudo-ou-nada: se qualquer passo falhar, nada fica gravado (rollback).
 * Cada operacao dentro de `fn` precisa receber `{ session }`. Sem suporte a transacoes (mongod
 * isolado), roda sem sessao.
 */
export async function inTransaction<T>(client: MongoClient | undefined, fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!client || !(await supportsTransactions(client))) return fn(undefined);
  return client.withSession((s) => s.withTransaction(() => fn(s)));
}
