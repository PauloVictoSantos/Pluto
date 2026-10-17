'use client';

import type { Me } from '@pluto/shared';
import { useSyncExternalStore } from 'react';
import { api, refreshSession, setOnSessionLost } from './api';
import { applyPlan, type Plan } from './mock/data';

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
  session: boolean;
  booting: boolean;
  user: User | null;
  loginMsg: LoginMsg | null;
  plan: Plan | null;
}

const initial: AppState = { hydrated: false, theme: 'light', session: false, booting: false, user: null, loginMsg: null, plan: null };

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

// localStorage so para preferencias sem dados sensiveis (tema, plano mock).
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

setOnSessionLost(() => {
  if (state.session) set({ session: false, user: null, loginMsg: { kind: 'info', text: 'Sua sessão expirou. Entre novamente.' } });
});

let hydrating: Promise<void> | null = null;
/** Restaura tema e sessao. A sessao vem do cookie HttpOnly: nada de token no navegador. */
export function hydrate() {
  hydrating ??= (async () => {
    const theme = read('pluto-theme') === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    let plan: Plan | null = null;
    try {
      plan = JSON.parse(read('pluto-plan') || 'null');
    } catch {
      /* dado corrompido: ignora */
    }
    applyPlan(plan);
    write('pluto-session', null); // flag do mock antigo
    write('pluto-user', null);

    let user: User | null = null;
    if (await refreshSession()) user = await api.me().catch(() => null);
    set({ hydrated: true, theme, plan, session: !!user, user });
  })();
  return hydrating;
}

export function setTheme(theme: Theme) {
  write('pluto-theme', theme);
  document.documentElement.dataset.theme = theme;
  set({ theme });
}

/** Depois do 2FA: carrega o perfil e mostra a tela "Organizando suas contas". */
export async function completeLogin() {
  const user = await api.me();
  set({ session: true, booting: true, user, loginMsg: null });
}

export const finishBoot = () => set({ booting: false });

export async function logout() {
  const first = state.user?.name.split(' ')[0];
  await api.logout().catch(() => {});
  set({ session: false, user: null, loginMsg: { kind: 'info', text: first ? `Até logo, ${first}! Você saiu da sua conta.` : 'Você saiu da sua conta.' } });
}

export const consumeLoginMsg = () => {
  const m = state.loginMsg;
  if (m) set({ loginMsg: null });
  return m;
};

export const setUser = (user: User) => set({ user });

export function savePlan(plan: Plan) {
  write('pluto-plan', JSON.stringify(plan));
  applyPlan(plan);
  set({ plan });
}
