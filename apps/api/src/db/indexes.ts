import type { Db, IndexDescription } from 'mongodb';

// Secao 4.4. Indices unicos garantem idempotencia da importacao (RN-01).
const INDEXES: Record<string, IndexDescription[]> = {
  users: [{ key: { email: 1 }, unique: true }],
  transactions: [
    { key: { connectionId: 1, pluggyTransactionId: 1 }, unique: true },
    { key: { userId: 1, date: -1 } },
    { key: { userId: 1, categoryId: 1, date: -1 } },
    { key: { userId: 1, accountId: 1, date: -1 } },
  ],
  accounts: [{ key: { connectionId: 1, pluggyAccountId: 1 }, unique: true }],
  connections: [{ key: { userId: 1, pluggyItemId: 1 }, unique: true }],
  investments: [{ key: { connectionId: 1, pluggyInvestmentId: 1 }, unique: true }],
  budgets: [{ key: { userId: 1, month: 1, categoryId: 1 }, unique: true }],
  notifications: [{ key: { userId: 1, dedupeKey: 1 }, unique: true }],
  sessions: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }, { key: { familyId: 1 } }],
  audit_logs: [{ key: { at: 1 }, expireAfterSeconds: 60 * 60 * 24 * 365 }],
  ai_insights: [{ key: { createdAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 90 }],
  webhook_events: [
    { key: { source: 1, eventId: 1 }, unique: true },
    { key: { receivedAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 30 },
  ],
};

export async function ensureIndexes(db: Db): Promise<void> {
  for (const [collection, indexes] of Object.entries(INDEXES)) {
    await db.collection(collection).createIndexes(indexes);
  }
}
