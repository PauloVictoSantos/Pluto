'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { fmt } from '@/lib/format';
import { EASE, animate, reducedMotion } from '@/lib/motion';

/**
 * Numero que conta de 0 ate `value` na primeira exibicao. `text` substitui o valor
 * (ex.: "R$ ••••" quando valores estao ocultos). O texto e escrito direto no DOM.
 */
export function CountUp({ value, text, className }: { value: number; text?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = text ?? fmt(value);
  }, [value, text]);

  useEffect(() => {
    const el = ref.current;
    if (!el || text !== undefined || reducedMotion()) return;
    const c = animate(0, value, { duration: 1.1, ease: EASE, onUpdate: (v) => (el.textContent = fmt(v)) });
    return () => {
      c.stop();
      el.textContent = fmt(value);
    };
    // Anima so na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span ref={ref} className={className} />;
}
