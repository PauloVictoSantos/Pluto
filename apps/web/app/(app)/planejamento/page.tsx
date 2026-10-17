'use client';

import { CATEGORIES, type Budget, type Goal } from '@pluto/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { PlutoMascot, type Mood } from '@/components/brand/PlutoMascot';
import { useShell } from '@/components/shell/ShellContext';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { ApiRequestError, api } from '@/lib/api';
import { MESES, daysBetween, maskMoney } from '@/lib/format';
import { useEnter } from '@/lib/motion';
import { addMonth, monthLower, money, useBudget, useCurrentMonth, useGoals, useSpending, useSummary } from '@/lib/queries';

// Sugestao deterministica (regras, nao IA). Base: medias reais dos ultimos 3 meses fechados.
// Folga (RN-24) = receita - essenciais - estilo de vida - aportes de metas.

type GroupId = 'essential' | 'lifestyle';
type StrategyId = 'equilibrado' | 'metas' | 'custom';
const GROUPS: { id: GroupId; label: string; color: string }[] = [
  { id: 'essential', label: 'Essenciais', color: '#7D39EB' },
  { id: 'lifestyle', label: 'Estilo de vida', color: '#B18CF7' },
];
const STRATS: Record<StrategyId, { label: string; sub: string; essential?: number; lifestyle?: number }> = {
  equilibrado: { label: 'Equilibrado', sub: '50% · 30% · 20%', essential: 0.5, lifestyle: 0.3 },
  metas: { label: 'Foco nas metas', sub: '50% · 20% · 30%', essential: 0.5, lifestyle: 0.2 },
  custom: { label: 'Personalizado', sub: 'do seu jeito' },
};
const DANGER = 'var(--danger-text)';
const STEP = 5_000; // R$ 50
const r50 = (v: number) => Math.max(0, Math.round(v / STEP) * STEP);

interface Base {
  target: string;
  avgIncome: number;
  /** Gasto medio por categoria (centavos/mes). */
  avg: Record<string, number>;
  goals: Goal[];
  existing: Budget | undefined;
}

const monthsTo = (from: string, deadline: string) => Math.max(1, Math.ceil(daysBetween(`${from}-01`, deadline) / 30.4));

function suggest(base: Base, id: StrategyId, income: number) {
  const S = id === 'custom' ? STRATS.equilibrado : STRATS[id];
  const budgets: Record<string, number> = {};
  for (const g of GROUPS) {
    const keys = CATEGORIES.filter((c) => c.group === g.id && (base.avg[c.key] ?? 0) > 0).map((c) => c.key);
    const sum = keys.reduce((t, k) => t + base.avg[k]!, 0), total = income * S[g.id]!;
    // Distribui o teto do grupo na proporcao do gasto real, sem passar do que voce costuma gastar.
    keys.forEach((k) => (budgets[k] = r50(Math.min(base.avg[k]!, sum ? (base.avg[k]! / sum) * total : 0))));
  }
  const free = income - Object.values(budgets).reduce((a, b) => a + b, 0);
  const need = base.goals.map((g) => ({ id: g.id, v: Math.max(0, g.targetMinor - g.savedMinor) / monthsTo(base.target, g.deadline) }));
  const needSum = need.reduce((t, x) => t + x.v, 0);
  const room = Math.max(0, free - income * 0.05), k = needSum ? Math.min(1, room / needSum) : 0;
  const goals: Record<string, number> = {};
  need.forEach((x) => (goals[x.id] = Math.floor((x.v * k) / STEP) * STEP));
  return { budgets, goals };
}

