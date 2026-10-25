'use client';

import { PLAN_DESTINATION_LABEL, categoryOf, type MonthlyPlan } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { maskMoney } from '@/lib/format';
import { money } from '@/lib/queries';
import { Why } from './Insight';
import { Icon } from './ui/Icon';
import { MoneyInput } from './ui/MoneyInput';

// Planejamento automatico (doc. Melhorias, passo 9): gerado sozinho todo dia 1 as 06:00. Mostra o
// mes anterior, os compromissos, a sobra, os limites e o destino de cada real, com o "por que".
// O usuario ajusta qualquer valor; o ajuste vale para o mes e o investimento absorve a diferenca.

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = (m: string) => MONTHS[+m.slice(5, 7) - 1]!;
const DEST_ICON = { reserva: 'shield', divida: 'landmark', meta: 'target', investimento: 'trending-up' } as const;

export function MonthlyPlanCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['monthly-plan'], queryFn: () => api.monthlyPlan() });
  const [editing, setEditing] = useState(false);
  const generate = useMutation({ mutationFn: api.generateMonthlyPlan, onSuccess: (p) => (qc.setQueryData(['monthly-plan'], p), void qc.invalidateQueries({ queryKey: ['budgets'] })) });

  if (q.isPending) return <div className="h-48 animate-pulse rounded-2xl bg-muted" />;
  const p = q.data;
  if (!p)
    return (
      <section data-anim="" className="card flex flex-col gap-3" aria-label="Planejamento automático">
        <div className="card-title">Planejamento automático</div>
        <p className="m-0 text-[14px] text-pretty text-muted-foreground">
          Todo dia 1, às 6h, a Pluto monta sozinha o plano do mês com seus dados reais: compromissos, limites por categoria e o destino de cada real que sobra. Quer ver o deste mês agora?
        </p>
        <button onClick={() => generate.mutate()} disabled={generate.isPending} className="btn btn-primary self-start">
          <Icon icon="sparkles" size={16} />
          {generate.isPending ? 'Montando…' : 'Gerar planejamento do mês'}
        </button>
        {generate.error && <div className="text-[13px] text-danger-text">{generate.error instanceof ApiRequestError ? generate.error.message : 'Não conseguimos montar agora.'}</div>}
      </section>
    );
  if (editing) return <AdjustPlan plan={p} onDone={() => setEditing(false)} />;

  return (
    <section data-anim="" className="card flex flex-col gap-4" aria-label="Planejamento automático">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="card-title">Planejamento de {monthName(p.month)}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {p.trigger === 'auto' ? 'Gerado no dia 1' : 'Gerado por você'}
            {p.adjusted ? ' · ajustado por você' : ''}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => (!p.adjusted || window.confirm('Recalcular com os dados de hoje desfaz os seus ajustes deste mês. Continuar?')) && generate.mutate()}
            disabled={generate.isPending}
            title="Monta de novo com os dados de hoje"
            className="btn btn-outline h-10 px-3 text-[14px]"
          >
            <Icon icon="refresh-cw" size={15} />
            {generate.isPending ? 'Recalculando…' : 'Recalcular'}
          </button>
          <button onClick={() => setEditing(true)} className="btn btn-outline h-10 px-4 text-[14px]">
            <Icon icon="pencil" size={15} />
            Ajustar
          </button>
        </div>
      </div>
      <p className="m-0 rounded-2xl bg-brand-soft px-4 py-3 text-[14px] leading-relaxed text-pretty">{p.summary}</p>

      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[
          ['Renda prevista', p.incomeMinor, p.incomeSource === 'perfil' ? 'dos seus perfis' : 'média dos meses'],
          ['Compromissos', p.commitmentsMinor, `${p.commitments.length} com data`],
          ['Sobra prevista', p.surplusMinor, 'renda − compromissos'],
          ['Limites do dia a dia', p.limitsMinor, `${p.limits.length} categorias`],
        ].map(([label, v, sub]) => (
          <div key={label as string} className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-muted px-3 py-2.5">
            <span className="text-[12px] text-muted-foreground">{label}</span>
            <span className="text-[16px] font-bold tabular-nums">{money(v as number)}</span>
            <span className="text-[11.5px] text-muted-foreground">{sub}</span>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1 text-[14px] font-semibold">Para onde vai a sobra</div>
        {p.destinations.length === 0 && <div className="text-[13px] text-muted-foreground">Os limites já usam toda a sobra deste mês.</div>}
        {p.destinations.map((d, i) => (
          <div key={i} className="flex flex-col gap-1 border-t border-border py-2.5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                <Icon icon={DEST_ICON[d.kind]} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{d.label}</span>
                <span className="block text-[12px] text-muted-foreground">{PLAN_DESTINATION_LABEL[d.kind]}</span>
              </span>
              <span className="shrink-0 text-[14px] font-semibold tabular-nums">{money(d.amountMinor)}</span>
            </div>
            <Why>{d.why}</Why>
          </div>
        ))}
        <div className="flex justify-between border-t border-border pt-2 text-[13px]">
          <span className="text-muted-foreground">Sem destino</span>
          <span className="font-semibold tabular-nums">{money(p.freeMinor - p.destinations.reduce((t, d) => t + d.amountMinor, 0))}</span>
        </div>
      </div>

      {p.commitments.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-semibold">Compromissos do mês ({money(p.commitmentsMinor)})</summary>
          {p.commitments.map((c, i) => (
            <div key={i} className="flex justify-between gap-3 border-t border-border py-1.5">
              <span className="min-w-0 truncate">
                {c.name}
                {c.due ? <span className="text-muted-foreground"> · {c.due}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">{money(c.amountMinor)}</span>
            </div>
          ))}
        </details>
      )}
      {p.limits.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-semibold">Limites por categoria ({money(p.limitsMinor)})</summary>
          {p.limits.map((l) => (
            <div key={l.categoryKey} className="flex justify-between gap-3 border-t border-border py-1.5">
              <span className="min-w-0 truncate">
                {categoryOf(l.categoryKey).label} <span className="text-muted-foreground">· média {money(l.averageMinor)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{money(l.limitMinor)}</span>
            </div>
          ))}
        </details>
      )}
      <details className="text-[13px]">
        <summary className="cursor-pointer font-semibold">Como foi {monthName(p.previous.month)}</summary>
        <div className="mt-1.5 text-muted-foreground">
          Entrou {money(p.previous.incomeMinor)} e saiu {money(p.previous.expensesMinor)}.
          {p.previous.byCategory.length > 0 && ` Maiores gastos: ${p.previous.byCategory.slice(0, 3).map((c) => `${categoryOf(c.categoryKey).label} (${money(c.amountMinor)})`).join(', ')}.`}
        </div>
      </details>
    </section>
  );
}

