import { CLIENT_HEADER, TokensSchema, type ApiError as ApiErrorBody } from '@pluto/shared';
import type { z } from 'zod';

// Cliente da API do Pluto para o app (guia mobile, secao 5). Sem nada do Expo aqui dentro: o
// armazenamento do refresh token e o fetch entram por parametro (testavel no Vitest).
// Access token so em memoria; refresh token so no Keychain/Keystore (SecureStore).

/** Onde o refresh token fica guardado (no app: SecureStore). */
export interface TokenStore {
  getRefresh(): Promise<string | null>;
  setRefresh(token: string): Promise<void>;
  clear(): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiOptions {
  /** URL da API ja com /v1. */
  baseUrl: string;
  store: TokenStore;
  fetchFn?: typeof fetch;
  /** Render gratuito pode levar ~1 min para acordar. */
  timeoutMs?: number;
}

const NETWORK = 'Não foi possível falar com o servidor. Verifique sua internet e tente de novo.';

export function createApi({ baseUrl, store, fetchFn = (...a) => fetch(...a), timeoutMs = 70_000 }: ApiOptions) {
  let access: string | null = null;
  let refreshing: Promise<boolean> | null = null;
  let onSessionLost: () => void = () => {};

  async function raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    // O backend devolve o refresh no corpo (e nao em cookie) para este cliente.
    headers.set(CLIENT_HEADER, 'mobile');
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (access && !headers.has('authorization')) headers.set('authorization', `Bearer ${access}`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchFn(`${baseUrl}${path}`, { ...init, headers, signal: ctrl.signal });
    } catch {
      throw new ApiError(0, 'NETWORK', NETWORK);
    } finally {
      clearTimeout(timer);
    }
  }

  async function toError(res: Response): Promise<ApiError> {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? NETWORK);
  }

  /** Guarda os tokens do login/2FA/refresh. */
  async function setTokens(t: z.infer<typeof TokensSchema>) {
    access = t.accessToken;
    if (t.refreshToken) await store.setRefresh(t.refreshToken);
  }

  async function endSession() {
    access = null;
    await store.clear();
  }

  /** Renova a sessao pelo refresh token (rotativo). Uma renovacao por vez. */
  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const refreshToken = await store.getRefresh();
        if (!refreshToken) return false;
        const res = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) });
        if (!res.ok) {
          // Refresh recusado: a sessao acabou de vez. Erro de rede nao derruba a sessao.
          if (res.status === 401) await endSession();
          return false;
        }
        await setTokens(TokensSchema.parse(await res.json()));
        return true;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T>(path: string, init: RequestInit = {}, schema?: z.ZodType<T>): Promise<T> {
    const isAuth = path.startsWith('/auth/');
    // App reaberto: sem access em memoria, renova antes de chamar.
    if (!access && !isAuth) await refresh();
    let res = await raw(path, init);
    if (res.status === 401 && !isAuth) {
      const err = await toError(res.clone());
      if (err.code === 'UNAUTHORIZED') {
        if (await refresh()) res = await raw(path, init);
        else {
          await endSession();
          onSessionLost();
          throw new ApiError(401, 'SESSION_LOST', 'Sua sessão expirou. Entre novamente.');
        }
      }
    }
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json();
    return schema ? schema.parse(json) : (json as T);
  }

  return {
    request,
    setTokens,
    refresh,
    hasSession: async () => !!(await store.getRefresh()),
    /** Revoga o refresh no servidor e apaga tudo do aparelho (mesmo sem internet). */
    async logout() {
      const refreshToken = await store.getRefresh();
      if (refreshToken) await raw('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => null);
      await endSession();
    },
    setOnSessionLost: (fn: () => void) => void (onSessionLost = fn),
  };
}

export type Api = ReturnType<typeof createApi>;
