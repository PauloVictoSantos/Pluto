import { z } from 'zod';
import { ACCOUNT_TYPES, CONNECTION_STATUSES } from '../constants';

/**
 * Origem da conexao:
 * - WIDGET: criada pelo Pluggy Connect dentro do Pluto (secao 3.7).
 * - MEU_PLUGGY: criada em meu.pluggy.ai e importada pelo Item ID; reconexao e revogacao
 *   acontecem no Meu Pluggy.
 */
export const CONNECTION_SOURCES = ['WIDGET', 'MEU_PLUGGY'] as const;
export type ConnectionSource = (typeof CONNECTION_SOURCES)[number];

// O itemId do Pluggy nunca sai da API (secao 6.5): o cliente usa apenas o id da conexao.
export const ConnectionSchema = z.object({
  id: z.string(),
  source: z.enum(CONNECTION_SOURCES),
  institutionName: z.string(),
  connectorId: z.number().int(),
  imageUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  status: z.enum(CONNECTION_STATUSES),
  needsAction: z.boolean(),
  active: z.boolean(),
  consentExpiresAt: z.coerce.date().nullable(),
  lastSyncAt: z.coerce.date().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const ConnectTokenSchema = z.object({ accessToken: z.string() });

export const CreateConnectionSchema = z.object({
  // UUID em minusculas: a mesma conexao nunca vira duas chaves diferentes.
  itemId: z.string().trim().uuid().transform((v) => v.toLowerCase()),
});

/** Importacao de item criado no Meu Pluggy (o usuario copia o Item ID no Dashboard). */
export const ImportConnectionSchema = z.object({
  itemId: z.string().trim().uuid('Item ID inválido').transform((v) => v.toLowerCase()),
});

export const DeleteConnectionQuerySchema = z.object({
  // RN-06: o usuario escolhe manter ou apagar o historico local.
  keepHistory: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const AccountSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  name: z.string(),
  numberMasked: z.string().nullable(),
  balanceMinor: z.number().int(),
  currency: z.string(),
  creditLimitMinor: z.number().int().nullable(),
  availableCreditMinor: z.number().int().nullable(),
  closingDay: z.number().int().nullable(),
  dueDay: z.number().int().nullable(),
});
export type Account = z.infer<typeof AccountSchema>;

export const SyncResultSchema = z.object({
  status: z.enum(['SYNCED', 'SKIPPED', 'NEEDS_ACTION', 'INACTIVE', 'FAILED']),
  accounts: z.number().int(),
  transactions: z.number().int(),
  investments: z.number().int(),
  errors: z.array(z.string()),
});
export type SyncResult = z.infer<typeof SyncResultSchema>;