export default function PlanejamentoPage() {
  const current = useCurrentMonth();
  const [which, setWhich] = useState<'current' | 'next' | null>(null);
  const thisMonth = useBudget(current);
  // Ate o usuario escolher: sem orcamento neste mes, comeca pelo mes atual; senao, pelo proximo.
  const choice = which ?? (thisMonth.isSuccess && !thisMonth.data.items.length ? 'current' : 'next');
  const target = choice === 'current' ? current : addMonth(current, 1);
  const summary = useSummary();
  const s1 = useSpending(addMonth(current, -1)), s2 = useSpending(addMonth(current, -2)), s3 = useSpending(addMonth(current, -3));
  const goals = useGoals();
  const existing = useBudget(target);

  const loading = [summary, s1, s2, s3, goals, existing, thisMonth].some((q) => q.isPending);
  const failed = [summary, s1, s2, s3, goals, existing].some((q) => q.isError);
  if (failed) return <div className="card text-sm text-danger-text">Não foi possível carregar os dados do planejamento.</div>;
  if (loading) return <div className="card text-sm text-muted-foreground">Calculando sua média dos últimos meses…</div>;

  const closed = summary.data!.monthly.slice(2, 5); // 3 meses fechados antes do atual
  const withIncome = closed.filter((m) => m.incomeMinor > 0);
  const avgIncome = withIncome.length ? r50(withIncome.reduce((t, m) => t + m.incomeMinor, 0) / withIncome.length) : 0;
  const avg: Record<string, number> = {};
  for (const sp of [s1.data!, s2.data!, s3.data!]) for (const c of sp.categories) avg[c.key] = (avg[c.key] ?? 0) + c.spentMinor / 3;
  for (const k of Object.keys(avg)) avg[k] = Math.round(avg[k]!);

  const base: Base = { target, avgIncome, avg, goals: goals.data!, existing: existing.data!.items.length ? existing.data : undefined };
  // key: recria o editor se os dados de base mudarem (ex.: nova meta).
  return (
    <PlanEditor
      key={`${target}-${goals.data!.length}`}
      base={base}
      monthPicker={
        <Segmented
          items={[
            { id: 'current' as const, label: `Este mês · ${monthLower(current)}` },
            { id: 'next' as const, label: `Próximo · ${monthLower(addMonth(current, 1))}` },
          ]}
          value={choice}
          onChange={setWhich}
          height={40}
          className="self-start"
          itemClassName="px-4 text-[13px] font-semibold"
        />
      }
    />
  );
}

function Stepper({ name, value, max, onChange, label }: { name: string; value: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(value - STEP)} aria-label={`Diminuir ${name}`} className="icon-btn size-11">
        <Icon icon="minus" size={16} />
      </button>
      <input type="range" min={0} max={max} step={STEP} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label} className="h-7 min-w-0 flex-1 cursor-pointer accent-brand" />
      <button onClick={() => onChange(value + STEP)} aria-label={`Aumentar ${name}`} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-primary text-primary-foreground">
        <Icon icon="plus" size={16} />
      </button>
    </div>
  );
}

