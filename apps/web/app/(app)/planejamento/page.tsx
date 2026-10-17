'use client';

import { useRef, useState } from 'react';
import { PlutoMascot, type Mood } from '@/components/brand/PlutoMascot';
import { useShell } from '@/components/shell/ShellContext';
import { Icon } from '@/components/ui/Icon';
import { MESES, addMonths, daysBetween, fmt, maskMoney } from '@/lib/format';
import { MOCK } from '@/lib/mock/data';
import { useEnter } from '@/lib/motion';
import { savePlan } from '@/lib/store';

// Esta tela sugere a divisao do orcamento do proximo mes. A regra de sugestao e
// deterministica (regras, nao IA) e deve migrar para o finance-engine (secao 5).

type GroupId = 'ess' | 'want';
type StrategyId = 'equilibrado' | 'metas' | 'custom';
const GROUPS: { id: GroupId; label: string; color: string; ids: string[] }[] = [
  { id: 'ess', label: 'Essenciais', color: '#7D39EB', ids: ['moradia', 'mercado', 'transporte', 'saude'] },
  { id: 'want', label: 'Estilo de vida', color: '#B18CF7', ids: ['lazer', 'delivery', 'assinaturas', 'outros'] },
];
const STRATS: Record<StrategyId, { label: string; sub: string; ess?: number; want?: number }> = {
  equilibrado: { label: 'Equilibrado', sub: '50% · 30% · 20%', ess: 0.5, want: 0.3 },
  metas: { label: 'Foco nas metas', sub: '50% · 20% · 30%', ess: 0.5, want: 0.2 },
  custom: { label: 'Personalizado', sub: 'do seu jeito' },
};
const START = '2026-11-01';
const DANGER = 'var(--danger-text)';
const r50 = (v: number) => Math.max(0, Math.round(v / 50) * 50);
const monthsTo = (iso: string) => Math.max(1, Math.ceil(daysBetween(START, iso) / 30.4));

function suggest(id: StrategyId, income: number) {
  const cats = MOCK.insights.categories, S = id === 'custom' ? STRATS.equilibrado : STRATS[id];
  const budgets: Record<string, number> = {};
  GROUPS.forEach((g) => {
    const list = g.ids.map((i) => cats.find((c) => c.id === i)!);
    const sum = list.reduce((t, c) => t + c.spent, 0), total = income * S[g.id]!;
    list.forEach((c) => (budgets[c.id] = r50((c.spent / sum) * total)));
  });
  const free = income - Object.values(budgets).reduce((a, b) => a + b, 0);
  const need = MOCK.goals.map((g) => ({ id: g.id, v: Math.max(0, g.target - g.saved) / monthsTo(g.deadline) }));
  const needSum = need.reduce((t, x) => t + x.v, 0);
  const room = Math.max(0, free - income * 0.05), k = needSum ? Math.min(1, room / needSum) : 0;
  const goals: Record<string, number> = {};
  need.forEach((x) => (goals[x.id] = Math.floor((x.v * k) / 50) * 50));
  return { budgets, goals };
}

interface PlanState {
  income: number;
  strategy: StrategyId;
  budgets: Record<string, number>;
  goals: Record<string, number>;
  applied: boolean;
  justApplied: boolean;
}

const avgIncome = () => r50(MOCK.insights.monthly.slice(-3).reduce((t, x) => t + x.income, 0) / 3);

function initialState(): PlanState {
  const sp = MOCK.plan;
  if (sp) return { income: sp.income, strategy: sp.strategy as StrategyId, budgets: { ...sp.budgets }, goals: { ...sp.goals }, applied: true, justApplied: false };
  const income = avgIncome();
  return { income, strategy: 'equilibrado', ...suggest('equilibrado', income), applied: false, justApplied: false };
}

function Stepper({ name, value, max, onChange, label }: { name: string; value: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(value - 50)} aria-label={`Diminuir ${name}`} className="icon-btn size-11">
        <Icon icon="minus" size={16} />
      </button>
      <input
        type="range"
        min={0}
        max={max}
        step={50}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        aria-label={label}
        className="h-7 min-w-0 flex-1 cursor-pointer accent-brand"
      />
      <button onClick={() => onChange(value + 50)} aria-label={`Aumentar ${name}`} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-primary text-primary-foreground">
        <Icon icon="plus" size={16} />
      </button>
    </div>
  );
}

