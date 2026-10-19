import { ACCOUNT_TYPES, CONNECTION_SOURCES, CONNECTION_STATUSES, INVESTMENT_TYPES, INVOICE_STATUSES, SHOPPING_CATEGORY_KEYS, TRANSACTION_STATUSES, TRANSACTION_TYPES, UNITS } from '@pluto/shared';
import { MongoServerError, type Db, type Document } from 'mongodb';

// JSON Schema validator do MongoDB nas colecoes criticas (secao 4.1).
// Segunda linha de defesa: a validacao principal acontece com Zod na borda da API.

// O driver grava inteiros fora do int32 como double: aceita double desde que seja inteiro.
const int = { bsonType: ['int', 'long', 'double'], multipleOf: 1 };
const intOrNull = { bsonType: ['int', 'long', 'double', 'null'], multipleOf: 1 };
const date = { bsonType: 'date' };
const dateOrNull = { bsonType: ['date', 'null'] };
const oid = { bsonType: 'objectId' };
const oidOrNull = { bsonType: ['objectId', 'null'] };
const str = { bsonType: 'string' };
const strOrNull = { bsonType: ['string', 'null'] };
const bool = { bsonType: 'bool' };
const enumOf = (values: readonly string[]) => ({ enum: [...values] });

const schema = (required: string[], properties: Document) => ({
  $jsonSchema: { bsonType: 'object', required, properties },
});

export const VALIDATORS: Record<string, Document> = {
  users: schema(['email', 'name', 'passwordHash', 'totp', 'settings', 'failedLogins', 'createdAt', 'updatedAt'], {
    email: { bsonType: 'string', pattern: '^[^A-Z\\s]+@[^A-Z\\s]+$' },
    name: str,
    phone: strOrNull,
    passwordHash: { bsonType: 'string', pattern: '^\\$argon2id\\$' },
    totp: {
      bsonType: 'object',
      required: ['secretEnc', 'enabled', 'recoveryCodesHash'],
      properties: {
        secretEnc: { bsonType: 'string', pattern: '^v1\\.' },
        enabled: bool,
        recoveryCodesHash: { bsonType: 'array', items: str },
      },
    },
    settings: { bsonType: 'object' },
    failedLogins: int,
    lockedUntil: dateOrNull,
  }),
  sessions: schema(['userId', 'familyId', 'refreshTokenHash', 'client', 'authTime', 'expiresAt', 'createdAt'], {
    userId: oid,
    familyId: str,
    refreshTokenHash: str,
    client: enumOf(['web', 'mobile']),
    authTime: date,
    persistent: bool,
    expiresAt: date,
    rotatedAt: dateOrNull,
    revokedAt: dateOrNull,
  }),
  connections: schema(
    ['userId', 'pluggyItemIdEnc', 'pluggyItemIdHash', 'source', 'connectorId', 'institutionName', 'status', 'needsAction', 'active', 'createdAt', 'updatedAt'],
    {
      userId: oid,
      pluggyItemIdEnc: { bsonType: 'string', pattern: '^v1\\.' },
      pluggyItemIdHash: str,
      source: enumOf(CONNECTION_SOURCES),
      connectorId: int,
      institutionName: str,
      status: enumOf(CONNECTION_STATUSES),
      needsAction: bool,
      active: bool,
      consentExpiresAt: dateOrNull,
      lastSyncAt: dateOrNull,
      lastError: strOrNull,
      createdAt: date,
      updatedAt: date,
    },
  ),
  accounts: schema(['userId', 'connectionId', 'pluggyAccountId', 'type', 'name', 'balanceMinor', 'currency'], {
    userId: oid,
    connectionId: oid,
    pluggyAccountId: str,
    type: enumOf(ACCOUNT_TYPES),
    name: str,
    numberMasked: { bsonType: ['string', 'null'], maxLength: 8 },
    balanceMinor: int,
    currency: str,
    creditLimitMinor: intOrNull,
    availableCreditMinor: intOrNull,
    closingDay: { bsonType: ['int', 'null'], minimum: 1, maximum: 31 },
    dueDay: { bsonType: ['int', 'null'], minimum: 1, maximum: 31 },
  }),
  transactions: schema(
    ['userId', 'accountId', 'connectionId', 'pluggyTransactionId', 'date', 'description', 'descriptionNorm', 'amountMinor', 'currency', 'type', 'status'],
    {
      userId: oid,
      accountId: oid,
      connectionId: oid,
      pluggyTransactionId: str,
      date,
      description: str,
      descriptionNorm: str,
      amountMinor: int,
      currency: str,
      type: enumOf(TRANSACTION_TYPES),
      status: enumOf(TRANSACTION_STATUSES),
      categoryId: oidOrNull,
      invoiceId: oidOrNull,
      tags: { bsonType: 'array', items: str },
      hidden: bool,
      deletedAt: dateOrNull,
    },
  ),
  invoices: schema(['userId', 'accountId', 'pluggyBillId', 'dueDate', 'totalMinor', 'paidMinor', 'status'], {
    userId: oid,
    accountId: oid,
    pluggyBillId: str,
    closingDate: dateOrNull,
    dueDate: date,
    totalMinor: int,
    paidMinor: int,
    status: enumOf(INVOICE_STATUSES),
  }),
  investments: schema(['userId', 'connectionId', 'pluggyInvestmentId', 'type', 'name', 'appliedMinor', 'currentValueMinor'], {
    userId: oid,
    connectionId: oid,
    pluggyInvestmentId: str,
    type: enumOf(INVESTMENT_TYPES),
    name: str,
    appliedMinor: int,
    currentValueMinor: int,
    dueDate: dateOrNull,
  }),
  shopping_items: schema(['userId', 'name', 'nameNorm', 'aliases', 'category', 'unit', 'createdAt'], {
    userId: oid,
    name: { bsonType: 'string', maxLength: 60 },
    nameNorm: str,
    aliases: { bsonType: 'array', items: str },
    category: enumOf(SHOPPING_CATEGORY_KEYS),
    unit: enumOf(UNITS),
    createdAt: date,
  }),
  shopping_lists: schema(['userId', 'month', 'status', 'entries', 'createdAt'], {
    userId: oid,
    month: { bsonType: 'string', pattern: '^\\d{4}-\\d{2}$' },
    status: enumOf(['open', 'closed']),
    entries: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['itemId', 'qty', 'bought', 'suggested'],
        properties: {
          itemId: oid,
          qty: { bsonType: ['int', 'long', 'double'], minimum: 0 },
          bought: bool,
          boughtAt: dateOrNull,
          priceEnc: { bsonType: ['string', 'null'], pattern: '^v1\\.' },
          suggested: bool,
          removedAt: dateOrNull,
        },
      },
    },
    closedAt: dateOrNull,
  }),
};

/**
 * Cria as colecoes com validador ou atualiza o validador das existentes.
 * Atualizar (collMod) exige papel dbAdmin: rode `db:setup` com um usuario administrador.
 */
export async function ensureSchemas(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, validator] of Object.entries(VALIDATORS)) {
    const options = { validator, validationLevel: 'strict' as const, validationAction: 'error' as const };
    if (!existing.has(name)) {
      await db.createCollection(name, options);
      log(`colecao criada: ${name}`);
      continue;
    }
    try {
      await db.command({ collMod: name, ...options });
      log(`validador atualizado: ${name}`);
    } catch (e) {
      if (e instanceof MongoServerError && e.codeName === 'Unauthorized') {
        log(`sem permissao para atualizar o validador de ${name} (requer dbAdmin)`);
      } else throw e;
    }
  }
}
