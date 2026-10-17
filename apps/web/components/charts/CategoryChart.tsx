'use client';

import { useRef, useState } from 'react';
import { fmt } from '@/lib/format';
import { MOCK } from '@/lib/mock/data';
import { vm } from '@/lib/mock/vm';
import { useEnter } from '@/lib/motion';
import { PlutoLogo } from '../brand/PlutoLogo';
import { Icon } from '../ui/Icon';

const C = 2 * Math.PI * 76;

/** Rosca de gastos por categoria com legenda interativa. */
export function CategoryChart({ showTip = true }: { showTip?: boolean }) {
  const [hover, setHover] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const cats = vm.categories();
  const lens = cats.map((c) => (c.pct / 100) * C);
  const segs = cats.map((c, i) => {
    const start = lens.slice(0, i).reduce((a, b) => a + b, 0);
    return { ...c, dash: `${Math.max(lens[i]! - 3, 0.5).toFixed(2)} ${C.toFixed(2)}`, off: (-start).toFixed(2), i };
  });
  const total = cats[0]!.total, cur = hover >= 0 ? cats[hover] : null;
  const center = cur
    ? { label: cur.name, value: fmt(cur.spent), sub: cur.pct.toFixed(1).replace('.', ',') + '% do total' }
    : { label: 'Total gasto', value: fmt(total), sub: '6 categorias' };

  return (
    <div ref={root} className="card box-border flex h-full flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="card-title">Gastos por categoria</div>
          <div className="text-sm text-muted-foreground">Outubro 2026</div>
        </div>
        <Icon icon="pie-chart" size={18} />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-5">
        <div className="relative size-[190px] shrink-0">
          <svg data-spin="" viewBox="0 0 200 200" className="block size-full">
            <g transform="rotate(-90 100 100)">
              {segs.map((s) => (
                <circle
                  key={s.id}
                  cx="100"
                  cy="100"
                  r="76"
                  fill="none"
                  onMouseEnter={() => setHover(s.i)}
                  onMouseLeave={() => setHover(-1)}
                  onClick={() => setHover(s.i)}
                  style={{
                    stroke: s.color,
                    strokeWidth: hover === s.i ? 32 : 24,
                    strokeDasharray: s.dash,
                    strokeDashoffset: s.off,
                    opacity: hover === -1 || hover === s.i ? 1 : 0.35,
                    cursor: 'pointer',
                    transition: 'stroke-width .2s, opacity .2s',
                  }}
                />
              ))}
            </g>
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-muted-foreground">{center.label}</span>
            <span className="text-xl font-bold tracking-[-0.03em] tabular-nums">{center.value}</span>
            <span className="text-xs text-muted-foreground">{center.sub}</span>
          </div>
        </div>
        <div className="flex min-w-[210px] flex-1 flex-col">
          {segs.map((s) => (
            <button
              key={s.id}
              onMouseEnter={() => setHover(s.i)}
              onMouseLeave={() => setHover(-1)}
              onClick={() => setHover(s.i)}
              className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] border-0 px-2 text-left text-sm text-foreground"
              style={{ background: hover === s.i ? 'var(--muted)' : 'transparent' }}
            >
              <span className="size-2.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{s.pct.toFixed(0)}%</span>
              <span className="min-w-[86px] text-right font-semibold tabular-nums">{fmt(s.spent)}</span>
            </button>
          ))}
        </div>
      </div>
      {showTip && <PlutoTip text={MOCK.insights.categoryTip} />}
    </div>
  );
}

/** Dica da Pluto: bloco cinza com o logo. */
export function PlutoTip({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[14px] bg-muted p-3">
      <PlutoLogo size={28} />
      <span className="text-[13px] leading-[1.45] text-pretty">{text}</span>
    </div>
  );
}