export default function PlanejamentoPage() {
  const { mode, nav } = useShell();
  const desk = mode === 'desktop';
  const [s, setS] = useState<PlanState>(initialState);
  const avg = avgIncome();
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const edit = (patch: (st: PlanState) => Partial<PlanState>) => setS((st) => ({ ...st, ...patch(st), strategy: 'custom', applied: false }));

  const cats = MOCK.insights.categories, I = s.income || 0;
  const pct = (v: number) => (I ? ((v / I) * 100).toFixed(0) + '%' : '0%');
  const totals = { ess: 0, want: 0 };
  GROUPS.forEach((g) => (totals[g.id] = g.ids.reduce((t, i) => t + (s.budgets[i] || 0), 0)));
  const gTotal = Object.values(s.goals).reduce((a, b) => a + b, 0), free = I - totals.ess - totals.want - gTotal;

  const groups = GROUPS.map((g) => ({
    ...g,
    rows: g.ids.map((id) => {
      const c = cats.find((x) => x.id === id)!, v = s.budgets[id] || 0, d = v - c.spent;
      return {
        id, name: c.name, icon: c.icon, value: v, max: r50(Math.max(c.spent * 2, v * 1.3, 500)),
        note: d < 0 ? `Corte de ${fmt(-d)} vs. outubro (${fmt(c.spent)})` : `Outubro: ${fmt(c.spent)}`,
        noteFg: d < 0 ? 'var(--brand-text)' : 'var(--muted-foreground)',
        set: (nv: number) => edit((st) => ({ budgets: { ...st.budgets, [id]: Math.max(0, nv) } })),
      };
    }),
  }));

  const goalRows = MOCK.goals.map((g) => {
    const v = s.goals[g.id] || 0, left = Math.max(0, g.target - g.saved), need = left / monthsTo(g.deadline);
    let eta = 'Sem aporte, a meta fica parada', etaFg = DANGER;
    if (left === 0) {
      eta = 'Meta concluída';
      etaFg = 'var(--brand-text)';
    } else if (v > 0) {
      const n = Math.ceil(left / v), d = addMonths(START, n - 1), [y, mm] = d.split('-'), ok = d <= g.deadline;
      eta = `Pronta em ${MESES[+mm! - 1]} ${y} · ${ok ? 'dentro do prazo' : 'depois do prazo'}`;
      etaFg = ok ? 'var(--muted-foreground)' : DANGER;
    }
    return {
      id: g.id, name: g.name, icon: g.icon, value: v, max: r50(Math.max(need * 2.5, v * 1.3, 500)), eta, etaFg,
      set: (nv: number) => edit((st) => ({ goals: { ...st.goals, [g.id]: Math.max(0, nv) } })),
    };
  });

  const late = goalRows.filter((g) => g.etaFg === DANGER).length;
  const over = free < 0;
  const first = goalRows.find((g) => g.etaFg !== DANGER && g.value > 0);
  const lateText = late === 1 ? 'Uma meta vai' : `${late} metas vão`;
  const tip = over
    ? `Seu plano passa ${fmt(-free)} da receita. Reduza Estilo de vida ou o aporte de alguma meta.`
    : late && free >= 100
      ? `${lateText} passar do prazo. Use parte dos ${fmt(free)} livres para aumentar o aporte.`
      : late
        ? `${lateText} passar do prazo. Corte um pouco de Estilo de vida ou troque para “Foco nas metas”.`
        : free > I * 0.1
          ? `Sobram ${fmt(free)}. Investir esse valor rende mais do que deixar parado na conta.`
          : first
            ? `Plano fechado. ${first.name}: ${first.eta.toLowerCase()}.`
            : 'Plano fechado.';
  const catMood: Mood = over ? 'no' : late ? 'think' : '';
  const segs: [number, string][] = [
    [totals.ess, '#7D39EB'],
    [totals.want, '#B18CF7'],
    [gTotal, '#C6FF33'],
  ];
  const legend: [string, string, number][] = [
    ['Essenciais', '#7D39EB', totals.ess],
    ['Estilo de vida', '#B18CF7', totals.want],
    ['Metas', '#C6FF33', gTotal],
    ['Livre', 'var(--muted)', Math.max(free, 0)],
  ];

  const apply = () => {
    if (over) return;
    savePlan({ month: '2026-11', income: I, strategy: s.strategy, budgets: s.budgets, goals: s.goals, appliedAt: new Date().toISOString() });
    setS((st) => ({ ...st, applied: true, justApplied: true }));
  };
  const reset = () => {
    const st = s.strategy === 'custom' ? 'equilibrado' : s.strategy;
    setS((p) => ({ ...p, strategy: st, applied: false, justApplied: false, ...suggest(st, I) }));
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
          Orçamento de novembro montado a partir das suas receitas, despesas e metas. Ajuste o que quiser.
        </p>
      </div>

      <div data-anim="" className="no-scrollbar flex max-w-full gap-1 self-start overflow-x-auto rounded-full bg-muted p-1">
        {(Object.entries(STRATS) as [StrategyId, (typeof STRATS)[StrategyId]][]).map(([id, x]) => {
          const on = s.strategy === id;
          return (
            <button
              key={id}
              onClick={() => (id === 'custom' ? setS((p) => ({ ...p, strategy: 'custom' })) : setS((p) => ({ ...p, strategy: id, applied: false, ...suggest(id, I) })))}
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
              {groupHeader(g.label, g.color, fmt(totals[g.id]), pct(totals[g.id]))}
              {g.rows.map((c) => (
                <div key={c.id} className="flex flex-col gap-2 border-t border-border py-3.5">
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
                    <span className="text-[17px] font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums">{fmt(c.value)}</span>
                  </div>
                  <Stepper name={c.name} value={c.value} max={c.max} onChange={c.set} label={`Orçamento de ${c.name}`} />
                </div>
              ))}
            </div>
          ))}

          <div data-anim="" className="card flex flex-col">
            {groupHeader('Metas', '#C6FF33', fmt(gTotal) + '/mês', pct(gTotal))}
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
                  <span className="text-[17px] font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums">{fmt(g.value)}/mês</span>
                </div>
                <Stepper name={g.name} value={g.value} max={g.max} onChange={g.set} label={`Aporte mensal em ${g.name}`} />
              </div>
            ))}
          </div>
        </div>

        <div className="top-[88px] flex min-w-0 flex-col gap-4" style={{ position: desk ? 'sticky' : 'static', order: desk ? 1 : 0 }}>
          <div data-anim="" className="card flex flex-col gap-[18px]">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Receita prevista para novembro</span>
              <input
                value={fmt(I)}
                onChange={(e) => {
                  const v = maskMoney(e.target.value).value;
                  setS((st) => (st.strategy === 'custom' ? { ...st, income: v, applied: false } : { ...st, income: v, applied: false, ...suggest(st.strategy, v) }));
                }}
                inputMode="numeric"
                aria-label="Receita prevista"
                className="input h-[60px] w-full rounded-[14px] px-4 text-[28px] font-bold tracking-[-0.03em] tabular-nums"
              />
              <span className="text-xs text-muted-foreground">Média dos últimos 3 meses: {fmt(avg)}</span>
            </label>

            <div className="flex flex-col gap-2.5">
              <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-muted">
                {segs.map(([v, color]) => (
                  <div
                    key={color}
                    className="transition-[width] duration-[450ms]"
                    style={{ width: `${(I ? Math.min(v / I, 1) * 100 : 0).toFixed(2)}%`, background: color }}
                  />
                ))}
              </div>
              {legend.map(([label, color, v]) => (
                <div key={label} className="flex min-h-8 items-center gap-2.5 text-sm">
                  <span className="size-2.5 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.1)]" style={{ background: color }} />
                  <span className="flex-1">{label}</span>
                  <span className="text-[13px] text-muted-foreground">{pct(v)}</span>
                  <strong className="min-w-24 text-right tabular-nums">{fmt(v)}</strong>
                </div>
              ))}
            </div>

            <div
              className="flex items-center justify-between gap-2.5 rounded-[14px] px-4 py-3.5"
              style={over ? { background: 'var(--danger-soft)', color: 'var(--danger-text)' } : { background: '#C6FF33', color: '#000' }}
            >
              <span className="text-sm font-semibold">{over ? 'Acima da receita' : 'Livre para investir'}</span>
              <span className="text-xl font-bold tracking-[-0.03em] tabular-nums">{over ? '− ' + fmt(-free) : fmt(free)}</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="size-[72px] shrink-0">
                <PlutoMascot mood={catMood} phrases={over ? ['Assim não fecha.', 'Corta um pouco do lazer?'] : ['Plano sério, gostei.', 'Agora é seguir.', 'Miau.']} />
              </div>
              <span className="text-[13px] leading-normal text-pretty" aria-live="polite">
                {tip}
              </span>
            </div>

            {s.applied && s.justApplied && (
              <div role="status" className="flex flex-wrap items-center gap-2 text-[13px] text-brand-text">
                <Icon icon="circle-check" size={16} />
                Orçamento de novembro aplicado.
                <button onClick={() => nav('budget')} className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-bold text-brand-text underline">
                  Ver orçamento
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2.5">
              <button onClick={reset} className="btn btn-outline h-[50px] flex-[1_1_140px] text-[15px]">
                Refazer sugestão
              </button>
              <button onClick={apply} className="btn btn-primary h-[50px] flex-[2_1_180px] text-[15px]" style={{ opacity: over ? 0.5 : 1 }}>
                <Icon icon="check" size={17} />
                {s.applied ? 'Orçamento aplicado' : 'Aplicar orçamento'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
