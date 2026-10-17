'use client';

import { useSyncExternalStore } from 'react';

export type Mode = 'mobile' | 'tablet' | 'desktop';

const subscribe = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};

/** Largura da janela; no prerender assume desktop (1280). */
export const useWidth = () => useSyncExternalStore(subscribe, () => window.innerWidth, () => 1280);

export const modeOf = (w: number): Mode => (w < 760 ? 'mobile' : w < 1200 ? 'tablet' : 'desktop');
export const useMode = () => modeOf(useWidth());

const noop = () => () => {};
/** false no prerender, true no cliente. */
export const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);
