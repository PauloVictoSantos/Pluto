'use client';

import { useEffect, useRef, useState } from 'react';
import { PlutoTip } from '@/components/charts/CategoryChart';
import { useShell } from '@/components/shell/ShellContext';
import { CountUp } from '@/components/ui/CountUp';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { fmt } from '@/lib/format';
import { MOCK } from '@/lib/mock/data';
import { vm } from '@/lib/mock/vm';
import { EASE, animate, reducedMotion, useEnter } from '@/lib/motion';

type Range = '1M' | '6M' | '1A';
const RANGES: { id: Range; label: string }[] = [
  { id: '1M', label: '1M' },
  { id: '6M', label: '6M' },
  { id: '1A', label: '1A' },
];

export default function InvestimentosPage() {
  const { mode } = useShell();
  const [range, setRange] = useState<Range>('1M');
  const root = useRef<HTMLDivElement>(null);
  const chartRef = useRef<SVGSVGElement>(null);
  const firstRange = useRef(true);
  useEnter(root);

  useEffect(() => {
    if (firstRange.current) {
      firstRange.current = false;
      return;
    }
    if (chartRef.current && !reducedMotion()) animate(chartRef.current, { opacity: [0, 1], scaleY: [0.85, 1] }, { duration: 0.4, ease: EASE });
  }, [range]);

  const inv = vm.invest();
  const alloc = MOCK.allocation.map((a) => ({ ...a, value: a.id === 'acoes' ? inv.total : a.value }));
  const total = alloc.reduce((t, a) => t + a.value, 0);
  const chart = vm.path(vm.series(range), 600, 180);

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-col gap-1">
        <h1 className="page-title">Investimentos</h1>
        <p className="m-0 text-sm text-muted-foreground">Cotações B3 via brapi.dev · atraso de 15 min</p>
      </div>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,7fr) minmax(0,5fr)' : 'minmax(0,1fr)' }}>
        <div className="flex min-w-0 flex-col gap-4">
          <div data-anim="" className="card flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-medium text-muted-foreground">Patrimônio investido</div>
                <CountUp value={total} className="mt-1.5 block text-[clamp(30px,7vw,40px)] font-bold tracking-[-0.045em] tabular-nums" />
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-[3px] rounded-full bg-accent px-[9px] py-1 text-xs font-semibold text-black">
                    <Icon icon="arrow-up-right" size={13} />
                    {inv.dayChange}
                  </span>
                  <span className="text-[13px] text-muted-foreground">{inv.dayValue} hoje em ações</span>
                </div>
              </div>
              <Segmented items={RANGES} value={range} onChange={setRange} />
            </div>
            <svg ref={chartRef} viewBox="0 0 600 180" preserveAspectRatio="none" className="block h-[180px] w-full" aria-label={`Evolução da carteira, período ${range}`} role="img">
              <defs>
                <linearGradient id="invG2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#7D39EB" stopOpacity="0.25" />
                  <stop offset="1" stopColor="#7D39EB" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={chart.area} fill="url(#invG2)" />
              <path d={chart.line} fill="none" stroke="#7D39EB" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          <div data-anim="" className="card flex flex-col gap-1.5">
            <div className="card-title mb-1.5">Ações</div>
            {vm.assets().map((s) => (
              <div key={s.symbol} className="flex min-h-16 items-center gap-3 border-t border-border">
                <span className="grid size-[42px] shrink-0 place-items-center rounded-xl bg-muted text-[11px] font-bold">{s.short}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">
                    {s.symbol} <span className="text-[13px] font-normal text-muted-foreground">· {s.price}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.qty} · {s.name}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[15px] font-semibold tabular-nums">{s.position}</span>
                  <span className="badge" style={{ background: s.badgeBg, color: s.badgeFg }}>
                    {s.change}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div data-anim="" className="card flex flex-col gap-4">
          <div className="card-title">Alocação</div>
          <div className="flex h-3.5 gap-[3px] overflow-hidden rounded-full">
            {alloc.map((a) => (
              <div key={a.id} data-grow="" className="origin-left" style={{ width: `${((a.value / total) * 100).toFixed(1)}%`, background: a.color }} />
            ))}
          </div>
          <div className="flex flex-col">
            {alloc.map((a) => (
              <div key={a.id} className="flex min-h-12 items-center gap-2.5 border-t border-border text-sm">
                <span className="size-2.5 rounded-[3px]" style={{ background: a.color }} />
                <span className="flex-1">{a.name}</span>
                <span className="text-[13px] text-muted-foreground">{((a.value / total) * 100).toFixed(0)}%</span>
                <strong className="min-w-[110px] text-right tabular-nums">{fmt(a.value)}</strong>
              </div>
            ))}
          </div>
          <PlutoTip text="Metade do seu patrimônio está em ações. Se quiser menos oscilação, aumentar a renda fixa equilibra a carteira." />
        </div>
      </div>
    </div>
  );
}
