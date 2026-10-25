'use client';

import type { Me } from '@pluto/shared';
import { useSyncExternalStore } from 'react';
import { api, ApiRequestError, OFFLINE, refreshSession, setOnConnecting, setOnSessionLost } from './api';
import { setValuesHidden } from './format';
import { quietEnter } from './motion';
import { queryClient } from './query-client';

export type Theme = 'light' | 'dark';
export type User = Me;
export interface LoginMsg {
  kind: 'info' | 'error';
  text: string;
}

interface AppState {
  /** true depois de tentar restaurar a sessao (refresh pelo cookie). */
  hydrated: boolean;
  theme: Theme;
  /** Ocultar valores em todas as telas ate o usuario clicar no olho de novo. */
  hideValues: boolean;
  session: boolean;
  booting: boolean;
  user: User | null;
  loginMsg: LoginMsg | null;
  /** Servidor acordando ou conexao instavel: mostra "Preparando o Pluto...". */
  connecting: boolean;
}

const initial: AppState = { hydrated: false, theme: 'light', hideValues: false, session: false, booting: false, user: null, loginMsg: null, connecting: false };

let state = initial;
const subs = new Set<() => void>();
const set = (patch: Partial<AppState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** Seletores devem retornar valores estaveis (primitivos ou referencias do estado). */
export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(initial));
}

// localStorage so para preferencias sem dados sensiveis (tema).
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* armazenamento indisponivel */
  }
};

// Dados em cache pertencem a quem estava logado: somem em toda troca de sessao.
const clearData = () => queryClient.clear();

setOnSessionLost(() => {
  clearData();
  if (state.session) set({ session: false, user: null, loginMsg: { kind: 'info', text: 'Sua sessão expirou. Entre novamente.' } });
});

setOnConnecting((connecting) => set({ connecting }));

/** Ao abrir: o servidor pode estar dormindo. Se demorar, mostra "Preparando o Pluto..." enquanto acorda. */
async function wakeServer() {
  const slow = setTimeout(() => set({ connecting: true }), 1_200);
  try {
    await api.wake();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(slow);
    set({ connecting: false });
  }
}

let hydrating: Promise<void> | null = null;
/** Restaura tema e sessao. A sessao vem do cookie HttpOnly: nada de token no navegador. */
export function hydrate() {
  hydrating ??= (async () => {
    const theme = read('pluto-theme') === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    const hideValues = read('pluto-hide-values') === '1';
    setValuesHidden(hideValues);
    // Chaves do prototipo antigo (dados mock): nao sao mais usadas.
    for (const k of ['pluto-session', 'pluto-user', 'pluto-plan', 'pluto-page']) write(k, null);

    let user: User | null = null;
    let loginMsg: LoginMsg | null = null;
    try {
      if (!(await wakeServer())) throw new ApiRequestError(0, OFFLINE, '');
      if (await refreshSession()) user = await api.me();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === OFFLINE) loginMsg = { kind: 'error', text: 'Não conseguimos falar com o Pluto agora. Confira sua internet e tente de novo.' };
    }
    set({ hydrated: true, theme, hideValues, session: !!user, user, ...(loginMsg ? { loginMsg } : {}) });
  })();
  return hydrating;
}

/** Fica salvo no aparelho: continua oculto ao trocar de pagina, recarregar ou entrar de novo. */
export function setHideValues(hideValues: boolean) {
  write('pluto-hide-values', hideValues ? '1' : null);
  quietEnter();
  setValuesHidden(hideValues);
  set({ hideValues });
}

export function setTheme(theme: Theme) {
  write('pluto-theme', theme);
  document.documentElement.dataset.theme = theme;
  set({ theme });
}

/** Depois do 2FA: carrega o perfil e mostra a tela "Organizando suas contas". */
export async function completeLogin() {
  const user = await api.me();
  clearData();
  set({ session: true, booting: true, user, loginMsg: null });
}

export const finishBoot = () => set({ booting: false });

export async function logout() {
  const first = state.user?.name.split(' ')[0];
  await api.logout().catch(() => {});
  clearData();
  set({ session: false, user: null, loginMsg: { kind: 'info', text: first ? `Até logo, ${first}! Você saiu da sua conta.` : 'Você saiu da sua conta.' } });
}

export const consumeLoginMsg = () => {
  const m = state.loginMsg;
  if (m) set({ loginMsg: null });
  return m;
};

export const setUser = (user: User) => set({ user });
