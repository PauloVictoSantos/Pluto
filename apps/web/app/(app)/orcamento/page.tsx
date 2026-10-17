'use client';

import { categoryOf } from '@pluto/shared';
import { useRef } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { useShell } from '@/components/shell/ShellContext';
import { CountUp } from '@/components/ui/CountUp';
import { Icon } from '@/components/ui/Icon';
import { ymdIn } from '@/lib/datetime';
import { spendingTip } from '@/lib/insights';
import { useEnter } from '@/lib/motion';
import { monthLower, monthProgress, money, useBudget, useCurrentMonth, useSpending, useTz } from '@/lib/queries';

export default function OrcamentoPage() {
  const { mode, nav, openChat } = useShell();
  const tz = useTz();
  const month = useCurrentMonth();
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const spending = useSpending(month);
  const budget = useBudget(month);
  const { days, elapsed, left } = monthProgress(month, ymdIn(new Date(), tz));

  const spent = spending.data?.totalMinor ?? 0;
  const limits = new Map((budget.data?.items ?? []).map((b) => [b.categoryKey, b.limitMinor]));
  const limitTotal = [...limits.values()].reduce((a, b) => a + b, 0);
  const u = limitTotal ? (spent / limitTotal) * 100 : 0;
  // RN-21: projecao do mes = gasto atual / dias decorridos x dias do mes.
  const projected = elapsed ? Math.round((spent / elapsed) * days) : spent;

  const spentBy = new Map((spending.data?.categories ?? []).map((c) => [c.key, c.spentMinor]));
  const keys = [...new Set([...limits.keys(), ...spentBy.keys()])];
  const rows = keys
    .map((k) => ({ key: k, def: categoryOf(k), spent: spentBy.get(k) ?? 0, limit: limits.get(k) ?? 0 }))
    .sort((a, b) => (b.limit ? b.spent / b.limit : -1) - (a.limit ? a.spent / a.limit : -1) || b.spent - a.spent);
  const noBudget = budget.isSuccess && limitTotal === 0;

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-col gap-1">
        <h1 className="page-title">Orçamento de {monthLower(month)}</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-muted-foreground">{left > 0 ? `Faltam ${left} dia${left > 1 ? 's' : ''} para o mês fechar.` : 'Último dia do mês.'}</p>
          <button onClick={() => nav('plan')} className="btn btn-outline">
            <Icon icon="settings" size={16} />
            {noBudget ? 'Montar orçamento' : 'Ajustar no Planejamento'}
          </button>
        </div>
      </div>

      <div data-anim="" className="flex flex-col gap-3.5 rounded-2xl bg-brand p-[clamp(18px,4vw,24px)] text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[15px] font-medium">{noBudget ? 'Gastos do mês' : 'Limite mensal'}</span>
          {!noBudget && <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-black">{u.toFixed(0)}% usado</span>}
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <CountUp key={spent} value={spent / 100} className="text-[clamp(30px,7vw,40px)] font-bold tracking-[-0.045em] tabular-nums" />
          {!noBudget && <span className="text-[15px] opacity-85">de {money(limitTotal)}</span>}
        </div>
        {!noBudget && (
          <div className="h-3 overflow-hidden rounded-full bg-white/20">
            <div data-grow="" className="h-full origin-left rounded-full bg-accent" style={{ width: `${Math.min(u, 100).toFixed(1)}%` }} />
          </div>
        )}
        <div className="text-sm opacity-90">
          {noBudget ? (
            <>No ritmo atual, o mês fecha em <strong>{money(projected)}</strong>. Defina limites por categoria no Planejamento.</>
          ) : limitTotal >= spent ? (
            <>
              Restam <strong>{money(limitTotal - spent)}</strong>
              {left > 0 && <> · média de {money(Math.floor((limitTotal - spent) / left))} por dia</>}. No ritmo atual o mês fecha em <strong>{money(projected)}</strong>
              {projected > limitTotal ? ', acima do limite.' : '.'}
            </>
          ) : (
            <>
              O limite foi ultrapassado em <strong>{money(spent - limitTotal)}</strong>.
            </>
          )}
        </div>
      </div>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,5fr) minmax(0,7fr)' : 'minmax(0,1fr)' }}>
        <div data-anim="" className="min-w-0">
          <CategoryChart spending={spending.data} loading={spending.isPending} />
        </div>
        <div data-anim="" className="card flex flex-col gap-1">
          <div className="card-title mb-2">{noBudget ? 'Gastos por categoria' : 'Limites por categoria'}</div>
          {spending.isSuccess && rows.length === 0 && <div className="py-4 text-sm text-muted-foreground">Nenhum gasto neste mês ainda.</div>}
          {rows.map((c) => {
            const r = c.limit ? c.spent / c.limit : 0, over = c.limit > 0 && r > 1;
            const proj = c.limit && elapsed ? (c.spent / elapsed) * days : 0;
            return (
              <div key={c.key} className="flex items-center gap-3 border-t border-border py-3">
                <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-muted">
                  <Icon icon={c.def.icon} size={18} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-semibold">{c.def.label}</span>
                    <span className="whitespace-nowrap tabular-nums">
                      <strong>{money(c.spent)}</strong>
                      {c.limit > 0 && <span className="text-muted-foreground"> / {money(c.limit)}</span>}
                    </span>
                  </div>
                  {c.limit > 0 && (
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        data-grow=""
                        className="h-full origin-left rounded-full"
                        style={{ width: `${Math.min(r * 100, 100).toFixed(1)}%`, background: over ? '#EF4444' : r > 0.8 ? '#B18CF7' : '#7D39EB' }}
                      />
                    </div>
                  )}
                  <div className="text-xs" style={{ color: over || proj > c.limit && c.limit > 0 ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>
                    {!c.limit
                      ? 'Sem limite definido'
                      : over
                        ? `Passou ${money(c.spent - c.limit)} do limite`
                        : proj > c.limit
                          ? `No ritmo atual passa do limite (${money(Math.round(proj))})`
                          : `Restam ${money(c.limit - c.spent)} · ${(r * 100).toFixed(0)}% usado`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {spending.data && spending.data.categories.length > 0 && (
        <div data-anim="" className="card flex flex-wrap items-center gap-3.5 p-[18px]">
          <PlutoLogo size={44} />
          <div className="min-w-[200px] flex-1 text-sm leading-normal text-pretty">{spendingTip(spending.data, budget.data)}</div>
          <button onClick={openChat} className="btn btn-accent">
            <Icon icon="sparkles" size={16} />
            Perguntar à Pluto
          </button>
        </div>
      )}
    </div>
  );
}
