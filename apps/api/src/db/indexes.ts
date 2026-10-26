import type { Db, IndexDescription } from 'mongodb';

// Secao 4.4. Indices unicos garantem idempotencia da importacao (RN-01).
export const INDEXES: Record<string, IndexDescription[]> = {
  users: [
    { key: { email: 1 }, unique: true },
    // Login por CPF; usuarios antigos sem CPF nao entram no indice.
    { key: { cpfHash: 1 }, unique: true, partialFilterExpression: { cpfHash: { $type: 'string' } } },
  ],
  passkeys: [{ key: { credentialId: 1 }, unique: true }, { key: { userId: 1 } }],
  webauthn_challenges: [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
  connections: [
    // Global: um item do Pluggy pertence a um unico usuario do Pluto (inclusive conexoes removidas com historico).
    { key: { pluggyItemIdHash: 1 }, unique: true },
    { key: { userId: 1 } },
    { key: { active: 1, needsAction: 1 } },
  ],
  accounts: [
    { key: { connectionId: 1, pluggyAccountId: 1 }, unique: true },
    { key: { userId: 1 } },
  ],
  transactions: [
    { key: { connectionId: 1, pluggyTransactionId: 1 }, unique: true },
    { key: { userId: 1, date: -1, _id: -1 } },
    { key: { userId: 1, categoryId: 1, date: -1 } },
    { key: { userId: 1, accountId: 1, date: -1 } },
    { key: { userId: 1, matchKey: 1 } },
    { key: { userId: 1, counterpartyKey: 1 }, sparse: true },
    { key: { splitOf: 1 }, sparse: true },
  ],
  recurrences: [{ key: { userId: 1, key: 1, direction: 1 }, unique: true }],
  category_rules: [{ key: { userId: 1, matchKey: 1, direction: 1 }, unique: true }],
  invoices: [
    { key: { accountId: 1, pluggyBillId: 1 }, unique: true },
    { key: { userId: 1, dueDate: 1 } },
  ],
  investments: [
    { key: { connectionId: 1, pluggyInvestmentId: 1 }, unique: true },
    { key: { userId: 1 } },
  ],
  investment_snapshots: [{ key: { investmentId: 1, month: 1 }, unique: true }],
  shopping_items: [{ key: { userId: 1, nameNorm: 1 }, unique: true }, { key: { userId: 1, aliases: 1 } }],
  shopping_lists: [{ key: { userId: 1, month: 1 }, unique: true }, { key: { status: 1 } }],
  bills: [
    { key: { userId: 1, dueDate: 1 } },
    { key: { status: 1, dueDate: 1 } },
    // Um boleto por forma de pagamento por mes.
    { key: { userId: 1, sourceId: 1, month: 1 }, unique: true, partialFilterExpression: { sourceId: { $type: 'objectId' } }, name: 'bills_source_month' },
  ],
  debt_sources: [{ key: { userId: 1 } }],
  financial_profiles: [{ key: { userId: 1 }, unique: true }],
  income_profiles: [{ key: { userId: 1, createdAt: 1 } }],
  fixed_dismissals: [{ key: { userId: 1, key: 1 }, unique: true }],
  monthly_plans: [{ key: { userId: 1, month: 1 }, unique: true }],
  payers: [{ key: { userId: 1, taxIdHash: 1 }, unique: true }],
  receipts: [{ key: { userId: 1, createdAt: -1 } }, { key: { userId: 1, accessKeyHash: 1 }, unique: true, partialFilterExpression: { accessKeyHash: { $type: 'string' } } }],
  fixed_expenses: [{ key: { userId: 1, deletedAt: 1 } }],
  loans: [{ key: { userId: 1, deletedAt: 1 } }],
  spending_limits: [{ key: { userId: 1, month: 1 }, unique: true }],
  health_snapshots: [{ key: { userId: 1, month: 1 }, unique: true }],
  goal_drafts: [{ key: { userId: 1, status: 1, updatedAt: -1 } }],
  purchase_evaluations: [{ key: { userId: 1, createdAt: -1 } }, { key: { userId: 1, status: 1, month: 1 } }],
  // Conversa do Plutao some 30 dias depois da ultima mensagem.
  agent_sessions: [{ key: { userId: 1, updatedAt: -1 } }, { key: { updatedAt: 1 }, expireAfterSeconds: 30 * 86_400, name: 'agent_sessions_ttl' }],
  agent_contestations: [{ key: { userId: 1, createdAt: -1 } }],
  agent_usage: [{ key: { createdAt: 1 }, expireAfterSeconds: 3 * 86_400, name: 'agent_usage_ttl' }],
  merchant_groups: [{ key: { userId: 1, keys: 1 } }, { key: { userId: 1, name: 1 } }],
  commitments: [{ key: { userId: 1, sourceId: 1 } }],
  alerts: [
    { key: { userId: 1, createdAt: -1 } },
    { key: { userId: 1, type: 1, target: 1, createdAt: -1 } },
    // RN-G07: alertas so expiram pelo TTL de 180 dias.
    { key: { createdAt: 1 }, expireAfterSeconds: 180 * 86_400, name: 'alerts_ttl' },
  ],
  push_subscriptions: [{ key: { endpoint: 1 }, unique: true }, { key: { userId: 1 } }],
  job_runs: [{ key: { at: 1 }, expireAfterSeconds: 400 * 86_400, name: 'job_runs_ttl' }],
  budgets: [{ key: { userId: 1, month: 1, categoryKey: 1 }, unique: true }],
  goals: [{ key: { userId: 1, deadline: 1 } }],
  charges: [{ key: { userId: 1, createdAt: -1 } }, { key: { 'installments.paymentIntentId': 1 } }, { key: { 'installments.status': 1 } }],
  notifications: [{ key: { userId: 1, dedupeKey: 1 }, unique: true }],
  sessions: [
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    { key: { refreshTokenHash: 1 }, unique: true },
    { key: { familyId: 1 } },
    { key: { userId: 1 } },
  ],
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
