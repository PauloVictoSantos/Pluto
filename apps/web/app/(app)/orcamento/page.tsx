'use client';

import { useRef } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { CategoryChart } from '@/components/charts/CategoryChart';
import { useShell } from '@/components/shell/ShellContext';
import { CountUp } from '@/components/ui/CountUp';
import { Icon } from '@/components/ui/Icon';
import { fmt } from '@/lib/format';
import { MOCK } from '@/lib/mock/data';
import { useEnter } from '@/lib/motion';
import { useApp } from '@/lib/store';

export default function OrcamentoPage() {
  const { mode, nav, openChat } = useShell();
  useApp((s) => s.plan); // re-renderiza quando o plano aplicado muda os limites
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const cats = MOCK.insights.categories;
  const spent = cats.reduce((t, c) => t + c.spent, 0), lim = MOCK.insights.spendingLimit, u = (spent / lim) * 100;
  const sorted = [...cats].sort((a, b) => b.spent / b.budget - a.spent / a.budget);

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-col gap-1">
        <h1 className="page-title">Orçamento de outubro</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-muted-foreground">Faltam 15 dias para o mês fechar.</p>
          <button onClick={() => nav('plan')} className="btn btn-outline">
            <Icon icon="settings" size={16} />
            Configurar no Planejamento
          </button>
        </div>
      </div>

      <div data-anim="" className="flex flex-col gap-3.5 rounded-2xl bg-brand p-[clamp(18px,4vw,24px)] text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[15px] font-medium">Limite mensal</span>
          <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-black">{u.toFixed(0)}% usado</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <CountUp value={spent} className="text-[clamp(30px,7vw,40px)] font-bold tracking-[-0.045em] tabular-nums" />
          <span className="text-[15px] opacity-85">de {fmt(lim)}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-white/20">
          <div data-grow="" className="h-full origin-left rounded-full bg-accent" style={{ width: `${Math.min(u, 100).toFixed(1)}%` }} />
        </div>
        <div className="text-sm opacity-90">
          Restam <strong>{fmt(lim - spent)}</strong> · média de {fmt((lim - spent) / 15)} por dia até 31 out.
        </div>
      </div>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,5fr) minmax(0,7fr)' : 'minmax(0,1fr)' }}>
        <div data-anim="" className="min-w-0">
          <CategoryChart showTip={false} />
        </div>
        <div data-anim="" className="card flex flex-col gap-1">
          <div className="card-title mb-2">Limites por categoria</div>
          {sorted.map((c) => {
            const r = c.spent / c.budget, over = r > 1;
            return (
              <div key={c.id} className="flex items-center gap-3 border-t border-border py-3">
                <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-muted">
                  <Icon icon={c.icon} size={18} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-semibold">{c.name}</span>
                    <span className="whitespace-nowrap tabular-nums">
                      <strong>{fmt(c.spent)}</strong>
                      <span className="text-muted-foreground"> / {fmt(c.budget)}</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      data-grow=""
                      className="h-full origin-left rounded-full"
                      style={{ width: `${Math.min(r * 100, 100).toFixed(1)}%`, background: over ? '#EF4444' : r > 0.85 ? '#B18CF7' : '#7D39EB' }}
                    />
                  </div>
                  <div className="text-xs" style={{ color: over ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>
                    {over ? `Passou ${fmt(c.spent - c.budget)} do limite` : `Restam ${fmt(c.budget - c.spent)} · ${(r * 100).toFixed(0)}% usado`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div data-anim="" className="card flex flex-wrap items-center gap-3.5 p-[18px]">
        <PlutoLogo size={44} />
        <div className="min-w-[200px] flex-1 text-sm leading-normal text-pretty">{MOCK.insights.categoryTip}</div>
        <button onClick={openChat} className="btn btn-accent">
          <Icon icon="sparkles" size={16} />
          Perguntar à Pluto
        </button>
      </div>
    </div>
  );
}
