import {
  AccountSchema,
  CategoryRuleSchema,
  SetCategoryResultSchema,
  SimilarSchema,
  BudgetSchema,
  CardSchema,
  CommitmentsSchema,
  BillSchema,
  BudgetSuggestionSchema,
  ForecastSchema,
  FinancialHealthSchema,
  MerchantGroupsSchema,
  FinancialProfileSchema,
  FixedExpensesSchema,
  LoansSchema,
  SpendingLimitSchema,
  GoalDraftSchema,
  GoalsPlanSchema,
  PurchaseEvaluationSchema,
  PurchasesSchema,
  AgentChatStateSchema,
  ContestationsSchema,
  ExportFileSchema,
  ObligationsSchema,
  InvestmentBoxesSchema,
  ReceiptDraftSchema,
  ReceiptSchema,
  ShoppingInsightsSchema,
  type ReceiptDraft,
  MonthlyPlanSchema,
  type AdjustMonthlyPlan,
  IncomeProfilesSchema,
  type CreateIncomeProfile,
  type UpdateIncomeProfile,
  type SaveCategoryRules,
  type PurchaseRequest,
  type GoalAnswers,
  type GoalKindV2,
  type GoalScenario,
  LoanExtraSchema,
  type CreateLoan,
  type UpdateLoan,
  type CreateFixedExpense,
  type UpdateFixedExpense,
  type UpdateFinancialProfile,
  DebtSourceSchema,
  AlertSchema,
  AlertSettingsSchema,
  PatternsSchema,
  GoalInsightsSchema,
  PaymentPlanSchema,
  CatalogSchema,
  ClosedListSchema,
  ListHistorySchema,
  ResolveItemResultSchema,
  ShoppingListSchema,
  type ShoppingCategory,
  type Unit,
  ConnectionSchema,
  DashboardSummarySchema,
  DashboardSeriesSchema,
  GoalSchema,
  InvestmentsSchema,
  InvoiceSchema,
  SpendingSchema,
  HealthSchema,
  MeSchema,
  ChargeSchema,
  MfaChallengeSchema,
  PasskeyOptionsSchema,
  PasskeySchema,
  SyncResultSchema,
  TokensSchema,
  TransactionPageSchema,
  TransactionSummarySchema,
  type ApiError,
  CreateChargeSchema,
  type TransactionQuery,
} from '@pluto/shared';
import { z } from 'zod';

export type CreateChargeInput = z.input<typeof CreateChargeSchema>;

// Web: mesma origem (o Next repassa /v1 para a API). Mobile: URL absoluta da API.
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/v1';

// Access token so em memoria, nunca em localStorage (secao 6.2). O refresh fica em cookie HttpOnly.
let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => void (accessToken = t);
export const hasAccessToken = () => !!accessToken;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let onSessionLost: () => void = () => {};
/** Chamado quando a sessao nao pode mais ser renovada (o app volta para o login). */
export const setOnSessionLost = (fn: () => void) => void (onSessionLost = fn);

/** Opcoes extras: retry (padrao so em GET), timeout (60 s) e quiet (nao mostra "Preparando o Pluto..."). */
export type RequestOpts = RequestInit & { retry?: boolean; timeoutMs?: number; quiet?: boolean };

/**
 * Esperas entre tentativas quando a conexao falha ou o servidor ainda esta acordando
 * (doc. Melhorias, passo 2): 3 novas tentativas antes de mostrar qualquer aviso.
 */
export const RETRY_DELAYS = [1_000, 3_000, 6_000];
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** So para testes. */
export const setSleep = (fn: typeof sleep) => void (sleep = fn);

// Requisicoes em nova tentativa: o app mostra "Preparando o Pluto..." enquanto houver alguma.
let retrying = 0;
let onConnecting: (on: boolean) => void = () => {};
export const setOnConnecting = (fn: (on: boolean) => void) => void (onConnecting = fn);

export const OFFLINE = 'NETWORK';
const offline = () => new ApiRequestError(0, OFFLINE, 'Não conseguimos falar com o Pluto agora. Confira sua internet e tente de novo.');

/** Resposta de gateway (Render acordando, proxy sem a API): sem o JSON de erro da propria API. */
const isGatewayError = (res: Response) => [502, 503, 504].includes(res.status) && !res.headers.get('content-type')?.includes('application/json');

