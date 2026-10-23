import {
  AccountSchema,
  BillSchema,
  BudgetSchema,
  CardSchema,
  DashboardSeriesSchema,
  DashboardSummarySchema,
  FinancialHealthSchema,
  ForecastSchema,
  InvestmentsSchema,
  MeSchema,
  SpendingSchema,
  TransactionPageSchema,
  type TransactionQuery,
} from '@pluto/shared';
import { z } from 'zod';
import { api } from '@/api';
import { ymdIn } from './dates';
import { useApiQuery, useQueryLite } from './use-api';

// Consultas da API com as MESMAS chaves do site (apps/web/lib/queries.ts): invalidar uma atualiza
// todas as telas que usam o mesmo dado.

const get = <T>(path: string, schema: z.ZodType<T>) => () => api.request(path, {}, schema);

export const loadMe = get('/me', MeSchema);
export const useMe = () => useQueryLite(loadMe, ['me']);
export const useTz = () => useMe().data?.settings.timezone ?? 'America/Manaus';
/** "YYYY-MM" do mes atual no fuso do usuario. */
export const useCurrentMonth = () => ymdIn(new Date(), useTz()).slice(0, 7);

export const useSummary = () => useApiQuery(['dashboard', 'summary'], get('/dashboard/summary', DashboardSummarySchema));
export const useSeries = () => useApiQuery(['dashboard', 'series'], get('/dashboard/series', DashboardSeriesSchema));
export const useSpending = (month?: string) =>
  useApiQuery(['dashboard', 'spending', month ?? 'current'], get(`/dashboard/spending${month ? `?month=${month}` : ''}`, SpendingSchema));
export const useInvestments = () => useApiQuery(['dashboard', 'investments'], get('/dashboard/investments', InvestmentsSchema));
export const useCards = () => useApiQuery(['cards'], get('/cards', z.array(CardSchema)));
export const useBills = () => useApiQuery(['bills'], get('/bills', z.array(BillSchema)));
export const useBudget = (month: string) => useApiQuery(['budgets', month], get(`/budgets?month=${month}`, BudgetSchema));
export const useForecast = () => useApiQuery(['analytics', 'forecast'], get('/analytics/forecast', ForecastSchema));
export const useHealth = () => useApiQuery(['analytics', 'health'], get('/analytics/health', FinancialHealthSchema));
export const useAccounts = () => useApiQuery(['accounts'], get('/accounts', z.array(AccountSchema)));

type TxQuery = Partial<Omit<TransactionQuery, 'from' | 'to' | 'limit'>> & { limit?: number };
export const loadTransactions = (q: TxQuery) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v));
  return api.request(`/transactions?${params}`, {}, TransactionPageSchema);
};
