'use client';

import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pop } from '@/lib/motion';
import { useMode } from '@/lib/viewport';

interface Props {
  onClose: () => void;
  children: ReactNode;
  label?: string;
  /** Largura no desktop/tablet. */
  width?: number;
  /** Distancia do topo no desktop/tablet. */
  top?: string;
  gap?: number;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  role?: 'dialog' | 'alertdialog';
}

/**
 * Dialogo do design: bottom sheet no celular, cartao centralizado no desktop.
 * Renderizado em portal para nao herdar transformacoes das animacoes de entrada.
 */
export function Sheet({ onClose, children, label, width = 420, top = '20vh', gap = 16, onSubmit, role = 'dialog' }: Props) {
  const isMobile = useMode() === 'mobile';
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    pop(ref.current, isMobile ? { y: ['100%', '0%'] } : undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = {
    position: 'fixed' as const,
    zIndex: 61,
    gap,
    maxWidth: '100%',
    ...(isMobile
      ? { left: 0, right: 0, bottom: 0, borderRadius: '24px 24px 0 0' }
      : { left: `calc(50% - ${width / 2}px)`, top, width, borderRadius: 20 }),
  };
  const cls =
    'm-0 box-border flex flex-col border border-border bg-card px-5 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))] text-foreground';

  return createPortal(
    <>
      <div onClick={onClose} className="fixed inset-0 z-60 bg-overlay" />
      {onSubmit ? (
        <form ref={(el) => void (ref.current = el)} role={role} aria-label={label} aria-modal="true" onSubmit={onSubmit} className={cls} style={style}>
          {children}
        </form>
      ) : (
        <div ref={(el) => void (ref.current = el)} role={role} aria-label={label} aria-modal="true" className={cls} style={style}>
          {children}
        </div>
      )}
    </>,
    document.body,
  );
}
