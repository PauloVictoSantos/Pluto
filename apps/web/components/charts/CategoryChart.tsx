'use client';

import { categoryOf, type Spending } from '@pluto/shared';
import { useRef, useState } from 'react';
import { useEnter } from '@/lib/motion';
import { monthLong, money } from '@/lib/queries';
import { PlutoLogo } from '../brand/PlutoLogo';
import { Icon } from '../ui/Icon';

const C = 2 * Math.PI * 76;
const TOP = 5;

/** Cor da categoria; preto vira a cor do texto para aparecer no tema escuro. */
export const categoryColor = (hex: string) => (hex === '#000000' ? 'var(--foreground)' : hex);

/** Rosca de gastos por categoria do mes (5 maiores + Outros). */
export function CategoryChart({ spending, loading = false, tip }: { spending?: Spending; loading?: boolean; tip?: string | null }) {
  const [hover, setHover] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const all = spending?.categories ?? [];
  const total = spending?.totalMinor ?? 0;
  const top = all.slice(0, TOP).map((c) => ({ ...categoryOf(c.key), spentMinor: c.spentMinor }));
  const restSum = all.slice(TOP).reduce((s, c) => s + c.spentMinor, 0);
  const cats = restSum > 0 ? [...top, { key: 'resto', label: 'Outras categorias', icon: 'receipt', color: '#A1A1AA', group: 'lifestyle' as const, spentMinor: restSum }] : top;
  const items = cats.map((c) => ({ ...c, color: categoryColor(c.color), pct: total ? (c.spentMinor / total) * 100 : 0 }));

  const lens = items.map((c) => (c.pct / 100) * C);
  const segs = items.map((c, i) => ({
    ...c,
    i,
    dash: `${Math.max(lens[i]! - 3, 0.5).toFixed(2)} ${C.toFixed(2)}`,
    off: (-lens.slice(0, i).reduce((a, b) => a + b, 0)).toFixed(2),
  }));
  const cur = hover >= 0 ? items[hover] : null;
  const center = cur
    ? { label: cur.label, value: money(cur.spentMinor), sub: cur.pct.toFixed(1).replace('.', ',') + '% do total' }
    : { label: 'Total gasto', value: money(total), sub: `${all.length} categoria${all.length === 1 ? '' : 's'}` };

  return (
    <div ref={root} className="card box-border flex h-full flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="card-title">Gastos por categoria</div>
          <div className="text-sm text-muted-foreground">{spending ? monthLong(spending.month) : loading ? 'Carregando…' : ''}</div>
        </div>
        <Icon icon="pie-chart" size={18} />
      </div>
      {!loading && items.length === 0 ? (
        <div className="grid min-h-40 place-items-center text-center text-sm text-muted-foreground">Nenhum gasto neste mês ainda.</div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-5">
          <div className="relative size-[190px] shrink-0">
            <svg data-spin="" viewBox="0 0 200 200" className="block size-full" role="img" aria-label="Gastos por categoria">
              <circle cx="100" cy="100" r="76" fill="none" stroke="var(--muted)" strokeWidth={24} />
              <g transform="rotate(-90 100 100)">
                {segs.map((s) => (
                  <circle
                    key={s.key}
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
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <span className="text-xs text-muted-foreground">{center.label}</span>
              <span className="text-xl font-bold tracking-[-0.03em] tabular-nums">{center.value}</span>
              <span className="text-xs text-muted-foreground">{center.sub}</span>
            </div>
          </div>
          <div className="flex min-w-[210px] flex-1 flex-col">
            {segs.map((s) => (
              <button
                key={s.key}
                onMouseEnter={() => setHover(s.i)}
                onMouseLeave={() => setHover(-1)}
                onClick={() => setHover(s.i)}
                className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] border-0 px-2 text-left text-sm text-foreground"
                style={{ background: hover === s.i ? 'var(--muted)' : 'transparent' }}
              >
                <span className="size-2.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{s.pct.toFixed(0)}%</span>
                <span className="min-w-[86px] text-right font-semibold tabular-nums">{money(s.spentMinor)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {tip && <PlutoTip text={tip} />}
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
