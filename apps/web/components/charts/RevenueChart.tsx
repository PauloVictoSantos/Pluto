'use client';

import { useRef, useState } from 'react';
import { useEnter } from '@/lib/motion';
import { change, monthLong, monthLower, monthShort, money } from '@/lib/queries';
import { Icon } from '../ui/Icon';
import { hidePct } from '@/lib/format';

const H = 220;

/** Arredonda para cima numa escala "bonita" (1, 2, 2,5, 5 x 10^n). */
function niceCeil(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

export interface MonthPoint {
  month: string;
  incomeMinor: number;
  expensesMinor: number;
}

/** Barras empilhadas de receitas x despesas (RN-13/14: transferencias e faturas nao entram). */
export function RevenueChart({ data, loading = false }: { data: MonthPoint[]; loading?: boolean }) {
  const [hover, setHover] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const n = data.length;
  const max = niceCeil(Math.max(0, ...data.map((m) => m.incomeMinor + m.expensesMinor)));
  const cur = data[n - 1], prev = data[n - 2];
  const ch = cur && prev ? change(cur.incomeMinor, prev.incomeMinor) : null;
  const period = n ? `${monthShort(data[0]!.month)} – ${monthLong(data[n - 1]!.month)}` : '';
  const empty = !loading && data.every((m) => !m.incomeMinor && !m.expensesMinor);

  return (
    <div ref={root} className="card box-border flex h-full flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="card-title">Receitas x Despesas</div>
        <div className="text-sm text-muted-foreground">{loading ? 'Carregando…' : period}</div>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="relative" style={{ height: H }}>
          {[0, 25, 50, 75, 100].map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-border" style={{ top: `${t}%` }} />
          ))}
          {empty && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Sem movimentações no período</div>}
          <div className="absolute inset-0 flex">
            {data.map((m, i) => (
              <div
                key={m.month}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(-1)}
                onClick={() => setHover(i)}
                className="relative flex h-full flex-1 cursor-pointer items-end justify-center"
              >
                <div data-rise="" className="flex w-[62%] max-w-14 origin-bottom flex-col" style={{ opacity: hover === -1 || hover === i ? 1 : 0.5 }}>
                  <div style={{ height: (m.expensesMinor / max) * H, background: 'var(--chart-2)', borderRadius: '4px 4px 0 0' }} />
                  <div style={{ height: (m.incomeMinor / max) * H, background: 'var(--chart-1)', borderRadius: '0 0 4px 4px' }} />
                </div>
                {hover === i && (
                  <div
                    className="pointer-events-none absolute left-1/2 z-[5] grid min-w-32 gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs shadow-[0_12px_28px_rgba(0,0,0,.14)]"
                    style={{ bottom: Math.min(((m.incomeMinor + m.expensesMinor) / max) * H + 10, H - 40), transform: `translateX(${i === 0 ? '-25%' : i === n - 1 ? '-75%' : '-50%'})` }}
                  >
                    <div className="font-semibold">{monthLong(m.month)}</div>
                    <TipRow color="var(--chart-1)" label="Receitas" value={money(m.incomeMinor)} />
                    <TipRow color="var(--chart-2)" label="Despesas" value={money(m.expensesMinor)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex">
          {data.map((m) => (
            <span key={m.month} className="flex-1 text-center text-xs text-muted-foreground">
              {monthShort(m.month)}
            </span>
          ))}
        </div>
        <div className="flex justify-center gap-4 pt-2 text-xs">
          <Legend color="var(--chart-1)" label="Receitas" />
          <Legend color="var(--chart-2)" label="Despesas" />
        </div>
      </div>
      {cur && ch !== null && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2 leading-none font-medium">
            Receitas {ch >= 0 ? 'subiram' : 'caíram'} {hidePct(`${Math.abs(ch).toFixed(1).replace('.', ',')}%`)} em {monthLower(cur.month)}
            <Icon icon={ch >= 0 ? 'trending-up' : 'trending-down'} size={16} />
          </div>
          <div className="leading-[1.3] text-muted-foreground">Transferências entre suas contas e pagamentos de fatura não entram na conta.</div>
        </div>
      )}
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
