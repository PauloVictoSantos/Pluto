'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { RevenueChart } from '@/components/charts/RevenueChart';
import { CategorizerNote, CategoryBarsCard, HabitsCard, HeatmapCard } from '@/components/PatternsCards';
import { useShell } from '@/components/shell/ShellContext';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { MESES_LONGOS, downloadCsv, hidePct } from '@/lib/format';
import { useEnter } from '@/lib/motion';
import { monthLong, money, useSpending, useSummary } from '@/lib/queries';

const brl = (minor: number) => (minor / 100).toFixed(2).replace('.', ',');

export default function RelatoriosPage() {
  const { mode } = useShell();
  const isMobile = mode === 'mobile';
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const summary = useSummary();
  const spending = useSpending();
  const patterns = useQuery({ queryKey: ['analytics', 'patterns'], queryFn: api.patterns, staleTime: 5 * 60_000 });
  const pt = patterns.data;
  const desk = mode === 'desktop';
  const m = summary.data?.monthly ?? [];
  const rowCols = isMobile ? '52px repeat(3,minmax(0,1fr))' : '1.2fr repeat(4,minmax(0,1fr))';
  const short = (v: number) => (isMobile ? money(v).replace(/,\d\d$/, '') : money(v));
  const rows = m
    .slice()
    .reverse()
    .map((x) => {
      const mi = +x.month.slice(5) - 1, saved = x.incomeMinor - x.expensesMinor;
      const rate = x.incomeMinor ? (saved / x.incomeMinor) * 100 : null;
      return { ...x, label: isMobile ? MESES_LONGOS[mi]!.slice(0, 3) : `${MESES_LONGOS[mi]} ${x.month.slice(0, 4)}`, saved, rate };
    });

  const exportCsv = () =>
    downloadCsv(`relatorio-${m[0]?.month ?? ''}-${m[m.length - 1]?.month ?? ''}.csv`, [
      ['Mês', 'Receitas', 'Despesas', 'Investido', 'Saldo'],
      ...m.map((x) => [x.month, brl(x.incomeMinor), brl(x.expensesMinor), brl(x.investedMinor), brl(x.incomeMinor - x.expensesMinor)]),
    ]);

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">{m.length ? `${monthLong(m[0]!.month)} a ${monthLong(m[m.length - 1]!.month)}` : 'Carregando…'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={!m.length} className="btn btn-outline px-4">
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
          <RevenueChart data={m} loading={summary.isPending} />
        </div>
        <div data-anim="" className="min-w-0">
          <CategoryChart spending={spending.data} loading={spending.isPending} />
        </div>
      </div>

      {/* Camada analitica: mapa dia x horario e categorias em barras, abaixo de Receitas x Despesas. */}
      {patterns.isPending && <div className="card h-48 animate-pulse" aria-busy="true" />}
      {pt && (
        <>
          <div className="grid items-start gap-4" style={{ gridTemplateColumns: desk ? 'minmax(0,7fr) minmax(0,5fr)' : 'minmax(0,1fr)' }}>
            <HeatmapCard p={pt} />
            <CategoryBarsCard p={pt} />
          </div>
          <HabitsCard p={pt} />
          <CategorizerNote p={pt} />
        </>
      )}

      <div data-anim="" className="card flex flex-col gap-1.5">
        <div className="card-title mb-2">Resumo mensal</div>
        <div className="grid gap-2 py-2 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: rowCols }}>
          <span>Mês</span>
          <span className="text-right">Receitas</span>
          <span className="text-right">Despesas</span>
          {!isMobile && <span className="text-right">Investido</span>}
          <span className="text-right">Poupado</span>
        </div>
        {rows.map((r) => {
          const good = r.rate !== null && r.rate >= 30;
          return (
            <div key={r.month} className="grid min-h-[52px] items-center gap-2 border-t border-border text-sm tabular-nums" style={{ gridTemplateColumns: rowCols }}>
              <span className="font-semibold">{r.label}</span>
              <span className="text-right">{short(r.incomeMinor)}</span>
              <span className="text-right">{short(r.expensesMinor)}</span>
              {!isMobile && <span className="text-right">{short(r.investedMinor)}</span>}
              <span className="flex justify-end">
                <span
                  className="rounded-full px-[9px] py-[3px] text-xs font-semibold"
                  style={{
                    background: r.saved < 0 ? 'var(--danger-soft)' : good ? '#C6FF33' : 'var(--muted)',
                    color: r.saved < 0 ? 'var(--danger-text)' : good ? '#000' : 'var(--foreground)',
                  }}
                  title={money(r.saved)}
                >
                  {r.rate === null ? '—' : hidePct(`${r.rate.toFixed(0)}%`)}
                </span>
              </span>
            </div>
          );
        })}
        <p className="mt-2 mb-0 text-xs text-muted-foreground">
          Poupado = (receitas − despesas) ÷ receitas. Transferências entre suas contas, pagamentos de fatura e aplicações não contam como despesa.
        </p>
      </div>
    </div>
  );
}
