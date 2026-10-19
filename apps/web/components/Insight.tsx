'use client';

import { useId, useState, type ReactNode } from 'react';
import { money } from '@/lib/queries';
import { useApp } from '@/lib/store';
import { Icon } from './ui/Icon';

// Componentes da camada analitica (doc. "Design system > Componentes").

/** "78% de chance": cor pela faixa (< 50% perigo, 50-80% atencao, > 80% positivo) e sempre com texto. */
export function ProbabilityBadge({ p, label = 'de chance' }: { p: number; label?: string }) {
  const pct = Math.round(p * 100);
  const tone = pct < 50 ? { bg: 'var(--danger-soft)', fg: 'var(--danger-text)', icon: 'circle-alert' } : pct <= 80 ? { bg: '#FEF3C7', fg: '#92400E', icon: 'clock' } : { bg: 'var(--accent)', fg: '#000', icon: 'circle-check' };
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap" style={{ background: tone.bg, color: tone.fg }}>
      <Icon icon={tone.icon} size={13} />
      {pct}% {label}
    </span>
  );
}

/**
 * Faixa P10-P90 com marca no P50 e, opcional, a linha do limite (zero, por exemplo). Com valores
 * ocultos a escala some e so a forma fica (doc. "Valores ocultos": graficos sem eixo de valor).
 */
export function RangeBar({ p10, p50, p90, limit, limitLabel }: { p10: number; p50: number; p90: number; limit?: number; limitLabel?: string }) {
  const hidden = useApp((s) => s.hideValues);
  const lo = Math.min(p10, limit ?? p10), hi = Math.max(p90, limit ?? p90);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
  const min = lo - pad, span = hi + pad - min;
  const x = (v: number) => `${((v - min) / span) * 100}%`;
  const below = limit !== undefined && p10 < limit;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-6" role="img" aria-label={hidden ? 'Faixa da previsão' : `Faixa provável de ${money(p10)} a ${money(p90)}, mais provável ${money(p50)}`}>
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full" style={{ left: x(p10), width: `calc(${x(p90)} - ${x(p10)})`, minWidth: 6, background: below ? '#FCA5A5' : 'var(--brand-soft)', border: `1px solid ${below ? 'var(--danger-text)' : 'var(--brand)'}` }} />
        <div className="absolute top-0 h-6 w-[3px] -translate-x-1/2 rounded-full bg-foreground" style={{ left: x(p50) }} />
        {limit !== undefined && <div className="absolute -top-0.5 h-7 w-0 -translate-x-1/2 border-l-2 border-dashed border-danger-text" style={{ left: x(limit) }} aria-hidden />}
      </div>
      {!hidden && (
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{money(p10)}</span>
          {limit !== undefined && limitLabel && <span className="text-danger-text">{limitLabel}</span>}
          <span>{money(p90)}</span>
        </div>
      )}
    </div>
  );
}

/** O "por que" de qualquer numero: dados de entrada e regra (RN-G06). Abre no lugar, sem modal. */
export function Why({ children, label = 'Por quê?' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex min-h-9 cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text"
      >
        <Icon icon="info" size={14} />
        {label}
        <Icon icon={open ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      {open && (
        <div id={id} className="rounded-xl bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
