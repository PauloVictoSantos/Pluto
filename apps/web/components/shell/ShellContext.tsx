'use client';

import { createContext, useContext } from 'react';
import type { NavId } from '@/lib/nav';
import type { Mode } from '@/lib/viewport';

export interface Shell {
  mode: Mode;
  nav: (id: NavId) => void;
  openChat: () => void;
}

export const ShellContext = createContext<Shell>({ mode: 'desktop', nav: () => {}, openChat: () => {} });
export const useShell = () => useContext(ShellContext);
