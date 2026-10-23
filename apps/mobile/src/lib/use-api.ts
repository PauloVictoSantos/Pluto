import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ApiError } from '@/api';
import { useSession } from '@/auth/session';

/**
 * Carrega dados da API sempre que a tela ganha foco (voltar para a aba ja atualiza) e no "puxar
 * para atualizar". So depois do desbloqueio: bloqueado, nada e buscado. Nada fica salvo no
 * aparelho: dados financeiros so em memoria (guia, secao 7). O `load` deve ser estavel
 * (funcao de modulo), senao recarrega a cada render.
 */
export function useApi<T>(load: () => Promise<T>) {
  const { status } = useSession();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNow = useCallback(async () => {
    try {
      const d = await load();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar. Puxe para tentar de novo.');
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (status === 'signedIn') void fetchNow();
    }, [fetchNow, status]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchNow();
    setRefreshing(false);
  }, [fetchNow]);

  return { data, setData, error, refreshing, refresh, loading: data === undefined && !error };
}
