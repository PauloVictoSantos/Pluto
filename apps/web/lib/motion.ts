'use client';

import { animate, stagger } from 'motion';
import { useEffect, useLayoutEffect, type RefObject } from 'react';

// Curvas do app (mesmos valores dos tokens --ease-* em globals.css).
export const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const EASE_DRAWER = 'cubic-bezier(0.32, 0.72, 0, 1)';
export const SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const;

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const seen = new WeakSet<Element>();

/**
 * Remontagem que nao e navegacao (ex.: ocultar valores): os elementos novos aparecem sem
 * a entrada em cascata, que so faz sentido ao chegar na pagina.
 */
let quietUntil = 0;
export const quietEnter = (ms = 400) => void (quietUntil = performance.now() + ms);

// Paginas visitadas varias vezes por dia: entrada curta e discreta (< 300 ms), so transform/opacity/clip-path.
const DURATION = 280;
const STEP = 40;
const MAX_STAGGER = 8; // listas longas nao ficam esperando a vez

/**
 * Entrada das paginas: [data-anim] sobe 8px e aparece, [data-grow] e [data-rise] se revelam
 * (barras e colunas de grafico, via clip-path), [data-spin] aparece. Cada elemento anima uma vez.
 */
export function enter(root: HTMLElement | null) {
  if (!root) return;
  const pick = (sel: string) =>
    Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => !seen.has(el) && (seen.add(el), true));
  const a = pick('[data-anim]'), g = pick('[data-grow]'), r = pick('[data-rise]'), s = pick('[data-spin]');
  if (performance.now() < quietUntil) return;
  const opts = (i: number, d = DURATION): KeyframeAnimationOptions => ({
    duration: d,
    delay: Math.min(i, MAX_STAGGER) * STEP,
    easing: EASE_OUT,
    fill: 'backwards',
  });

  if (reducedMotion()) {
    // Movimento reduzido: so o fade, sem deslocamento.
    a.forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease', fill: 'backwards' }));
    return;
  }
  a.forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], opts(i)));
  g.forEach((el, i) => el.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], opts(i)));
  r.forEach((el, i) => el.animate([{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], opts(i)));
  s.forEach((el) => el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], opts(0)));
}

/**
 * Anima com WAAPI (transform/opacity fora da thread principal). Com movimento reduzido, mantem
 * so a opacidade (mais gentil, nao zero); sem opacidade nos quadros, nao anima.
 */
export function play(
  el: Element | null | undefined,
  frames: Keyframe[],
  { duration = 200, easing = EASE_OUT, delay = 0, origin }: { duration?: number; easing?: string; delay?: number; origin?: string } = {},
) {
  if (!el) return;
  if (origin) (el as HTMLElement).style.transformOrigin = origin;
  if (reducedMotion()) {
    if (!frames.some((f) => 'opacity' in f)) return;
    return el.animate(frames.map((f) => ({ opacity: f.opacity })), { duration: Math.min(duration, 200), easing: 'ease', delay, fill: 'backwards' });
  }
  return el.animate(frames, { duration, easing, delay, fill: 'backwards' });
}

/** Roda `enter` apos cada render, pegando elementos novos. */
export function useEnter(ref: RefObject<HTMLElement | null>) {
  useIsoLayoutEffect(() => enter(ref.current));
}

export { animate, stagger };