function PlanEditor({ base, monthPicker }: { base: Base; monthPicker: ReactNode }) {
  const { mode, nav } = useShell();
  const qc = useQueryClient();
  const desk = mode === 'desktop';
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const [s, setS] = useState(() => {
    if (base.existing) {
      const budgets = Object.fromEntries(base.existing.items.map((i) => [i.categoryKey, i.limitMinor]));
      const goals = Object.fromEntries(base.goals.map((g) => [g.id, g.monthlyContributionMinor]));
      const spent = Object.values(budgets).reduce((a, b) => a + b, 0) + Object.values(goals).reduce((a, b) => a + b, 0);
      return { income: Math.max(base.avgIncome, spent), strategy: 'custom' as StrategyId, budgets, goals, applied: true, saving: false, error: '', justApplied: false };
    }
    return { income: base.avgIncome, strategy: 'equilibrado' as StrategyId, ...suggest(base, 'equilibrado', base.avgIncome), applied: false, saving: false, error: '', justApplied: false };
  });
  type St = typeof s;
  const edit = (patch: (st: St) => Partial<St>) => setS((st) => ({ ...st, ...patch(st), strategy: 'custom', applied: false, justApplied: false }));

  const I = s.income || 0;
  const pct = (v: number) => (I ? ((v / I) * 100).toFixed(0) + '%' : '0%');
  const visible = (g: GroupId) => CATEGORIES.filter((c) => c.group === g && ((base.avg[c.key] ?? 0) > 0 || (s.budgets[c.key] ?? 0) > 0));
  const totals = { essential: 0, lifestyle: 0 };
  GROUPS.forEach((g) => (totals[g.id] = visible(g.id).reduce((t, c) => t + (s.budgets[c.key] || 0), 0)));
  const gTotal = Object.values(s.goals).reduce((a, b) => a + b, 0), free = I - totals.essential - totals.lifestyle - gTotal;

  const groups = GROUPS.map((g) => ({
    ...g,
    rows: visible(g.id).map((c) => {
      const v = s.budgets[c.key] || 0, avg = base.avg[c.key] ?? 0, d = v - avg;
      return {
        key: c.key, name: c.label, icon: c.icon, value: v, max: r50(Math.max(avg * 2, v * 1.3, 50_000)),
        note: avg ? (d < 0 ? `Corte de ${money(-d)} vs. sua média (${money(avg)})` : `Sua média: ${money(avg)}/mês`) : 'Sem gastos nos últimos meses',
        noteFg: d < 0 && avg ? 'var(--brand-text)' : 'var(--muted-foreground)',
        set: (nv: number) => edit((st) => ({ budgets: { ...st.budgets, [c.key]: Math.max(0, nv) } })),
      };
    }),
  }));

  const goalRows = base.goals.map((g) => {
    const v = s.goals[g.id] || 0, left = Math.max(0, g.targetMinor - g.savedMinor), need = left / monthsTo(base.target, g.deadline);
    let eta = 'Sem aporte, a meta fica parada', etaFg = DANGER;
    if (left === 0) {
      eta = 'Meta concluída';
      etaFg = 'var(--brand-text)';
    } else if (v > 0) {
      const n = Math.ceil(left / v), d = addMonth(base.target, n - 1), ok = `${d}-28` <= g.deadline;
      eta = `Pronta em ${MESES[+d.slice(5) - 1]} ${d.slice(0, 4)} · ${ok ? 'dentro do prazo' : 'depois do prazo'}`;
      etaFg = ok ? 'var(--muted-foreground)' : DANGER;
    }
    return {
      id: g.id, name: g.name, icon: g.icon, value: v, max: r50(Math.max(need * 2.5, v * 1.3, 50_000)), eta, etaFg,
      set: (nv: number) => edit((st) => ({ goals: { ...st.goals, [g.id]: Math.max(0, nv) } })),
    };
  });

  const late = goalRows.filter((g) => g.etaFg === DANGER).length;
  const over = free < 0;
  const lateText = late === 1 ? 'Uma meta vai' : `${late} metas vão`;
  const tip = !I
    ? 'Não encontrei receitas recorrentes nos últimos meses. Informe a receita prevista para montar o plano.'
    : over
      ? `Seu plano passa ${money(-free)} da receita. Reduza Estilo de vida ou o aporte de alguma meta.`
      : late && free >= 10_000
        ? `${lateText} passar do prazo. Use parte dos ${money(free)} livres para aumentar o aporte.`
        : late
          ? `${lateText} passar do prazo. Corte um pouco de Estilo de vida ou troque para “Foco nas metas”.`
          : base.goals.length === 0 && free > 0
            ? `Sobram ${money(free)}. Crie uma meta em Metas para dar destino a esse valor.`
            : free > I * 0.1
              ? `Sobram ${money(free)} sem destino definido no plano.`
              : 'Plano fechado.';
  const catMood: Mood = over ? 'no' : late ? 'think' : '';

  const segs: [number, string][] = [[totals.essential, '#7D39EB'], [totals.lifestyle, '#B18CF7'], [gTotal, '#C6FF33']];
  const legend: [string, string, number][] = [
    ['Essenciais', '#7D39EB', totals.essential],
    ['Estilo de vida', '#B18CF7', totals.lifestyle],
    ['Metas', '#C6FF33', gTotal],
    ['Livre', 'var(--muted)', Math.max(free, 0)],
  ];

  const apply = async () => {
    if (over || s.saving) return;
    setS((st) => ({ ...st, saving: true, error: '' }));
    try {
      await api.putBudget(base.target, Object.entries(s.budgets).map(([categoryKey, limitMinor]) => ({ categoryKey, limitMinor })));
      await Promise.all(base.goals.map((g) => api.updateGoal(g.id, { monthlyContributionMinor: s.goals[g.id] || 0 })));
      await qc.invalidateQueries({ queryKey: ['budgets'] });
      await qc.invalidateQueries({ queryKey: ['goals'] });
      setS((st) => ({ ...st, applied: true, justApplied: true, saving: false }));
    } catch (e) {
      setS((st) => ({ ...st, saving: false, error: e instanceof ApiRequestError ? e.message : 'Não foi possível salvar o plano.' }));
    }
  };
  const reset = () => {
    const st = s.strategy === 'custom' ? 'equilibrado' : s.strategy;
    setS((p) => ({ ...p, strategy: st, applied: false, justApplied: false, ...suggest(base, st, I) }));
  };

  const groupHeader = (label: string, color: string, total: string, p: string) => (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]" style={{ background: color }} />
        <span className="card-title">{label}</span>
      </div>
      <span className="shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums">
        {total} <span className="font-normal text-muted-foreground">· {p}</span>
      </span>
    </div>
  );

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-col gap-1">
        <h1 className="page-title">Planejamento</h1>
        <p className="m-0 text-sm text-pretty text-muted-foreground">
          Orçamento de {monthLower(base.target)} montado a partir da sua média real dos últimos 3 meses. Ajuste o que quiser.
        </p>
      </div>

      {monthPicker}

      <div data-anim="" className="no-scrollbar flex max-w-full gap-1 self-start overflow-x-auto rounded-full bg-muted p-1">
        {(Object.entries(STRATS) as [StrategyId, (typeof STRATS)[StrategyId]][]).map(([id, x]) => {
          const on = s.strategy === id;
          return (
            <button
              key={id}
              onClick={() => (id === 'custom' ? setS((p) => ({ ...p, strategy: 'custom' })) : setS((p) => ({ ...p, strategy: id, applied: false, ...suggest(base, id, I) })))}
              className="flex min-h-12 shrink-0 cursor-pointer flex-col items-start justify-center gap-px rounded-full border-0 px-[18px] whitespace-nowrap"
              style={{ background: on ? 'var(--primary)' : 'transparent', color: on ? 'var(--primary-foreground)' : 'var(--foreground)' }}
            >
              <span className="text-sm font-semibold">{x.label}</span>
              <span className="text-[11px] opacity-75">{x.sub}</span>
            </button>
          );
        })}
      </div>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: desk ? 'minmax(0,7fr) minmax(0,5fr)' : 'minmax(0,1fr)' }}>
        <div className="flex min-w-0 flex-col gap-4" style={{ order: desk ? 0 : 1 }}>
          {groups.map((g) => (
            <div key={g.id} data-anim="" className="card flex flex-col">
              {groupHeader(g.label, g.color, money(totals[g.id]), pct(totals[g.id]))}
              {g.rows.length === 0 && <div className="border-t border-border py-3.5 text-sm text-muted-foreground">Nenhum gasto nessas categorias nos últimos meses.</div>}
              {g.rows.map((c) => (
                <div key={c.key} className="flex flex-col gap-2 border-t border-border py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                      <Icon icon={c.icon} size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold">{c.name}</div>
                      <div className="mt-0.5 text-xs" style={{ color: c.noteFg }}>
                        {c.note}
                      </div>
                    </div>
                    <span className="text-[17px] font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums">{money(c.value)}</span>
                  </div>
                  <Stepper name={c.name} value={c.value} max={c.max} onChange={c.set} label={`Orçamento de ${c.name}`} />
                </div>
              ))}
            </div>
          ))}

          <div data-anim="" className="card flex flex-col">
            {groupHeader('Metas', '#C6FF33', money(gTotal) + '/mês', pct(gTotal))}
            {goalRows.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3.5 text-sm text-muted-foreground">
                Você ainda não tem metas.
                <button onClick={() => nav('goals')} className="btn btn-outline h-10">
                  <Icon icon="plus" size={15} />
                  Criar meta
                </button>
              </div>
            )}
            {goalRows.map((g) => (
              <div key={g.id} className="flex flex-col gap-2 border-t border-border py-3.5">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-text">
                    <Icon icon={g.icon} size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">{g.name}</div>
                    <div className="mt-0.5 text-xs" style={{ color: g.etaFg }}>
                      {g.eta}
                    </div>
                  </div>
                  <span className="text-[17px] font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums">{money(g.value)}/mês</span>
                </div>
                <Stepper name={g.name} value={g.value} max={g.max} onChange={g.set} label={`Aporte mensal em ${g.name}`} />
              </div>
            ))}
          </div>
        </div>

        <div className="top-[88px] flex min-w-0 flex-col gap-4" style={{ position: desk ? 'sticky' : 'static', order: desk ? 1 : 0 }}>
          <div data-anim="" className="card flex flex-col gap-[18px]">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Receita prevista para {monthLower(base.target)}</span>
              <input
                value={money(I)}
                onChange={(e) => {
                  const v = Math.round(maskMoney(e.target.value).value * 100);
                  setS((st) => (st.strategy === 'custom' ? { ...st, income: v, applied: false } : { ...st, income: v, applied: false, ...suggest(base, st.strategy, v) }));
                }}
                inputMode="numeric"
                aria-label="Receita prevista"
                className="input h-[60px] w-full rounded-[14px] px-4 text-[28px] font-bold tracking-[-0.03em] tabular-nums"
              />
              <span className="text-xs text-muted-foreground">Média dos últimos 3 meses: {money(base.avgIncome)}</span>
            </label>

            <div className="flex flex-col gap-2.5">
              <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-muted">
                {segs.map(([v, color]) => (
                  <div key={color} className="transition-[width] duration-[450ms]" style={{ width: `${(I ? Math.min(v / I, 1) * 100 : 0).toFixed(2)}%`, background: color }} />
                ))}
              </div>
              {legend.map(([label, color, v]) => (
                <div key={label} className="flex min-h-8 items-center gap-2.5 text-sm">
                  <span className="size-2.5 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.1)]" style={{ background: color }} />
                  <span className="flex-1">{label}</span>
                  <span className="text-[13px] text-muted-foreground">{pct(v)}</span>
                  <strong className="min-w-24 text-right tabular-nums">{money(v)}</strong>
                </div>
              ))}
            </div>

            <div
              className="flex items-center justify-between gap-2.5 rounded-[14px] px-4 py-3.5"
              style={over ? { background: 'var(--danger-soft)', color: 'var(--danger-text)' } : { background: '#C6FF33', color: '#000' }}
            >
              <span className="text-sm font-semibold">{over ? 'Acima da receita' : 'Livre no mês'}</span>
              <span className="text-xl font-bold tracking-[-0.03em] tabular-nums">{over ? '− ' + money(-free) : money(free)}</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="size-[72px] shrink-0">
                <PlutoMascot mood={catMood} phrases={over ? ['Assim não fecha.', 'Corta um pouco do lazer?'] : ['Plano sério, gostei.', 'Agora é seguir.', 'Miau.']} />
              </div>
              <span className="text-[13px] leading-normal text-pretty" aria-live="polite">
                {tip}
              </span>
            </div>

            {s.justApplied && (
              <div role="status" className="flex flex-wrap items-center gap-2 text-[13px] text-brand-text">
                <Icon icon="circle-check" size={16} />
                Orçamento de {monthLower(base.target)} salvo.
                <button onClick={() => nav('budget')} className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-bold text-brand-text underline">
                  Ver orçamento
                </button>
              </div>
            )}
            {s.error && (
              <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
                <Icon icon="circle-alert" size={16} />
                {s.error}
              </div>
            )}
            <div className="flex flex-wrap gap-2.5">
              <button onClick={reset} className="btn btn-outline h-[50px] flex-[1_1_140px] text-[15px]">
                Refazer sugestão
              </button>
              <button onClick={() => void apply()} disabled={s.saving} className="btn btn-primary h-[50px] flex-[2_1_180px] text-[15px]" style={{ opacity: over || s.saving ? 0.5 : 1 }}>
                <Icon icon="check" size={17} />
                {s.saving ? 'Salvando…' : s.applied ? 'Orçamento salvo' : 'Salvar orçamento'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
