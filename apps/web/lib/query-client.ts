import { QueryClient } from '@tanstack/react-query';

/**
 * Cache dos dados da API. Unico por aba e limpo a cada troca de sessao (lib/store): as chaves
 * nao levam o usuario, entao nada da conta anterior pode sobrar para a proxima.
 * Os dados so sao buscados no navegador; no build estatico o cache fica vazio.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});
