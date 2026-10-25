import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBackup, readBackup, restoreBackup } from './backup';

let mongo: MongoMemoryServer;
let client: MongoClient;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  client = await MongoClient.connect(mongo.getUri());
}, 120_000);
afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

const PASS = 'frase-de-teste-bem-longa';

describe('backup', () => {
  it('restaura igual ao original (ObjectId, datas, centavos)', async () => {
    const src = client.db('origem');
    const userId = new ObjectId();
    await src.collection('users').insertOne({ _id: userId, name: 'Marina', createdAt: new Date('2026-10-01T12:00:00Z') });
    await src.collection('transactions').insertMany([1, 2, 3].map((n) => ({ userId, amountMinor: -n * 1234, date: new Date(2026, 9, n) })));
    const { file, collections } = await createBackup(src, PASS);
    expect(collections).toEqual({ users: 1, transactions: 3 });
    // Cifrado: nada legivel no arquivo.
    expect(file.toString('latin1')).not.toContain('Marina');

    const dst = client.db('restaurado');
    expect((await restoreBackup(dst, file, PASS)).collections).toEqual({ users: 1, transactions: 3 });
    const u = await dst.collection('users').findOne({ _id: userId });
    expect(u?.createdAt).toEqual(new Date('2026-10-01T12:00:00Z'));
    expect((await dst.collection('transactions').find({ userId }).toArray()).map((t) => t.amountMinor as number).sort((a, b) => a - b)).toEqual([-3702, -2468, -1234]);

    // Nao sobrescreve um banco com dados.
    await expect(restoreBackup(dst, file, PASS)).rejects.toThrow('ja tem dados');
  });

  it('frase errada nao abre o arquivo', async () => {
    const { file } = await createBackup(client.db('origem'), PASS);
    expect(() => readBackup(file, 'outra frase')).toThrow('Frase de backup errada');
  });
});
