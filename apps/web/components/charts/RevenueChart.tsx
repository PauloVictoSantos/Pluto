'use client';

import { useRef, useState } from 'react';
import { fmt } from '@/lib/format';
import { vm } from '@/lib/mock/vm';
import { useEnter } from '@/lib/motion';
import { Icon } from '../ui/Icon';

const MAX = 25000, H = 220;

/** Barras empilhadas de receitas x despesas dos ultimos 6 meses. */
export function RevenueChart() {
  const [hover, setHover] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const ms = vm.months(), n = ms.length;
  const cur = ms[n - 1]!, prev = ms[n - 2]!, ch = ((cur.income - prev.income) / prev.income) * 100;

  return (
    <div ref={root} className="card box-border flex h-full flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="card-title">Receitas x Despesas</div>
        <div className="text-sm text-muted-foreground">Maio – Outubro 2026</div>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="relative" style={{ height: H }}>
          {[0, 25, 50, 75, 100].map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-border" style={{ top: `${t}%` }} />
          ))}
          <div className="absolute inset-0 flex">
            {ms.map((m, i) => (
              <div
                key={m.label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(-1)}
                onClick={() => setHover(i)}
                className="relative flex h-full flex-1 cursor-pointer items-end justify-center"
              >
                <div data-rise="" className="flex w-[62%] max-w-14 origin-bottom flex-col" style={{ opacity: hover === -1 || hover === i ? 1 : 0.5 }}>
                  <div style={{ height: (m.expenses / MAX) * H, background: 'var(--chart-2)', borderRadius: '4px 4px 0 0' }} />
                  <div style={{ height: (m.income / MAX) * H, background: 'var(--chart-1)', borderRadius: '0 0 4px 4px' }} />
                </div>
                {hover === i && (
                  <div
                    className="pointer-events-none absolute left-1/2 z-[5] grid min-w-32 gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs shadow-[0_12px_28px_rgba(0,0,0,.14)]"
                    style={{ bottom: ((m.income + m.expenses) / MAX) * H + 10, transform: `translateX(${i === 0 ? '-25%' : i === n - 1 ? '-75%' : '-50%'})` }}
                  >
                    <TipRow color="var(--chart-1)" label="Receitas" value={fmt(m.income)} />
                    <TipRow color="var(--chart-2)" label="Despesas" value={fmt(m.expenses)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex">
          {ms.map((m) => (
            <span key={m.label} className="flex-1 text-center text-xs text-muted-foreground">
              {m.label}
            </span>
          ))}
        </div>
        <div className="flex justify-center gap-4 pt-2 text-xs">
          <Legend color="var(--chart-1)" label="Receitas" />
          <Legend color="var(--chart-2)" label="Despesas" />
        </div>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 leading-none font-medium">
          Receitas subiram {ch.toFixed(1).replace('.', ',')}% em outubro
          <Icon icon="trending-up" size={16} />
        </div>
        <div className="leading-[1.3] text-muted-foreground">Total de receitas e despesas dos últimos 6 meses</div>
      </div>
    </div>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 rounded-[2px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-[2px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.1)]" style={{ background: color }} />
      {label}
    </span>
  );
}
