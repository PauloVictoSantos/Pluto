import { createContext, useContext } from 'react';
import type { NavId } from '@/lib/nav';

/** O que as paginas podem pedir ao casco (como o useShell do site). */
export interface Shell {
  nav: (id: NavId) => void;
  openChat: () => void;
}

export const ShellContext = createContext<Shell>({ nav: () => {}, openChat: () => {} });
export const useShell = () => useContext(ShellContext);
