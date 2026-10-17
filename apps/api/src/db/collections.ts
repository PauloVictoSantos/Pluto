import type {
  AccountType,
  CategorySource,
  ConnectionSource,
  ConnectionStatus,
  InvestmentType,
  InvoiceStatus,
  TransactionStatus,
  TransactionType,
  UserSettings,
} from '@pluto/shared';
import type { Collection, Db, ObjectId } from 'mongodb';

// Documentos persistidos (secao 4.3). Dinheiro sempre em centavos (*Minor), datas em UTC.

export interface UserDoc {
  _id: ObjectId;
  /** Normalizado em minusculas (secao 4.3). */
  email: string;
  name: string;
  phone: string | null;
  passwordHash: string;
  totp: {
    /** Segredo base32 criptografado (AES-256-GCM, secao 6.4). */
    secretEnc: string;
    enabled: boolean;
    /** Ultimo passo aceito: impede reuso do mesmo codigo. */
    lastStep: number | null;
    recoveryCodesHash: string[];
  };
  settings: UserSettings;
  failedLogins: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** Todas as rotacoes de um mesmo login; reuso de token revoga a familia inteira (secao 6.2). */
  familyId: string;
  refreshTokenHash: string;
  client: 'web' | 'mobile';
  /** Ultima autenticacao forte (senha+2FA ou reautenticacao). Refresh nao renova. */
  authTime: Date;
  /** "Lembrar de mim": cookie persistente; senao, cookie de sessao do navegador. */
  persistent: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

export interface ConnectionDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** itemId do Pluggy criptografado (AES-256-GCM). Nunca logar nem expor (secao 6.5). */
  pluggyItemIdEnc: string;
  /** HMAC do itemId: permite indice unico e busca sem guardar o valor em claro. */
  pluggyItemIdHash: string;
  source: ConnectionSource;
  connectorId: number;
  institutionName: string;
  imageUrl: string | null;
  primaryColor: string | null;
  status: ConnectionStatus;
  /** RN-03: true quando o item exige acao do usuario (reconectar). */
  needsAction: boolean;
  /** RN-04: false apos o consentimento vencer; o historico e mantido. */
  active: boolean;
  consentExpiresAt: Date | null;
  lastSyncAt: Date | null;
  lastTransactionsSyncAt: Date | null;
  lastError: string | null;
  /** Trava de sincronizacao: evita duas execucoes simultaneas da mesma conexao. */
  syncingUntil: Date | null;
  /** RN-06: conexao removida com historico mantido. */
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountDoc {
  _id: ObjectId;
  userId: ObjectId;
  connectionId: ObjectId;
  pluggyAccountId: string;
  type: AccountType;
  name: string;
  /** Apenas os ultimos 4 digitos (secao 6.6). */
  numberMasked: string | null;
  balanceMinor: number;
  currency: string;
  creditLimitMinor: number | null;
  availableCreditMinor: number | null;
  closingDay: number | null;
  dueDay: number | null;
  brand: string | null;
  syncError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionDoc {
  _id: ObjectId;
  userId: ObjectId;
  accountId: ObjectId;
  connectionId: ObjectId;
  pluggyTransactionId: string;
  date: Date;
  description: string;
  descriptionNorm: string;
  /** Descricao sem o envelope do banco (lib/text matchKeyOf): base das regras de categoria. */
  matchKey: string;
  merchant: string | null;
  amountMinor: number;
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
  pluggyCategory: string | null;
  pluggyCategoryId: string | null;
  pluggyBillId: string | null;
  /** Categoria do Pluto (shared/categories). */
  categoryKey: string;
  installment: { n: number; total: number; groupId: string } | null;
  categoryId: ObjectId | null;
  categorySource: CategorySource | null;
  categoryConfidence: number | null;
  invoiceId: ObjectId | null;
  tags: string[];
  notes: string | null;
  hidden: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceDoc {
  _id: ObjectId;
  userId: ObjectId;
  accountId: ObjectId;
  pluggyBillId: string;
  closingDate: Date | null;
  dueDate: Date;
  totalMinor: number;
  paidMinor: number;
  status: InvoiceStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvestmentDoc {
  _id: ObjectId;
  userId: ObjectId;
  connectionId: ObjectId;
  pluggyInvestmentId: string;
  type: InvestmentType;
  subtype: string | null;
  name: string;
  quantity: number | null;
  appliedMinor: number;
  currentValueMinor: number;
  dueDate: Date | null;
  rateInfo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvestmentSnapshotDoc {
  _id: ObjectId;
  userId: ObjectId;
  investmentId: ObjectId;
  /** "YYYY-MM": um registro por mes (secao 4.3). */
  month: string;
  valueMinor: number;
  updatedAt: Date;
}

/** Regra de categoria criada pelo usuario (RN-10/RN-12). */
export interface CategoryRuleDoc {
  _id: ObjectId;
  userId: ObjectId;
  matchKey: string;
  /** Sentido da transacao: Pix recebido e enviado para a mesma pessoa sao coisas diferentes. */
  direction: 'in' | 'out';
  categoryKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** "YYYY-MM" */
  month: string;
  categoryKey: string;
  limitMinor: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalDoc {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  icon: string;
  targetMinor: number;
  savedMinor: number;
  /** "YYYY-MM-DD" */
  deadline: string;
  /** Aporte mensal planejado (Planejamento). */
  monthlyContributionMinor: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogDoc {
  _id: ObjectId;
  userId: ObjectId | null;
  event: string;
  ip: string | null;
  meta: Record<string, unknown>;
  at: Date;
}

export interface Collections {
  users: Collection<UserDoc>;
  sessions: Collection<SessionDoc>;
  connections: Collection<ConnectionDoc>;
  accounts: Collection<AccountDoc>;
  transactions: Collection<TransactionDoc>;
  invoices: Collection<InvoiceDoc>;
  investments: Collection<InvestmentDoc>;
  investmentSnapshots: Collection<InvestmentSnapshotDoc>;
  categoryRules: Collection<CategoryRuleDoc>;
  budgets: Collection<BudgetDoc>;
  goals: Collection<GoalDoc>;
  auditLogs: Collection<AuditLogDoc>;
}

export const collections = (db: Db): Collections => ({
  users: db.collection<UserDoc>('users'),
  sessions: db.collection<SessionDoc>('sessions'),
  connections: db.collection<ConnectionDoc>('connections'),
  accounts: db.collection<AccountDoc>('accounts'),
  transactions: db.collection<TransactionDoc>('transactions'),
  invoices: db.collection<InvoiceDoc>('invoices'),
  investments: db.collection<InvestmentDoc>('investments'),
  investmentSnapshots: db.collection<InvestmentSnapshotDoc>('investment_snapshots'),
  categoryRules: db.collection<CategoryRuleDoc>('category_rules'),
  budgets: db.collection<BudgetDoc>('budgets'),
  goals: db.collection<GoalDoc>('goals'),
  auditLogs: db.collection<AuditLogDoc>('audit_logs'),
});
