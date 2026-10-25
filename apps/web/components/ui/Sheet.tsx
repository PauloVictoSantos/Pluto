'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, type FormEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EASE_DRAWER, EASE_OUT, reducedMotion } from '@/lib/motion';
import { useMode } from '@/lib/viewport';
import { Icon } from './Icon';

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
  /** Botao X no canto (doc. Melhorias, passo 8). */
  closeButton?: boolean;
}

// Celular: gaveta que sobe da borda (curva de gaveta do iOS). Desktop: modal centralizado
// que aparece de scale(0.96). A saida faz o caminho inverso.
const DRAWER_MS = 500;
const MODAL_MS = 250;

const CloseContext = createContext<() => void>(() => {});
/** Fecha a Sheet com a animacao de saida (use nos botoes "Fechar"/"Cancelar" de dentro dela). */
export const useSheetClose = () => useContext(CloseContext);

/**
 * Dialogo do design: bottom sheet no celular, cartao centralizado no desktop.
 * Renderizado em portal para nao herdar transformacoes das animacoes de entrada.
 */
export function Sheet({ onClose, children, label, width = 420, top = '20vh', gap = 16, onSubmit, role = 'dialog', closeButton = false }: Props) {
  const isMobile = useMode() === 'mobile';
  const ref = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const frames = useCallback(() => {
    const reduce = reducedMotion();
    // Movimento reduzido: so o fade, sem deslocamento.
    const panel: Keyframe[] = reduce
      ? [{ opacity: 0 }, { opacity: 1 }]
      : isMobile
        ? [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }]
        : [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }];
    const duration = reduce ? 200 : isMobile ? DRAWER_MS : MODAL_MS;
    return { panel, duration, easing: reduce ? 'ease' : isMobile ? EASE_DRAWER : EASE_OUT };
  }, [isMobile]);

  // Botao voltar (Android/navegador) fecha a Sheet: ela ocupa uma entrada no historico.
  const historyId = useRef(`sheet-${useId()}`);
  const popped = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (!popped.current && window.history.state?.sheet === historyId.current) window.history.back();
    const { panel, duration, easing } = frames();
    const opts = { duration, easing, fill: 'forwards' as const, direction: 'reverse' as const };
    const anim = ref.current?.animate(panel, opts);
    backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], opts);
    if (anim) anim.onfinish = onClose;
    else onClose();
  }, [frames, onClose]);

  useEffect(() => {
    const { panel, duration, easing } = frames();
    ref.current?.animate(panel, { duration, easing, fill: 'backwards' });
    backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing, fill: 'backwards' });
    // Entrada so na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Uma unica entrada no historico por Sheet aberta (o close mais recente fica num ref).
  const closeRef = useRef(close);
  useEffect(() => void (closeRef.current = close), [close]);
  useEffect(() => {
    const id = historyId.current;
    window.history.pushState({ ...window.history.state, sheet: id }, '');
    const onPop = () => {
      if (window.history.state?.sheet === id) return;
      popped.current = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Celular: arrastar para baixo (a partir do topo da gaveta) fecha.
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!isMobile) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, dy: 0 };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    ref.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !ref.current) return;
    if (d.dy > 110) close();
    else {
      ref.current.animate([{ transform: `translateY(${d.dy}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
      ref.current.style.transform = '';
    }
  };
  const extras = (
    <>
      {isMobile && (
        // Alca de arraste: touch-action none para o navegador nao transformar o gesto em rolagem.
        <div
          aria-hidden
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="sticky -top-6 z-2 -mx-5 -mt-6 -mb-3 flex h-9 shrink-0 cursor-grab touch-none items-center justify-center bg-card"
        >
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </div>
      )}
      {closeButton && (
        <button type="button" onClick={close} aria-label="Fechar" className="icon-btn absolute top-3 right-3 z-2 size-10 bg-card">
          <Icon icon="x" size={18} />
        </button>
      )}
    </>
  );

  const style = {
    position: 'fixed' as const,
    zIndex: 61,
    gap,
    maxWidth: '100%',
    // Formulario longo rola por dentro (o rodape com "sticky bottom-0" fica sempre visivel).
    maxHeight: isMobile ? '92dvh' : `calc(100dvh - ${top} - 24px)`,
    overflowY: 'auto' as const,
    overscrollBehavior: 'contain' as const,
    ...(isMobile
      ? { left: 0, right: 0, bottom: 0, borderRadius: '24px 24px 0 0' }
      : { left: `calc(50% - ${width / 2}px)`, top, width, borderRadius: 20 }),
  };
  const cls =
    'm-0 box-border flex flex-col border border-border bg-card px-5 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))] text-foreground';

  return createPortal(
    <CloseContext.Provider value={close}>
      <div ref={backdrop} onClick={close} className="fixed inset-0 z-60 bg-overlay" />
      {onSubmit ? (
        <form ref={(el) => void (ref.current = el)} role={role} aria-label={label} aria-modal="true" onSubmit={onSubmit} className={cls} style={style}>
          {extras}
          {children}
        </form>
      ) : (
        <div ref={(el) => void (ref.current = el)} role={role} aria-label={label} aria-modal="true" className={cls} style={style}>
          {extras}
          {children}
        </div>
      )}
    </CloseContext.Provider>,
    document.body,
  );
}

/** Fecha a Sheet (com a saida animada) quando `when` vira true, ex.: depois de salvar. */
export function CloseWhen({ when }: { when: boolean }) {
  const close = useSheetClose();
  useEffect(() => {
    if (when) close();
  }, [when, close]);
  return null;
}

/** Botao "X" que fecha com a animacao de saida. */
export function SheetCloseButton({ className = 'icon-btn size-10', children }: { className?: string; children: ReactNode }) {
  const close = useSheetClose();
  return (
    <button type="button" onClick={close} aria-label="Fechar" className={className}>
      {children}
    </button>
  );
}
