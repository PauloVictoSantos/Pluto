import {
  AccountSchema,
  AnswerSchema,
  CategoryRuleSchema,
  SetCategoryResultSchema,
  SimilarSchema,
  BudgetSchema,
  CardSchema,
  ConnectionSchema,
  DashboardSummarySchema,
  GoalSchema,
  InvestmentsSchema,
  InvoiceSchema,
  SpendingSchema,
  HealthSchema,
  MeSchema,
  MfaChallengeSchema,
  SyncResultSchema,
  TokensSchema,
  TransactionPageSchema,
  TransactionSummarySchema,
  type ApiError,
  type TransactionQuery,
} from '@pluto/shared';
import { z } from 'zod';

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

  login: (email: string, password: string) => request('/auth/login', post({ email, password }), MfaChallengeSchema),
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
  updateMe: (patch: { name?: string; phone?: string | null; email?: string }) =>
    request('/me', { method: 'PATCH', body: JSON.stringify(patch) }, MeSchema),

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
  createGoal: (g: { name: string; targetMinor: number; deadline: string; icon?: string; savedMinor?: number }) =>
    request('/goals', post(g), GoalSchema),
  updateGoal: (id: string, patch: { addMinor?: number; monthlyContributionMinor?: number; name?: string; targetMinor?: number; deadline?: string }) =>
    request(`/goals/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, GoalSchema),
  deleteGoal: (id: string) => request<void>(`/goals/${id}`, { method: 'DELETE' }),
  similar: (id: string) => request(`/transactions/${id}/similar`, {}, SimilarSchema),
  setCategory: (id: string, categoryKey: string, applyToSimilar: boolean) =>
    request(`/transactions/${id}/category`, { method: 'PATCH', body: JSON.stringify({ categoryKey, applyToSimilar }) }, SetCategoryResultSchema),
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
