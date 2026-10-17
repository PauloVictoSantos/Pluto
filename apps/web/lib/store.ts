'use client';

import { useSyncExternalStore } from 'react';
import { MOCK, applyPlan, type Plan } from './mock/data';

export type Theme = 'light' | 'dark';
export interface User {
  name: string;
  email: string;
  phone: string;
  cpf: string;
}
export interface LoginMsg {
  kind: 'info' | 'error';
  text: string;
}

interface AppState {
  hydrated: boolean;
  theme: Theme;
  session: boolean;
  booting: boolean;
  user: User;
  loginMsg: LoginMsg | null;
  plan: Plan | null;
}

const initial: AppState = {
  hydrated: false,
  theme: 'light',
  session: false,
  booting: false,
  user: { ...MOCK.user },
  loginMsg: null,
  plan: null,
};

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

export function hydrate() {
  if (state.hydrated) return;
  const theme = read('pluto-theme') === 'dark' ? 'dark' : 'light';
  let user = state.user;
  let plan: Plan | null = null;
  try {
    user = { ...user, ...JSON.parse(read('pluto-user') || '{}') };
    plan = JSON.parse(read('pluto-plan') || 'null');
  } catch {
    /* dado corrompido: ignora */
  }
  applyPlan(plan);
  document.documentElement.dataset.theme = theme;
  // MOCK: flag de sessao sem segredo. A autenticacao real usa refresh token em cookie
  // HttpOnly (web) ou Keychain/Keystore (mobile) - secao 6.2. Nada de token em localStorage.
  set({ hydrated: true, theme, user, plan, session: read('pluto-session') === '1' });
}

export function setTheme(theme: Theme) {
  write('pluto-theme', theme);
  document.documentElement.dataset.theme = theme;
  set({ theme });
}

export function login(remember: boolean) {
  if (remember) write('pluto-session', '1');
  set({ session: true, booting: true, loginMsg: null });
}

export const finishBoot = () => set({ booting: false });

export function logout() {
  write('pluto-session', null);
  set({ session: false, loginMsg: { kind: 'info', text: `Até logo, ${state.user.name.split(' ')[0]}! Você saiu da sua conta.` } });
}

export const consumeLoginMsg = () => {
  const m = state.loginMsg;
  if (m) set({ loginMsg: null });
  return m;
};

export function setUser(patch: Partial<User>) {
  const user = { ...state.user, ...patch };
  write('pluto-user', JSON.stringify(user));
  set({ user });
}

export function savePlan(plan: Plan) {
  write('pluto-plan', JSON.stringify(plan));
  applyPlan(plan);
  set({ plan });
}
