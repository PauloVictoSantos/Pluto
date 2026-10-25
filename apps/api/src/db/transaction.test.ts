import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from './transaction';

// O Atlas e um replica set: la as escritas multiplas sao tudo-ou-nada.
let rs: MongoMemoryReplSet;
let client: MongoClient;
beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60_000 }] });
  client = await MongoClient.connect(rs.getUri());
}, 120_000);
afterAll(async () => {
  await client?.close();
  await rs?.stop();
});

describe('inTransaction', () => {
  it('falha no meio desfaz as escritas anteriores (rollback)', async () => {
    const db = client.db('tx_test');
    await db.createCollection('a');
    await db.createCollection('b');
    await expect(
      inTransaction(client, async (session) => {
        expect(session).toBeDefined();
        await db.collection('a').insertOne({ x: 1 }, { session });
        await db.collection('b').insertOne({ y: 1 }, { session });
        throw new Error('falhou no terceiro passo');
      }),
    ).rejects.toThrow('falhou no terceiro passo');
    expect(await db.collection('a').countDocuments()).toBe(0);
    expect(await db.collection('b').countDocuments()).toBe(0);

    await inTransaction(client, async (session) => {
      await db.collection('a').insertOne({ x: 2 }, { session });
      await db.collection('b').insertOne({ y: 2 }, { session });
    });
    expect(await db.collection('a').countDocuments()).toBe(1);
    expect(await db.collection('b').countDocuments()).toBe(1);
  });

  it('mongod isolado (sem replica set) roda sem sessao', async () => {
    const solo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
    const c = await MongoClient.connect(solo.getUri());
    try {
      expect(await inTransaction(c, async (session) => session)).toBeUndefined();
      expect(await inTransaction(undefined, async () => 'ok')).toBe('ok');
    } finally {
      await c.close();
      await solo.stop();
    }
  }, 120_000);
});