function AdjustPlan({ plan, onDone }: { plan: MonthlyPlan; onDone: () => void }) {
  const qc = useQueryClient();
  const [limits, setLimits] = useState(() => plan.limits.map((l) => ({ ...l, text: maskMoney(String(l.limitMinor)) })));
  const [dests, setDests] = useState(() => plan.destinations.filter((d) => d.kind !== 'investimento').map((d) => ({ ...d, text: maskMoney(String(d.amountMinor)) })));
  const [error, setError] = useState('');
  const toMinor = (m: { value: number }) => Math.round(m.value * 100);
  const limitsMinor = limits.reduce((t, l) => t + toMinor(l.text), 0);
  const free = Math.max(0, plan.surplusMinor - limitsMinor);
  const assigned = dests.reduce((t, d) => t + toMinor(d.text), 0);
  const save = useMutation({
    mutationFn: () =>
      api.adjustMonthlyPlan(plan.month, {
        limits: limits.map((l) => ({ categoryKey: l.categoryKey, limitMinor: toMinor(l.text) })),
        destinations: dests.map((d) => ({ kind: d.kind, refId: d.refId, label: d.label, amountMinor: toMinor(d.text) })),
      }),
    onSuccess: (p) => {
      qc.setQueryData(['monthly-plan'], p);
      void qc.invalidateQueries({ queryKey: ['budgets'] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar.'),
  });
  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Ajustar planejamento">
      <div className="card-title">Ajustar o plano de {monthName(plan.month)}</div>
      <p className="m-0 text-[13px] text-muted-foreground">O ajuste vale só para este mês. O que não tiver destino vai para investimento, para nenhum real ficar parado.</p>
      <div className="text-[14px] font-semibold">Limites por categoria</div>
      {limits.map((l, i) => (
        <label key={l.categoryKey} className="flex items-center justify-between gap-3 text-[14px]">
          <span className="min-w-0 truncate">{categoryOf(l.categoryKey).label}</span>
          <MoneyInput value={l.text.text} onChange={(m) => setLimits((all) => all.map((x, j) => (j === i ? { ...x, text: m } : x)))} className="input h-10 w-[150px] text-right" aria-label={`Limite de ${categoryOf(l.categoryKey).label}`} />
        </label>
      ))}
      <div className="mt-1 text-[14px] font-semibold">Destinos ({money(free)} livres depois dos limites)</div>
      {dests.map((d, i) => (
        <label key={`${d.kind}:${d.refId ?? i}`} className="flex items-center justify-between gap-3 text-[14px]">
          <span className="min-w-0 truncate">{d.label}</span>
          <MoneyInput value={d.text.text} onChange={(m) => setDests((all) => all.map((x, j) => (j === i ? { ...x, text: m } : x)))} className="input h-10 w-[150px] text-right" aria-label={`Valor para ${d.label}`} />
        </label>
      ))}
      <div className="flex justify-between rounded-xl bg-muted px-3 py-2 text-[13px]">
        <span>Vai para investimento</span>
        <span className="font-semibold tabular-nums" style={{ color: assigned > free ? 'var(--danger-text)' : undefined }}>
          {assigned > free ? `passou ${money(assigned - free)}` : money(free - assigned)}
        </span>
      </div>
      {error && (
        <div role="alert" className="text-[13px] text-danger-text">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onDone} className="btn btn-outline h-11 flex-1">
          Cancelar
        </button>
        <button onClick={() => save.mutate()} disabled={save.isPending || assigned > free} className="btn btn-primary h-11 flex-1 disabled:opacity-50">
          {save.isPending ? 'Salvando…' : 'Salvar ajuste'}
        </button>
      </div>
    </section>
  );
}
