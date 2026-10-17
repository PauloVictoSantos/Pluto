'use client';

import { animate, stagger, type DOMKeyframesDefinition } from 'motion';
import { useEffect, useLayoutEffect, type RefObject } from 'react';

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const;

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const seen = new WeakSet<Element>();

/**
 * Entrada em cascata do design: [data-anim] sobe e aparece, [data-grow] cresce na horizontal,
 * [data-rise] cresce na vertical, [data-spin] gira. Cada elemento anima uma unica vez.
 */
export function enter(root: HTMLElement | null) {
  if (!root || reducedMotion()) return;
  const pick = (sel: string) =>
    Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => !seen.has(el) && (seen.add(el), true));
  const a = pick('[data-anim]');
  if (a.length) animate(a, { opacity: [0, 1], y: [16, 0] }, { duration: 0.5, delay: stagger(0.05), ease: EASE });
  const g = pick('[data-grow]');
  if (g.length) animate(g, { scaleX: [0, 1] }, { duration: 0.9, delay: 0.25, ease: EASE });
  const r = pick('[data-rise]');
  if (r.length) animate(r, { scaleY: [0, 1] }, { duration: 0.7, delay: stagger(0.06, { startDelay: 0.2 }), ease: EASE });
  const s = pick('[data-spin]');
  if (s.length) animate(s, { rotate: [-120, 0], opacity: [0, 1] }, { duration: 0.9, ease: EASE });
}

/** Roda `enter` apos cada render, pegando elementos novos. */
export function useEnter(ref: RefObject<HTMLElement | null>) {
  useIsoLayoutEffect(() => enter(ref.current));
}

export function pop(el: Element | null, from?: DOMKeyframesDefinition) {
  if (!el || reducedMotion()) return;
  animate(el, from ?? { opacity: [0, 1], scale: [0.96, 1] }, SPRING);
}

export { animate, stagger };
