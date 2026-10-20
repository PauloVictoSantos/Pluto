import {
  AccountSchema,
  AnswerSchema,
  CategoryRuleSchema,
  SetCategoryResultSchema,
  SimilarSchema,
  BudgetSchema,
  CardSchema,
  CommitmentsSchema,
  BillSchema,
  BudgetSuggestionSchema,
  ForecastSchema,
  MerchantGroupsSchema,
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

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  return fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: 'include' });
}

async function toError(res: Response): Promise<ApiRequestError> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return new ApiRequestError(res.status, body?.error.code ?? 'UNKNOWN', body?.error.message ?? 'Não foi possível falar com o servidor');
}

// Uma unica renovacao por vez: varias requisicoes com 401 esperam a mesma.
let refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await raw('/auth/refresh', { method: 'POST' });
      if (!res.ok) return false;
      setAccessToken(TokensSchema.parse(await res.json()).accessToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function request<T>(path: string, init: RequestInit = {}, schema?: z.ZodType<T>): Promise<T> {
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

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => request('/health', {}, HealthSchema),

  login: (cpf: string, password: string) => request('/auth/login', post({ cpf, password }), MfaChallengeSchema),
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
  passkeyLoginOptions: () => request('/auth/passkeys/login/options', post(), PasskeyOptionsSchema),
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
  shoppingList: () => request('/shopping/list', {}, ShoppingListSchema),
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
  ask: (question: string, history: { role: 'user' | 'pluto'; text: string }[]) =>
    request('/assistant/ask', post({ question, history }), AnswerSchema),
  transactionSummary: (from: Date, to?: Date) =>
    request(`/transactions/summary?from=${from.toISOString()}${to ? `&to=${to.toISOString()}` : ''}`, {}, TransactionSummarySchema),
  transactions: (q: Partial<Omit<TransactionQuery, 'from' | 'to' | 'limit'>> & { from?: Date; to?: Date; limit?: number } = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, v instanceof Date ? v.toISOString() : String(v));
    return request(`/transactions?${params}`, {}, TransactionPageSchema);
  },
};
