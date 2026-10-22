import type {
  ALERT_PAGES,
  YearObjective,
  FixedRecurrence,
  GoalAnswers,
  GoalDiagnosis,
  GoalKindV2,
  PurchaseEvaluation,
  PurchaseRequest,
  LoanKind,
  AlertType,
  AccountType,
  ChargeDestination,
  InstallmentStatus,
  ShoppingCategory,
  Unit,
  CategorySource,
  ConnectionSource,
  ConnectionStatus,
  InvestmentType,
  InvoiceStatus,
  TransactionStatus,
  TransactionType,
  UserSettings,
} from '@pluto/shared';
import type { Binary, Collection, Db, ObjectId } from 'mongodb';

// Documentos persistidos (secao 4.3). Dinheiro sempre em centavos (*Minor), datas em UTC.

export interface UserDoc {
  _id: ObjectId;
  /** Contato (normalizado em minusculas). O login e pelo CPF. */
  email: string;
  /** HMAC do CPF (so digitos): busca no login sem guardar o CPF em claro. */
  cpfHash?: string | null;
  /** CPF cifrado (AES-256-GCM), so para exibir mascarado. */
  cpfEnc?: string | null;
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

/** Passkey (WebAuthn) do usuario: chave publica do aparelho; a privada nunca sai dele. */
export interface PasskeyDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** ID da credencial em base64url (unico). */
  credentialId: string;
  publicKey: Binary;
  /** Contador de assinaturas: valor que nao cresce indica credencial clonada. */
  counter: number;
  transports: string[];
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Desafio WebAuthn de uso unico, valido por 5 minutos (TTL). */
export interface WebauthnChallengeDoc {
  _id: ObjectId;
  challenge: string;
  purpose: 'register' | 'login';
  /** Cadastro: dono do desafio. Login: null (a credencial identifica o usuario). */
  userId: ObjectId | null;
  expiresAt: Date;
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
  /** Reimportacao completa feita para preencher destinatario e horario das transacoes antigas. */
  analyticsBackfillAt?: Date | null;
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
  /** RN-D03: false quando o banco so informa a data (hora redonda); fica fora da analise por horario. */
  hasTime?: boolean;
  /** RN-D02: hash do CPF/CNPJ ou da conta de quem recebeu/pagou ("cp:..."). Ausente sem dados de pagamento. */
  counterpartyKey?: string | null;
  /** Pendente que reapareceu liquidada com outro id: aponta a liquidada (e fica com deletedAt). */
  duplicateOf?: ObjectId | null;
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
  /** Grupo de estabelecimento ("Uber") a que a descricao pertence. */
  merchantGroupId?: ObjectId | null;
  /** Parte de um pagamento dividido: aponta a transacao original do banco. */
  splitOf?: ObjectId | null;
  /** Sugestao do Naive Bayes com confianca entre 0,60 e 0,90: o usuario confirma (RN-D01). */
  aiSuggestion?: { categoryKey: string; p: number } | null;
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
  /** Descricao sem envelope, ou "cp:<hash>" para o destinatario do Pix (RN-D02). */
  matchKey: string;
  /** Nome exibido quando matchKey e um hash de destinatario. */
  label?: string | null;
  /** Sentido da transacao: Pix recebido e enviado para a mesma pessoa sao coisas diferentes. */
  direction: 'in' | 'out';
  categoryKey: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Parcela de uma cobranca: um boleto do Stripe (emitido na hora ou ate 60 dias antes do vencimento). */
/** Serie recorrente detectada (assinatura, conta fixa, salario), recalculada a cada sincronizacao. */
export interface RecurrenceDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** counterpartyKey ou matchKey das transacoes da serie. */
  key: string;
  direction: 'in' | 'out';
  label: string;
  categoryKey: string;
  period: 7 | 14 | 30 | 365;
  /** A maioria das ocorrencias e no cartao: sai do saldo so pela fatura (projecao do saldo). */
  onCard?: boolean;
  amountMinor: number;
  count: number;
  lastDate: Date;
  nextDate: Date;
  updatedAt: Date;
}

export interface InstallmentDoc {
  n: number;
  amountMinor: number;
  /** "YYYY-MM-DD" (vencimento no horario de Sao Paulo, regra do boleto). */
  dueDate: string;
  status: InstallmentStatus;
  paymentIntentId: string | null;
  number: string | null;
  pdfUrl: string | null;
  voucherUrl: string | null;
  paidAt: Date | null;
  /** Valor ja somado a meta (idempotencia do credito). */
  creditedAt: Date | null;
  /** Ausente em parcelas antigas (equivale a null). */
  paidVia?: 'BOLETO' | 'MANUAL' | null;
  /** Ultimo envio do boleto por e-mail ao pagador. */
  sentAt?: Date | null;
  /** Quando o pagador foi avisado por e-mail do cancelamento. */
  cancelNotifiedAt?: Date | null;
  error: string | null;
}

export interface ChargeDoc {
  _id: ObjectId;
  userId: ObjectId;
  destination: ChargeDestination;
  goalId: ObjectId | null;
  description: string;
  payerName: string;
  payerEmail: string;
  payerPhone: string | null;
  /** CPF/CNPJ e endereco do pagador cifrados: necessarios para emitir as parcelas futuras. */
  payerTaxIdEnc: string;
  payerAddressEnc: string;
  totalMinor: number;
  installments: InstallmentDoc[];
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Item canonico do catalogo de compras do usuario (RN-L02). */
export interface ShoppingItemDoc {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  /** normalizeItemName(name): busca exata. */
  nameNorm: string;
  /** Outros nomes ja digitados para o mesmo item, normalizados ("leite integral 1l"). */
  aliases: string[];
  category: ShoppingCategory;
  unit: Unit;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShoppingEntryDoc {
  itemId: ObjectId;
  qty: number;
  bought: boolean;
  boughtAt: Date | null;
  /** Preco pago pela linha, cifrado (doc.: priceCents protegido). */
  priceEnc: string | null;
  /** Veio de sugestao: remover conta como rejeicao, nao como "nao comprado" (RN-L05). */
  suggested: boolean;
  class: 'essential' | 'maybe' | null;
  reason: string | null;
  addedAt: Date;
  /** Removido da lista (desfazer limpa o campo). */
  removedAt: Date | null;
}

export interface ShoppingSuggestionDoc {
  itemId: ObjectId;
  qty: number;
  reason: string;
  source: 'history' | 'explore';
}

/** Uma lista por mes (RN-L01). Fechada no dia 1, 00:05, e imutavel depois disso (RN-L06, RN-G07). */
export interface ShoppingListDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** "YYYY-MM" no fuso do usuario. */
  month: string;
  status: 'open' | 'closed';
  entries: ShoppingEntryDoc[];
  /** Sugestoes ainda nao aceitas (chips), calculadas na abertura do mes. */
  suggestions: ShoppingSuggestionDoc[];
  /** "Voce costuma nao comprar", calculado na abertura. */
  rarely: { itemId: ObjectId; reason: string }[];
  /** Sugestoes dispensadas no "x": rejeicao (RN-L05/L08). */
  dismissed: ObjectId[];
  /** Compras de mercado ja respondidas ou dispensadas (nao pergunta de novo). */
  handledTxIds: ObjectId[];
  createdAt: Date;
  closedAt: Date | null;
  updatedAt: Date;
}

/** Boleto a pagar cadastrado pelo usuario (doc. "bills"). Beneficiario, valor e linha cifrados. */
export interface BillDoc {
  _id: ObjectId;
  userId: ObjectId;
  payeeEnc: string;
  amountEnc: string;
  /** "YYYY-MM-DD" */
  dueDate: string;
  status: 'pending' | 'paid' | 'overdue';
  lineEnc: string | null;
  fine: number;
  monthlyInterest: number;
  paidAt: Date | null;
  paidTransactionId: ObjectId | null;
  /** Boleto do mes de uma divida manual (forma de pagamento + mes): itens que compoem o valor. */
  sourceId?: ObjectId | null;
  month?: string | null;
  items?: BillItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BillItem {
  commitmentId: ObjectId;
  label: string;
  categoryKey: string;
  amountMinor: number;
  n: number | null;
  total: number | null;
}

/** Forma de pagamento que o Open Finance nao ve (ex.: cartao de um parente, pago a ele por boleto). */
export interface DebtSourceDoc {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  method: 'third_party_card' | 'boleto' | 'pix';
  holder: string | null;
  bank: string | null;
  cardProduct: string | null;
  brand: string | null;
  /** So os 4 ultimos digitos (secao 6.6). */
  last4: string | null;
  dueDay: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Compra parcelada ou mensalidade paga por uma DebtSource. */
export interface CommitmentDoc {
  _id: ObjectId;
  userId: ObjectId;
  sourceId: ObjectId;
  merchant: string;
  categoryKey: string;
  /** "YYYY-MM-DD" */
  approvedAt: string;
  kind: 'installments' | 'monthly';
  totalMinor: number | null;
  installments: number | null;
  monthlyMinor: number | null;
  /** "YYYY-MM" da 1a parcela/mensalidade. */
  firstMonth: string;
  lastMonth: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Grupo de estabelecimento: descricoes diferentes do mesmo lugar com uma categoria. */
export interface MerchantGroupDoc {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  categoryKey: string | null;
  source: 'ai' | 'user';
  /** matchKey das transacoes do grupo. */
  keys: string[];
  /** Descricoes que o usuario tirou do grupo: a IA nao coloca de volta. */
  blocked: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** Perfil financeiro do agente Plutao (um por usuario); a renda fica criptografada. */
export interface FinancialProfileDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** Renda liquida mensal em centavos, criptografada; null = nao informada. */
  netIncomeEnc: string | null;
  safetyMarginPct: number;
  yearObjective: YearObjective | null;
  referenceRateMonthly: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Gasto fixo do agente (doc. Pluton 3.1); exclusao logica para manter o historico. */
export interface FixedExpenseDoc {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  categoryKey: string;
  amountMinor: number;
  isVariable: boolean;
  amountStdMinor: number | null;
  dueDay: number;
  dueMonth: number | null;
  recurrence: FixedRecurrence;
  /** "YYYY-MM" do ultimo mes (fixo temporario). */
  endsOn: string | null;
  source: 'manual' | 'chat';
  matchKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Divida com juros do agente (doc. Pluton, tabela debts); saldo e parcela criptografados. */
export interface LoanDoc {
  _id: ObjectId;
  userId: ObjectId;
  creditor: string;
  kind: LoanKind;
  /** Saldo devedor em centavos, criptografado, na data balanceAsOf. */
  balanceEnc: string;
  /** "YYYY-MM" em que o saldo foi informado; depois disso o saldo e estimado. */
  balanceAsOf: string;
  /** Taxa ao mes informada; null = calculada pela parcela e prazo. */
  monthlyRate: number | null;
  installmentEnc: string | null;
  /** Parcelas restantes em balanceAsOf. */
  installmentsLeft: number | null;
  dueDay: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Limite de gasto variavel do mes (doc. Pluton, spending_limits): snapshot do calculo + sobrescrita. */
export interface SpendingLimitDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** "YYYY-MM" */
  month: string;
  computedMinor: number;
  /** Sobrescrita manual (LG-04): so para este mes. */
  overrideMinor: number | null;
  inputs: { incomeMinor: number; incomeKnown: boolean; fixedMinor: number; goalsMinor: number; marginMinor: number; deficitMinor: number };
  /** Descricoes do extrato ja contadas nos fixos (nao entram no gasto variavel). */
  fixedKeys: string[];
  computedAt: Date;
  createdAt: Date;
}

/** Nota mensal da saude financeira (0-100), para comparar com o mes anterior. */
export interface HealthSnapshotDoc {
  _id: ObjectId;
  userId: ObjectId;
  month: string;
  score: number;
  at: Date;
}

/** Rascunho de meta (entrevista do doc. Pluton 4): respostas brutas, diagnostico e desfecho. */
export interface GoalDraftDoc {
  _id: ObjectId;
  userId: ObjectId;
  kind: GoalKindV2;
  title: string;
  status: 'rascunho' | 'em-analise' | 'confirmada' | 'descartada';
  answers: GoalAnswers;
  diagnosis: GoalDiagnosis | null;
  goalId: ObjectId | null;
  discardReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Avaliacao de compra (doc. Pluton 3.4): pedido, veredito e o que o usuario fez depois. */
export interface PurchaseEvaluationDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** "YYYY-MM" da avaliacao (compra planejada pesa no limite deste mes). */
  month: string;
  request: PurchaseRequest;
  verdict: PurchaseEvaluation['verdict'];
  reason: PurchaseEvaluation['reason'];
  result: Omit<PurchaseEvaluation, 'id' | 'status' | 'holdUntil' | 'canPlan' | 'consequence' | 'createdAt'>;
  monthImpactMinor: number;
  status: Exclude<PurchaseEvaluation['status'], 'simulada'>;
  holdUntil: Date | null;
  consequence: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Sessao de chat do Plutao: conversa, referencias e acao pendente, tudo criptografado. */
export interface AgentSessionDoc {
  _id: ObjectId;
  userId: ObjectId;
  stateEnc: string;
  promptVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Contestacao de um veredito do Plutao (registrar_contestacao), para revisao. */
export interface AgentContestationDoc {
  _id: ObjectId;
  userId: ObjectId;
  subject: string;
  text: string;
  createdAt: Date;
}

/** Alerta do painel do sino (doc. "alerts"): TTL de 180 dias; texto imutavel depois de criado (RN-G07). */
export interface AlertDoc {
  _id: ObjectId;
  userId: ObjectId;
  type: AlertType;
  /** Alvo do alerta (boleto, categoria do mes, meta da semana): RN-A02 nao repete o mesmo em 72 h. */
  target: string;
  title: string;
  body: string;
  /** Texto do push e do e-mail, sem valores nem nomes (RN-A03). */
  pushText: string;
  action: { label: string; page: (typeof ALERT_PAGES)[number] } | null;
  why: string[];
  /** Pontuacao A e as variaveis usadas em P(util | x). */
  score: number;
  features: { type: string; hour: number; group: string; amountMinor: number };
  dueToday: boolean;
  createdAt: Date;
  readAt: Date | null;
  sentAt: Date | null;
  channels: ('push' | 'email')[];
  feedback: 'useful' | 'not_useful' | null;
  feedbackAt: Date | null;
}

/** Inscricao Web Push de um aparelho; as chaves ficam cifradas. */
export interface PushSubscriptionDoc {
  _id: ObjectId;
  userId: ObjectId;
  endpoint: string;
  keysEnc: string;
  userAgent: string | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
}

/** Execucao de job (doc. "jobRuns"): idempotente por chave usuario:job:periodo. */
export interface JobRunDoc {
  _id: string;
  at: Date;
  meta?: Record<string, unknown>;
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
  /** 1 (mais importante) a 5 (RN-M02). Ausente em metas antigas: vale 3. */
  priority?: number;
  /** Metas v2 (MT-03). Ausente em metas antigas: ativa. */
  status?: 'ativa' | 'pausada' | 'concluida' | 'cancelada';
  kind?: GoalKindV2;
  /** Score de prioridade S e fatores (doc. 5.4). */
  score?: number;
  factors?: { U: number; E: number; F: number; R: number; A: number };
  rationale?: string[];
  /** "YYYY-MM-DD" do inicio do cronograma. */
  startDate?: string;
  draftId?: ObjectId;
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
  passkeys: Collection<PasskeyDoc>;
  webauthnChallenges: Collection<WebauthnChallengeDoc>;
  connections: Collection<ConnectionDoc>;
  accounts: Collection<AccountDoc>;
  transactions: Collection<TransactionDoc>;
  invoices: Collection<InvoiceDoc>;
  investments: Collection<InvestmentDoc>;
  investmentSnapshots: Collection<InvestmentSnapshotDoc>;
  categoryRules: Collection<CategoryRuleDoc>;
  recurrences: Collection<RecurrenceDoc>;
  charges: Collection<ChargeDoc>;
  budgets: Collection<BudgetDoc>;
  shoppingItems: Collection<ShoppingItemDoc>;
  bills: Collection<BillDoc>;
  merchantGroups: Collection<MerchantGroupDoc>;
  debtSources: Collection<DebtSourceDoc>;
  commitments: Collection<CommitmentDoc>;
  alerts: Collection<AlertDoc>;
  pushSubscriptions: Collection<PushSubscriptionDoc>;
  jobRuns: Collection<JobRunDoc>;
  shoppingLists: Collection<ShoppingListDoc>;
  goals: Collection<GoalDoc>;
  financialProfiles: Collection<FinancialProfileDoc>;
  fixedExpenses: Collection<FixedExpenseDoc>;
  loans: Collection<LoanDoc>;
  spendingLimits: Collection<SpendingLimitDoc>;
  healthSnapshots: Collection<HealthSnapshotDoc>;
  goalDrafts: Collection<GoalDraftDoc>;
  purchaseEvaluations: Collection<PurchaseEvaluationDoc>;
  agentSessions: Collection<AgentSessionDoc>;
  agentContestations: Collection<AgentContestationDoc>;
  auditLogs: Collection<AuditLogDoc>;
}

export const collections = (db: Db): Collections => ({
  users: db.collection<UserDoc>('users'),
  sessions: db.collection<SessionDoc>('sessions'),
  passkeys: db.collection<PasskeyDoc>('passkeys'),
  webauthnChallenges: db.collection<WebauthnChallengeDoc>('webauthn_challenges'),
  connections: db.collection<ConnectionDoc>('connections'),
  accounts: db.collection<AccountDoc>('accounts'),
  transactions: db.collection<TransactionDoc>('transactions'),
  invoices: db.collection<InvoiceDoc>('invoices'),
  investments: db.collection<InvestmentDoc>('investments'),
  investmentSnapshots: db.collection<InvestmentSnapshotDoc>('investment_snapshots'),
  categoryRules: db.collection<CategoryRuleDoc>('category_rules'),
  recurrences: db.collection<RecurrenceDoc>('recurrences'),
  charges: db.collection<ChargeDoc>('charges'),
  budgets: db.collection<BudgetDoc>('budgets'),
  shoppingItems: db.collection<ShoppingItemDoc>('shopping_items'),
  bills: db.collection<BillDoc>('bills'),
  merchantGroups: db.collection<MerchantGroupDoc>('merchant_groups'),
  debtSources: db.collection<DebtSourceDoc>('debt_sources'),
  commitments: db.collection<CommitmentDoc>('commitments'),
  alerts: db.collection<AlertDoc>('alerts'),
  pushSubscriptions: db.collection<PushSubscriptionDoc>('push_subscriptions'),
  jobRuns: db.collection<JobRunDoc>('job_runs'),
  shoppingLists: db.collection<ShoppingListDoc>('shopping_lists'),
  goals: db.collection<GoalDoc>('goals'),
  financialProfiles: db.collection<FinancialProfileDoc>('financial_profiles'),
  fixedExpenses: db.collection<FixedExpenseDoc>('fixed_expenses'),
  loans: db.collection<LoanDoc>('loans'),
  spendingLimits: db.collection<SpendingLimitDoc>('spending_limits'),
  healthSnapshots: db.collection<HealthSnapshotDoc>('health_snapshots'),
  goalDrafts: db.collection<GoalDraftDoc>('goal_drafts'),
  purchaseEvaluations: db.collection<PurchaseEvaluationDoc>('purchase_evaluations'),
  agentSessions: db.collection<AgentSessionDoc>('agent_sessions'),
  agentContestations: db.collection<AgentContestationDoc>('agent_contestations'),
  auditLogs: db.collection<AuditLogDoc>('audit_logs'),
});