async function raw(path: string, init: RequestOpts = {}): Promise<Response> {
  const { retry = !init.method || init.method === 'GET', timeoutMs = 60_000, quiet = false, ...req } = init;
  const headers = new Headers(req.headers);
  if (req.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let counted = false;
  try {
    for (let attempt = 0; ; attempt++) {
      // O token pode ter sido renovado durante a espera.
      if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
      try {
        const res = await fetch(`${BASE_URL}${path}`, { ...req, headers, credentials: 'include', signal: AbortSignal.timeout(timeoutMs) });
        if (!retry || attempt >= RETRY_DELAYS.length || !isGatewayError(res)) return res;
      } catch {
        if (!retry || attempt >= RETRY_DELAYS.length) throw offline();
      }
      if (!quiet && !counted) {
        counted = true;
        if (retrying++ === 0) onConnecting(true);
      }
      await sleep(RETRY_DELAYS[attempt]!);
    }
  } finally {
    if (counted && --retrying === 0) onConnecting(false);
  }
}

async function toError(res: Response): Promise<ApiRequestError> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  if (!body?.error) return offline();
  return new ApiRequestError(res.status, body.error.code, body.error.message);
}

// Uma unica renovacao por vez: varias requisicoes com 401 esperam a mesma.
let refreshing: Promise<boolean> | null = null;
/**
 * true: sessao renovada; false: sem sessao (cookie ausente ou expirado).
 * Sem conexao lanca ApiRequestError(OFFLINE): falta de rede nao e motivo para deslogar.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await raw('/auth/refresh', { method: 'POST', retry: true });
      if (!res.ok) {
        if (isGatewayError(res)) throw offline();
        return false;
      }
      setAccessToken(TokensSchema.parse(await res.json()).accessToken);
      return true;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function request<T>(path: string, init: RequestOpts = {}, schema?: z.ZodType<T>): Promise<T> {
  let res = await raw(path, init);
  // Access token expirado (15 min): renova pelo cookie e tenta de novo uma vez.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const err = await toError(res.clone());
    if (err.code === 'UNAUTHORIZED') {
      if (await refreshSession()) res = await raw(path, init);
      else {
        onSessionLost();
        throw err;
      }
    }
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return schema ? schema.parse(json) : (json as T);
}

const post = (body?: unknown, opts: RequestOpts = {}): RequestOpts => ({ ...opts, method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
/** POST sem efeito colateral repetivel (login, desafio de passkey): pode tentar de novo. */
const postRetry = (body?: unknown) => post(body, { retry: true });

