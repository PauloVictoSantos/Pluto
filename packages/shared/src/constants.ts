// Enums de dominio (secao 4.3). Mantidos como tuplas `as const` para gerar z.enum e tipos.

export const ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'CREDIT_CARD', 'INVESTMENT'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TRANSACTION_TYPES = [
  'EXPENSE',
  'INCOME',
  'TRANSFER',
  'CARD_PAYMENT',
  'INVESTMENT',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['PENDING', 'POSTED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const CATEGORY_SOURCES = ['RULE', 'PLUGGY', 'AI', 'MANUAL'] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

// Espelha ItemStatus do pluggy-sdk 0.92.
export const CONNECTION_STATUSES = [
  'UPDATED',
  'UPDATING',
  'MERGING',
  'OUTDATED',
  'LOGIN_ERROR',
  'WAITING_USER_INPUT',
  'WAITING_USER_ACTION',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

// RN-03: status que exigem acao do usuario; o job nao tenta de novo ate reconectar.
export const NEEDS_USER_ACTION: readonly ConnectionStatus[] = ['LOGIN_ERROR', 'WAITING_USER_INPUT', 'WAITING_USER_ACTION'];

export const INVOICE_STATUSES = ['OPEN', 'CLOSED', 'PAID', 'OVERDUE'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVESTMENT_TYPES = ['FIXED_INCOME', 'STOCK', 'FUND', 'ETF', 'CRYPTO', 'OTHER'] as const;
export type InvestmentType = (typeof INVESTMENT_TYPES)[number];

export const PAYMENT_KINDS = ['CASH', 'CARD_1X', 'CARD_INSTALLMENTS'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const WISHLIST_STATUSES = ['WANTED', 'PLANNED', 'BOUGHT', 'DROPPED'] as const;
export type WishlistStatus = (typeof WISHLIST_STATUSES)[number];

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

// Tipos que NAO entram em despesas (RN-13, RN-14).
export const NON_SPENDING_TYPES: readonly TransactionType[] = ['TRANSFER', 'CARD_PAYMENT'];

// RN-11: limiar de confianca para aplicar categoria sugerida pela IA.
export const AI_CATEGORY_MIN_CONFIDENCE = 0.8;

export const API_PREFIX = '/v1';
