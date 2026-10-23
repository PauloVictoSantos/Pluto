import { QueryClient, focusManager, useQuery, type QueryKey } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { ApiError } from '@/api';
import { useSession } from '@/auth/session';

// Dados da API com TanStack Query, como no site (mesmas chaves de cache). So em memoria: nada de
// dados financeiros salvo no aparelho (guia, secao 7).

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnReconnect: true },
    mutations: { retry: 0 },
  },
});

// Volta para o app = "janela em foco": refaz as consultas vencidas.
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
  return () => sub.remove();
});

/** Mensagem pronta para a tela a partir de qualquer erro. */
export const errorText = (e: unknown, fallback = 'Não foi possível carregar. Puxe para tentar de novo.') => (e instanceof ApiError ? e.message : e ? fallback : null);

/**
 * Consulta da API que so roda depois do desbloqueio e recarrega ao voltar para a tela.
 * `refresh` serve para o "puxar para atualizar".
 */
export function useApiQuery<T>(key: QueryKey, fn: () => Promise<T>, opts: { enabled?: boolean } = {}) {
  const { status } = useSession();
  const q = useQuery({ queryKey: key, queryFn: fn, enabled: status === 'signedIn' && opts.enabled !== false });
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (status === 'signedIn') void q.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]),
  );
  return { ...q, error: errorText(q.error), refresh: q.refetch, refreshing: q.isRefetching && !q.isLoading };
}

/** Consulta fora de uma tela (cabecalho, paineis): so liga depois do desbloqueio. */
export function useQueryLite<T>(fn: () => Promise<T>, key: QueryKey = [fn.name || 'lite']) {
  const { status } = useSession();
  return useQuery({ queryKey: key, queryFn: fn, enabled: status === 'signedIn' });
}

/** Apaga o cache ao sair da conta (outro usuario no mesmo aparelho nao ve nada). */
export function useClearOnSignOut() {
  const { status } = useSession();
  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status]);
}
