'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { ymdIn } from './datetime';
import { MESES, MESES_LONGOS, fmt } from './format';
import { useApp } from './store';

// Hooks de dados reais (TanStack Query). Chaves estaveis para invalidar apos sincronizar.

export const useTz = () => useApp((s) => s.user?.settings.timezone) ?? 'America/Manaus';

/** "YYYY-MM" do mes atual no fuso do usuario. */
export const useCurrentMonth = () => ymdIn(new Date(), useTz()).slice(0, 7);

export const useSummary = () => useQuery({ queryKey: ['dashboard', 'summary'], queryFn: api.summary });
export const useSpending = (month?: string) => useQuery({ queryKey: ['dashboard', 'spending', month ?? 'current'], queryFn: () => api.spending(month) });
export const useCards = (enabled = true) => useQuery({ queryKey: ['cards'], queryFn: api.cards, enabled });
export const useInvoices = (from?: Date, to?: Date) =>
  useQuery({ queryKey: ['invoices', from?.toISOString(), to?.toISOString()], queryFn: () => api.invoices(from, to) });
export const useInvestments = () => useQuery({ queryKey: ['dashboard', 'investments'], queryFn: api.investments });
export const useBudget = (month: string) => useQuery({ queryKey: ['budgets', month], queryFn: () => api.budget(month) });
export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: api.goals });
export const useConnections = () => useQuery({ queryKey: ['connections'], queryFn: api.connections });

// Formatacao de meses "YYYY-MM"
export const monthLong = (ym: string) => `${MESES_LONGOS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
export const monthShort = (ym: string) => MESES_LONGOS[+ym.slice(5) - 1]!.slice(0, 3);
export const monthLower = (ym: string) => MESES_LONGOS[+ym.slice(5) - 1]!.toLowerCase();
export const monthAbbr = (ym: string) => MESES[+ym.slice(5) - 1]!;
export const addMonth = (ym: string, n: number) => {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
/** Dias no mes e dias decorridos (no fuso), para projecoes (RN-21). */
export function monthProgress(ym: string, todayYmd: string) {
  const days = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate();
  const elapsed = todayYmd.slice(0, 7) === ym ? +todayYmd.slice(8) : days;
  return { days, elapsed, left: days - elapsed };
}

/** Dinheiro em centavos para exibicao. */
export const money = (minor: number) => fmt(minor / 100);
/** Variacao percentual com sinal, ou null se nao ha base. */
export const change = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);
