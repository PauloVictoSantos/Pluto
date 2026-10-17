'use client';

import { useRef } from 'react';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { RevenueChart } from '@/components/charts/RevenueChart';
import { useShell } from '@/components/shell/ShellContext';
import { Icon } from '@/components/ui/Icon';
import { MESES_LONGOS, downloadCsv, fmt } from '@/lib/format';
import { MOCK } from '@/lib/mock/data';
import { useEnter } from '@/lib/motion';

export default function RelatoriosPage() {
  const { mode } = useShell();
  const isMobile = mode === 'mobile';
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const m = MOCK.insights.monthly;
  const rowCols = isMobile ? '52px repeat(3,minmax(0,1fr))' : '1.2fr repeat(3,minmax(0,1fr))';
  const short = (v: number) => (isMobile ? fmt(v).replace(/,\d\d$/, '') : fmt(v));
  const rows = m
    .slice()
    .reverse()
    .map((x) => {
      const mi = +x.month.slice(5) - 1, rate = ((x.income - x.expenses) / x.income) * 100;
      return {
        key: x.month,
        month: isMobile ? MESES_LONGOS[mi]!.slice(0, 3) : MESES_LONGOS[mi],
        income: short(x.income),
        expenses: short(x.expenses),
        rate: rate.toFixed(0) + '%',
        good: rate >= 30,
      };
    });

  const exportCsv = () =>
    downloadCsv('relatorio-mai-out-2026.csv', [
      ['Mês', 'Receitas', 'Despesas', 'Saldo'],
      ...m.map((x) => [x.month, x.income.toFixed(2).replace('.', ','), x.expenses.toFixed(2).replace('.', ','), (x.income - x.expenses).toFixed(2).replace('.', ',')]),
    ]);

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">Maio a outubro de 2026</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="btn btn-outline px-4">
            <Icon icon="download" size={16} />
            CSV
          </button>
          <button onClick={() => window.print()} className="btn btn-primary px-4">
            <Icon icon="file-text" size={16} />
            PDF
          </button>
        </div>
      </div>

      <div className="grid items-stretch gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,7fr) minmax(0,5fr)' : 'minmax(0,1fr)' }}>
        <div data-anim="" className="min-w-0">
          <RevenueChart />
        </div>
        <div data-anim="" className="min-w-0">
          <CategoryChart />
        </div>
      </div>

      <div data-anim="" className="card flex flex-col gap-1.5">
        <div className="card-title mb-2">Resumo mensal</div>
        <div className="grid gap-2 py-2 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: rowCols }}>
          <span>Mês</span>
          <span className="text-right">Receitas</span>
          <span className="text-right">Despesas</span>
          <span className="text-right">Poupado</span>
        </div>
        {rows.map((r) => (
          <div key={r.key} className="grid min-h-[52px] items-center gap-2 border-t border-border text-sm tabular-nums" style={{ gridTemplateColumns: rowCols }}>
            <span className="font-semibold">{r.month}</span>
            <span className="text-right">{r.income}</span>
            <span className="text-right">{r.expenses}</span>
            <span className="flex justify-end">
              <span
                className="rounded-full px-[9px] py-[3px] text-xs font-semibold"
                style={{ background: r.good ? '#C6FF33' : 'var(--muted)', color: r.good ? '#000' : 'var(--foreground)' }}
              >
                {r.rate}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