export const api = {
  health: () => request('/health', {}, HealthSchema),
  /** Leve (sem banco): acorda o servidor ao abrir o app. */
  wake: () => request('/health/live', { timeoutMs: 90_000 }, z.object({ status: z.literal('ok') })),

  login: (cpf: string, password: string) => request('/auth/login', postRetry({ cpf, password }), MfaChallengeSchema),
  async verifyMfa(mfaToken: string, code: string, remember: boolean) {
    const t = await request('/auth/2fa/verify', post({ mfaToken, code, remember }), TokensSchema);
    setAccessToken(t.accessToken);
  },
  async reauth(password: string, code: string) {
    const t = await request('/auth/reauth', post({ password, code }), TokensSchema);
    setAccessToken(t.accessToken);
  },
  async logout() {
    try {
      await request('/auth/logout', post());
    } finally {
      setAccessToken(null);
    }
  },
  me: () => request('/me', {}, MeSchema),
  updateMe: (patch: { name?: string; phone?: string | null; email?: string; cpf?: string }) =>
    request('/me', { method: 'PATCH', body: JSON.stringify(patch) }, MeSchema),

  // Cobrancas por boleto (Stripe).
  chargesStatus: () => request('/charges/status', {}, z.object({ enabled: z.boolean(), testMode: z.boolean(), emailEnabled: z.boolean() })),
  charges: () => request('/charges', {}, z.array(ChargeSchema)),
  createCharge: (body: CreateChargeInput) => request('/charges', post(body), ChargeSchema),
  refreshCharges: () => request('/charges/refresh', post(), z.array(ChargeSchema)),
  cancelCharge: (id: string) => request(`/charges/${id}/cancel`, post(), ChargeSchema),
  sendCharge: (id: string, n: number | null) => request(`/charges/${id}/send`, post({ n }), ChargeSchema),
  closeInstallment: (id: string, n: number, outcome: 'CANCEL' | 'RECEIVED') =>
    request(`/charges/${id}/installments/${n}/close`, post({ outcome }), ChargeSchema),

  // Passkeys (biometria do aparelho). As opcoes e respostas vao direto para o WebAuthn do navegador.
  passkeys: () => request('/auth/passkeys', {}, z.array(PasskeySchema)),
  passkeyRegisterOptions: () => request('/auth/passkeys/register/options', post(), PasskeyOptionsSchema),
  passkeyRegister: (challengeId: string, response: unknown, name?: string) =>
    request('/auth/passkeys/register/verify', post({ challengeId, response, name }), PasskeySchema),
  removePasskey: (id: string) => request<void>(`/auth/passkeys/${id}`, { method: 'DELETE' }),
  passkeyLoginOptions: () => request('/auth/passkeys/login/options', postRetry(), PasskeyOptionsSchema),
  async passkeyLogin(challengeId: string, response: unknown, remember: boolean) {
    const t = await request('/auth/passkeys/login/verify', post({ challengeId, response, remember }), TokensSchema);
    setAccessToken(t.accessToken);
  },

  // Camada analitica: numeros prontos do servidor (o navegador nao calcula previsoes).
  commitments: () => request('/analytics/commitments', {}, CommitmentsSchema),
  forecast: () => request('/analytics/forecast', {}, ForecastSchema),
  budgetSuggestion: () => request('/analytics/budget', {}, BudgetSuggestionSchema),
  goalInsights: () => request('/analytics/goals', {}, GoalInsightsSchema),
  paymentPlan: () => request('/analytics/payments', {}, PaymentPlanSchema),
  patterns: () => request('/analytics/patterns', {}, PatternsSchema),
  financialHealth: () => request('/analytics/health', {}, FinancialHealthSchema),

  // Dividas manuais (cartao de terceiro, boleto ou Pix fora do Open Finance).
  debts: () => request('/debts', {}, z.array(DebtSourceSchema)),
  createDebtSource: (b: Record<string, unknown>) => request('/debts/sources', post(b), z.array(DebtSourceSchema)),
  updateDebtSource: (id: string, b: Record<string, unknown>) =>
    request(`/debts/sources/${id}`, { method: 'PATCH', body: JSON.stringify(b) }, z.array(DebtSourceSchema)),
  deleteDebtSource: (id: string) => request(`/debts/sources/${id}`, { method: 'DELETE' }, z.array(DebtSourceSchema)),
  createCommitment: (b: Record<string, unknown>) => request('/debts/commitments', post(b), z.array(DebtSourceSchema)),
  updateCommitment: (id: string, b: Record<string, unknown>) =>
    request(`/debts/commitments/${id}`, { method: 'PATCH', body: JSON.stringify(b) }, z.array(DebtSourceSchema)),
  deleteCommitment: (id: string) => request(`/debts/commitments/${id}`, { method: 'DELETE' }, z.array(DebtSourceSchema)),

  // Estabelecimentos agrupados (similaridade + IA), editaveis.
  goalDrafts: () => request('/agent/goal-drafts', {}, z.array(GoalDraftSchema)),
  goalDraft: (id: string) => request(`/agent/goal-drafts/${id}`, {}, GoalDraftSchema),
  createGoalDraft: (kind: GoalKindV2, title: string) => request('/agent/goal-drafts', post({ kind, title }), GoalDraftSchema),
  answerGoalDraft: (id: string, answers: GoalAnswers) => request(`/agent/goal-drafts/${id}`, { method: 'PATCH', body: JSON.stringify(answers) }, GoalDraftSchema),
  diagnoseGoalDraft: (id: string) => request(`/agent/goal-drafts/${id}/diagnose`, post(), GoalDraftSchema),
  confirmGoalDraft: (id: string, scenario: GoalScenario['key']) => request(`/agent/goal-drafts/${id}/confirm`, post({ scenario }), GoalDraftSchema),
  discardGoalDraft: (id: string, reason: string) => request(`/agent/goal-drafts/${id}/discard`, post({ reason }), GoalDraftSchema),
  goalsPlan: () => request('/agent/goals/plan', {}, GoalsPlanSchema),
  setGoalStatus: (id: string, status: 'ativa' | 'pausada' | 'concluida') => request(`/agent/goals/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, GoalsPlanSchema),
  purchases: () => request('/agent/purchases', {}, PurchasesSchema),
  evaluatePurchase: (body: PurchaseRequest) => request('/agent/purchases', post(body), PurchaseEvaluationSchema),
  purchaseAction: (id: string, what: 'plan' | 'bought' | 'give-up') => request(`/agent/purchases/${id}/${what}`, post(), PurchaseEvaluationSchema),
  purchaseToGoal: (id: string) => request(`/agent/purchases/${id}/to-goal`, post(), GoalDraftSchema),
  spendingLimit: () => request('/agent/limit', {}, SpendingLimitSchema),
  overrideLimit: (amountMinor: number | null) => request('/agent/limit/override', { method: 'PUT', body: JSON.stringify({ amountMinor }) }, SpendingLimitSchema),
  loans: () => request('/agent/loans', {}, LoansSchema),
  createLoan: (body: CreateLoan) => request('/agent/loans', post(body), LoansSchema),
  updateLoan: (id: string, body: UpdateLoan) => request(`/agent/loans/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, LoansSchema),
  deleteLoan: (id: string) => request(`/agent/loans/${id}`, { method: 'DELETE' }, LoansSchema),
  loanExtra: (id: string, amountMinor: number) => request(`/agent/loans/${id}/extra?amountMinor=${amountMinor}`, {}, LoanExtraSchema),
  fixedExpenses: () => request('/agent/fixed-expenses', {}, FixedExpensesSchema),
  createFixedExpense: (body: CreateFixedExpense) => request('/agent/fixed-expenses', post(body), FixedExpensesSchema),
  updateFixedExpense: (id: string, body: UpdateFixedExpense) =>
    request(`/agent/fixed-expenses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, FixedExpensesSchema),
  deleteFixedExpense: (id: string) => request(`/agent/fixed-expenses/${id}`, { method: 'DELETE' }, FixedExpensesSchema),
  dismissFixedSuggestion: (matchKey: string) => request('/agent/fixed-expenses/suggestions/dismiss', post({ matchKey }), FixedExpensesSchema),
  /** Planejamento automatico do mes (dia 1): null antes de gerar. */
  monthlyPlan: (month?: string) => request(`/planning/monthly${month ? `?month=${month}` : ''}`, {}, MonthlyPlanSchema.nullable()),
  generateMonthlyPlan: () => request('/planning/monthly/generate', post(), MonthlyPlanSchema),
  adjustMonthlyPlan: (month: string, b: AdjustMonthlyPlan) => request(`/planning/monthly/${month}`, { method: 'PATCH', body: JSON.stringify(b) }, MonthlyPlanSchema),
  /** Perfis financeiros (ate 2): a soma das rendas e a renda do plano. */
  incomeProfiles: () => request('/agent/income-profiles', {}, IncomeProfilesSchema),
  createIncomeProfile: (b: CreateIncomeProfile) => request('/agent/income-profiles', post(b), IncomeProfilesSchema),
  updateIncomeProfile: (id: string, b: UpdateIncomeProfile) => request(`/agent/income-profiles/${id}`, { method: 'PATCH', body: JSON.stringify(b) }, IncomeProfilesSchema),
  deleteIncomeProfile: (id: string) => request(`/agent/income-profiles/${id}`, { method: 'DELETE' }, IncomeProfilesSchema),
  /** Dividas do mes (faturas, parcelamentos, fixos, emprestimos): a mesma lista do Plutao. */
  obligations: () => request('/agent/obligations', {}, ObligationsSchema),
  financialProfile: () => request('/agent/profile', {}, FinancialProfileSchema),
  updateFinancialProfile: (body: UpdateFinancialProfile) => request('/agent/profile', { method: 'PUT', body: JSON.stringify(body) }, FinancialProfileSchema),
  merchantGroups: () => request('/merchant-groups', {}, MerchantGroupsSchema),
  refreshMerchantGroups: () => request('/merchant-groups/refresh', post(), MerchantGroupsSchema),
  updateMerchantGroup: (id: string, body: { name?: string; categoryKey?: string | null }) =>
    request(`/merchant-groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, MerchantGroupsSchema),
  mergeMerchantGroup: (id: string, intoId: string) => request(`/merchant-groups/${id}/merge`, post({ intoId }), MerchantGroupsSchema),
  removeMerchantKey: (id: string, key: string) =>
    request(`/merchant-groups/${id}/keys`, { method: 'DELETE', body: JSON.stringify({ key }) }, MerchantGroupsSchema),

  // Alertas: painel do sino, canais e Web Push.
  alerts: () => request('/alerts', {}, z.array(AlertSchema)),
  markAlertsRead: () => request<void>('/alerts/read', post()),
  alertFeedback: (id: string, feedback: 'useful' | 'not_useful') =>
    request(`/alerts/${id}`, { method: 'PATCH', body: JSON.stringify({ feedback }) }, AlertSchema),
  alertSettings: () => request('/alerts/settings', {}, AlertSettingsSchema),
  updateAlertSettings: (patch: { push?: boolean; email?: boolean }) =>
    request('/alerts/settings', { method: 'PATCH', body: JSON.stringify(patch) }, AlertSettingsSchema),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => request('/push/subscribe', post(sub), AlertSettingsSchema),
  pushUnsubscribe: (endpoint: string) => request('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }, AlertSettingsSchema),
  testAlert: () => request('/alerts/test', post(), z.object({ channels: z.array(z.enum(['push', 'email'])) })),

  // Boletos a pagar (cadastro manual ou pela linha digitavel).
  bills: () => request('/bills', {}, z.array(BillSchema)),
  createBill: (b: { payee: string; line?: string; amountMinor?: number; dueDate?: string }) => request('/bills', post(b), BillSchema),
  updateBill: (id: string, patch: { status?: 'paid' | 'pending'; transactionId?: string }) =>
    request(`/bills/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, BillSchema),
  deleteBill: (id: string) => request<void>(`/bills/${id}`, { method: 'DELETE' }),

  // Lista de compras do mes.
  /** Caixinhas: card por aplicacao com rendimento projetado e meta ligada. */
  investmentBoxes: () => request('/investments/boxes', {}, InvestmentBoxesSchema),
  linkBoxGoal: (id: string, goalId: string | null) => request(`/investments/boxes/${id}/goal`, { method: 'PUT', body: JSON.stringify({ goalId }) }, InvestmentBoxesSchema),
  shoppingList: () => request('/shopping/list', {}, ShoppingListSchema),
  /** Cupom: QR (SEFAZ) ou foto (IA, com consentimento). A foto vai so nesta chamada. */
  scanReceipt: (body: { qr: string } | { image: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string } }) =>
    request('/shopping/receipts/scan', post(body, { timeoutMs: 60_000 }), ReceiptDraftSchema),
  saveReceipt: (d: ReceiptDraft) => request('/shopping/receipts', post(d), ReceiptSchema),
  shoppingInsights: () => request('/shopping/insights', {}, ShoppingInsightsSchema),
  addShoppingEntry: (body: { raw?: string; itemId?: string; qty?: number; confirm?: { name: string; category: ShoppingCategory; unit: Unit } }) =>
    request('/shopping/list/entries', post(body), ShoppingListSchema),
  updateShoppingEntry: (itemId: string, patch: { bought?: boolean; priceMinor?: number | null; qty?: number; removed?: boolean }) =>
    request(`/shopping/list/entries/${itemId}`, { method: 'PATCH', body: JSON.stringify(patch) }, ShoppingListSchema),
  dismissSuggestion: (itemId: string) => request(`/shopping/list/suggestions/${itemId}/dismiss`, post(), ShoppingListSchema),
  answerMarket: (transactionId: string, itemIds: string[]) => request('/shopping/list/market', post({ transactionId, itemIds }), ShoppingListSchema),
  copyShopping: (month: string, itemIds: string[]) => request('/shopping/list/copy', post({ month, itemIds }), ShoppingListSchema),
  resolveItem: (raw: string) => request('/shopping/items/resolve', post({ raw }), ResolveItemResultSchema),
  shoppingCatalog: () => request('/shopping/items', {}, CatalogSchema),
  shoppingHistory: () => request('/shopping/lists', {}, ListHistorySchema),
  closedShoppingList: (month: string) => request(`/shopping/lists/${month}`, {}, ClosedListSchema),

  connections: () => request('/connections', {}, z.array(ConnectionSchema)),
  importConnection: (itemId: string) => request('/connections/import', post({ itemId }), ConnectionSchema),
  syncConnection: (id: string) => request(`/connections/${id}/sync`, post(), SyncResultSchema),
  removeConnection: (id: string, keepHistory: boolean) =>
    request<void>(`/connections/${id}?keepHistory=${keepHistory}`, { method: 'DELETE' }),

  accounts: () => request('/accounts', {}, z.array(AccountSchema)),
  summary: () => request('/dashboard/summary', {}, DashboardSummarySchema),
  series: () => request('/dashboard/series', {}, DashboardSeriesSchema),
  spending: (month?: string) => request(`/dashboard/spending${month ? `?month=${month}` : ''}`, {}, SpendingSchema),
  investments: () => request('/dashboard/investments', {}, InvestmentsSchema),
  cards: () => request('/cards', {}, z.array(CardSchema)),
  invoices: (from?: Date, to?: Date) => {
    const p = new URLSearchParams();
    if (from) p.set('from', from.toISOString());
    if (to) p.set('to', to.toISOString());
    return request(`/invoices?${p}`, {}, z.array(InvoiceSchema));
  },
  budget: (month: string) => request(`/budgets?month=${month}`, {}, BudgetSchema),
  putBudget: (month: string, items: { categoryKey: string; limitMinor: number }[]) =>
    request('/budgets', { method: 'PUT', body: JSON.stringify({ month, items }) }, BudgetSchema),
  goals: () => request('/goals', {}, z.array(GoalSchema)),
  createGoal: (g: { name: string; targetMinor: number; deadline: string; icon?: string; savedMinor?: number; priority?: number }) =>
    request('/goals', post(g), GoalSchema),
  updateGoal: (id: string, patch: { addMinor?: number; monthlyContributionMinor?: number; name?: string; targetMinor?: number; deadline?: string; priority?: number }) =>
    request(`/goals/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, GoalSchema),
  deleteGoal: (id: string) => request<void>(`/goals/${id}`, { method: 'DELETE' }),
  similar: (id: string) => request(`/transactions/${id}/similar`, {}, SimilarSchema),
  setCategory: (id: string, categoryKey: string, applyToSimilar: boolean) =>
    request(`/transactions/${id}/category`, { method: 'PATCH', body: JSON.stringify({ categoryKey, applyToSimilar }) }, SetCategoryResultSchema),
  renameTransaction: (id: string, name: string | null) => request(`/transactions/${id}/rename`, post({ name }), z.object({ name: z.string().nullable() })),
  categoryRules: () => request('/category-rules', {}, z.array(CategoryRuleSchema)),
  deleteCategoryRule: (id: string) => request<void>(`/category-rules/${id}`, { method: 'DELETE' }),
  /** Modal de regras: adicionar, mover e remover de uma vez. */
  saveCategoryRules: (b: SaveCategoryRules) => request('/category-rules', { method: 'PUT', body: JSON.stringify(b) }, z.array(CategoryRuleSchema)),
  exportMyData: (format: 'json' | 'csv') => request(`/me/export?format=${format}`, {}, ExportFileSchema),
  deleteAccount: () => request<void>('/me', { method: 'DELETE', body: JSON.stringify({ confirm: 'EXCLUIR' }) }),
  setAiConsent: (accept: boolean) => request<void>('/agent/consent', post({ accept })),
  contestations: () => request('/agent/contestations', {}, ContestationsSchema),
  contest: (subject: string, text: string) => request('/agent/contestations', post({ subject, text }), ContestationsSchema),
  agentChat: () => request('/agent/chat', {}, AgentChatStateSchema),
  /** clientId repetido no reenvio: o servidor nao duplica a mensagem. Sem tela de "Preparando": o chat mostra o proprio aviso. */
  sendAgentMessage: (message: string, clientId: string) => request('/agent/chat', post({ message, clientId }, { retry: true, quiet: true }), AgentChatStateSchema),
  resetAgentChat: () => request('/agent/chat/reset', post(), AgentChatStateSchema),
  transactionSummary: (from: Date, to?: Date) =>
    request(`/transactions/summary?from=${from.toISOString()}${to ? `&to=${to.toISOString()}` : ''}`, {}, TransactionSummarySchema),
  transactions: (q: Partial<Omit<TransactionQuery, 'from' | 'to' | 'limit'>> & { from?: Date; to?: Date; limit?: number } = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, v instanceof Date ? v.toISOString() : String(v));
    return request(`/transactions?${params}`, {}, TransactionPageSchema);
  },
};
