import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { buildApp } from '../app';
import { loadEnv } from '../config/env';
import type { AppContext } from '../context';
import { collections } from '../db/collections';
import { ensureIndexes } from '../db/indexes';
import { ensureSchemas } from '../db/schema';
import type { PluggyAccount, PluggyBill, PluggyGateway, PluggyInvestment, PluggyItem, PluggyTransaction } from '../integrations/pluggy/gateway';
import { createFieldCrypto } from '../lib/crypto';
import { createJwt } from '../lib/jwt';
import { base32Decode, generateTotpSecret, hotp, stepAt } from '../lib/totp';
import { buildUser } from '../modules/auth/users';

/** Pluggy em memoria: os testes montam o estado e inspecionam as chamadas. */
export class FakePluggy implements PluggyGateway {
  items = new Map<string, PluggyItem>();
  accounts = new Map<string, PluggyAccount[]>();
  transactions = new Map<string, PluggyTransaction[]>();
  investments = new Map<string, PluggyInvestment[]>();
  bills = new Map<string, PluggyBill[]>();
  failAccounts = new Set<string>();
  calls: string[] = [];

  async createConnectToken({ clientUserId, itemId }: { clientUserId: string; itemId?: string }) {
    this.calls.push(`token:${clientUserId}:${itemId ?? ''}`);
    return 'connect-token';
  }
  async fetchItem(id: string) {
    this.calls.push(`item:${id}`);
    const i = this.items.get(id);
    if (!i) throw Object.assign(new Error('not found'), { response: { statusCode: 404 } });
    return i;
  }
  async updateItem(id: string) {
    this.calls.push(`update:${id}`);
    return this.fetchItem(id);
  }
  async deleteItem(id: string) {
    this.calls.push(`delete:${id}`);
    this.items.delete(id);
  }
  async fetchAccounts(itemId: string) {
    return this.accounts.get(itemId) ?? [];
  }
  async fetchTransactions(accountId: string, dateFrom?: string) {
    this.calls.push(`tx:${accountId}:${dateFrom ?? 'all'}`);
    if (this.failAccounts.has(accountId)) throw new Error('falha simulada');
    const all = this.transactions.get(accountId) ?? [];
    return dateFrom ? all.filter((t) => new Date(t.date).toISOString().slice(0, 10) >= dateFrom) : all;
  }
  async fetchInvestments(itemId: string) {
    return this.investments.get(itemId) ?? [];
  }
  async fetchCreditCardBills(accountId: string) {
    return this.bills.get(accountId) ?? [];
  }
}

export interface Harness {
  ctx: AppContext;
  db: Db;
  pluggy: FakePluggy;
  app: Awaited<ReturnType<typeof buildApp>>;
  token(userId: ObjectId, opts?: { authAgeSec?: number }): Promise<string>;
  createUser(opts?: { email?: string; password?: string }): Promise<{ id: ObjectId; email: string; password: string; secret: string; recoveryCodes: string[]; code: () => Promise<string> }>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const db = client.db('pluto_test');
  await ensureSchemas(db);
  await ensureIndexes(db);

  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri(),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ALLOWED_ORIGINS: 'http://localhost:3000',
    JWT_PUBLIC_KEY: b64(publicKey),
    JWT_PRIVATE_KEY: b64(privateKey),
  });
  const jwt = await createJwt({ publicKeyB64: env.JWT_PUBLIC_KEY!, privateKeyB64: env.JWT_PRIVATE_KEY });
  const pluggy = new FakePluggy();
  const ctx: AppContext = { env, col: collections(db), crypto: createFieldCrypto(env.FIELD_ENCRYPTION_KEY), jwt, pluggy, pingDb: async () => true };
  const app = await buildApp(ctx);

  return {
    ctx,
    db,
    pluggy,
    app,
    token: (userId, opts = {}) => jwt.sign!({ userId: userId.toHexString(), authTime: Math.floor(Date.now() / 1000) - (opts.authAgeSec ?? 0) }),
    async createUser({ email = 'dono@pluto.test', password = 'senha muito segura 123' } = {}) {
      const secret = generateTotpSecret();
      const { doc, recoveryCodes } = await buildUser(ctx.crypto, { name: 'Marina Souza', email, password, totpSecret: secret });
      const { insertedId } = await ctx.col.users.insertOne(doc as never);
      // Zera o ultimo passo usado para permitir varios logins no mesmo intervalo de 30 s.
      const code = async () => {
        await ctx.col.users.updateOne({ _id: insertedId }, { $set: { 'totp.lastStep': null } });
        return hotp(base32Decode(secret), stepAt(Date.now()));
      };
      return { id: insertedId, email, password, secret, recoveryCodes, code };
    },
    async reset() {
      for (const c of await db.collections()) await c.deleteMany({});
      Object.assign(pluggy, new FakePluggy());
    },
    async close() {
      await app.close();
      await client.close();
      await mongo.stop();
    },
  };
}
