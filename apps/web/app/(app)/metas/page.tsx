'use client';

import { categoryOf, type Goal, type GoalInsights } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { GoalInterview } from '@/components/GoalInterview';
import { GoalsPlanCard } from '@/components/GoalsPlanCard';
import { ObligationsCard } from '@/components/ObligationsCard';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { ProbabilityBadge, Why } from '@/components/Insight';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { ApiRequestError, api } from '@/lib/api';
import { ymdIn } from '@/lib/datetime';
import { MESES, maskMoney, hidePct } from '@/lib/format';
import { useEnter } from '@/lib/motion';
import { money, useGoals, useTz } from '@/lib/queries';

const PRIORITIES = ['Máxima', 'Alta', 'Média', 'Baixa', 'Quando der'];
const STATUS: Record<Goal['status'], string> = { ativa: 'Ativa', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' };

type Dialog = { kind: 'add'; goal: Goal } | { kind: 'delete'; goal: Goal } | null;

export default function MetasPage() {
  const qc = useQueryClient();
  const tz = useTz();
  const today = ymdIn(new Date(), tz);
  const goals = useGoals();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [interview, setInterview] = useState<string | 'new' | null>(null);
  const [amount, setAmount] = useState({ text: '', value: 0 });
  const insights = useQuery({ queryKey: ['analytics', 'goals'], queryFn: api.goalInsights });
  const drafts = useQuery({ queryKey: ['goal-drafts'], queryFn: api.goalDrafts });
  const insightOf = (id: string) => insights.data?.goals.find((x) => x.goalId === id);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const list = (goals.data ?? []).filter((g) => g.status !== 'cancelada');
  const total = list.reduce((t, g) => t + g.savedMinor, 0);
  const ok = amount.value > 0;

  const refresh = () => {
    for (const k of ['goals', 'analytics', 'goals-plan', 'goal-drafts', 'agent-limit']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const done = () => {
    setDialog(null);
    refresh();
  };
  const fail = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.');
  const add = useMutation({ mutationFn: (g: Goal) => api.updateGoal(g.id, { addMinor: Math.round(amount.value * 100) }), onSuccess: done, onError: fail });
  const remove = useMutation({ mutationFn: (g: Goal) => api.deleteGoal(g.id), onSuccess: done, onError: fail });
  const status = useMutation({
    mutationFn: ({ g, to }: { g: Goal; to: 'ativa' | 'pausada' | 'concluida' }) => api.setGoalStatus(g.id, to),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: fail,
  });

  const open = (d: Dialog) => {
    setError('');
    setAmount({ text: '', value: 0 });
    setDialog(d);
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (ok && dialog?.kind === 'add') add.mutate(dialog.goal);
  };
  const busy = add.isPending || remove.isPending;
  const openDrafts = drafts.data ?? [];

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Metas</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            {goals.isPending ? 'Carregando…' : `${list.length} meta${list.length === 1 ? '' : 's'} · ${money(total)} guardados`}
          </p>
        </div>
        <button onClick={() => setInterview('new')} className="btn btn-primary">
          <Icon icon="plus" size={16} />
          Nova meta
        </button>
      </div>

      {openDrafts.length > 0 && (
        <div data-anim="" className="card flex flex-col gap-2" aria-label="Metas em construção">
          <div className="card-title">Em construção</div>
          {openDrafts.map((d) => (
            <button key={d.id} onClick={() => setInterview(d.id)} className="flex cursor-pointer items-center gap-3 border-0 border-t border-solid border-border bg-transparent py-2.5 text-left text-foreground">
              <Icon icon="sparkles" size={16} />
              <span className="flex-1 text-[14px] font-semibold">{d.title}</span>
              <span className="text-[12.5px] text-muted-foreground">{d.status === 'em-analise' ? 'Proposta pronta' : `${d.missing.length} pergunta${d.missing.length === 1 ? '' : 's'}`}</span>
              <Icon icon="chevron-right" size={16} />
            </button>
          ))}
        </div>
      )}

      {goals.isSuccess && list.length === 0 && (
        <div data-anim="" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <PlutoLogo size={72} />
          <div className="text-[17px] font-semibold">Nenhuma meta ainda</div>
          <div className="max-w-[360px] text-sm text-pretty text-muted-foreground">
            Uma reserva de emergência, um computador, uma viagem… O Plutão faz algumas perguntas, calcula se cabe no seu mês e propõe o plano.
          </div>
          <button onClick={() => setInterview('new')} className="btn btn-primary mt-1">
            <Icon icon="plus" size={16} />
            Criar primeira meta
          </button>
        </div>
      )}

      {error && !dialog && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))' }}>
        {list.map((g, i) => {
          const r = Math.min(g.savedMinor / g.targetMinor, 1), doneGoal = r >= 1, feat = i === 0 && g.status === 'ativa';
          const paused = g.status === 'pausada';
          // Aporte necessario calculado no servidor (o navegador nao calcula valores).
          const need = insightOf(g.id)?.requiredMonthlyMinor;
          const late = g.deadline < today && !doneGoal;
          const subFg = feat ? 'rgba(255,255,255,.85)' : 'var(--muted-foreground)';
          return (
            <div
              key={g.id}
              data-anim=""
              className="flex flex-col gap-4 rounded-2xl p-[clamp(18px,4vw,24px)]"
              style={{ background: feat ? '#7D39EB' : 'var(--card)', color: feat ? '#fff' : 'var(--foreground)', border: `1px solid ${feat ? '#7D39EB' : 'var(--border)'}`, opacity: paused ? 0.7 : 1 }}
            >
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-[14px]" style={{ background: feat ? 'rgba(255,255,255,.16)' : 'var(--brand-soft)' }}>
                  <Icon icon={g.icon} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold">{g.name}</div>
                  <div className="mt-0.5 text-xs" style={{ color: subFg }}>
                    até {MESES[+g.deadline.slice(5, 7) - 1]} {g.deadline.slice(0, 4)} ·{' '}
                    {g.score !== null ? `prioridade ${Math.round(g.score * 100)}/100` : `prioridade ${PRIORITIES[g.priority - 1]!.toLowerCase()}`}
                    {g.status !== 'ativa' && ` · ${STATUS[g.status].toLowerCase()}`}
                  </div>
                </div>
                <button
                  onClick={() => open({ kind: 'delete', goal: g })}
                  aria-label={`Excluir meta ${g.name}`}
                  className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent opacity-70 hover:opacity-100"
                  style={{ color: 'inherit' }}
                >
                  <Icon icon="x" size={16} />
                </button>
              </div>
              <div>
                <div className="text-[28px] font-bold tracking-[-0.04em] tabular-nums">{money(g.savedMinor)}</div>
                <div className="mt-0.5 text-[13px]" style={{ color: subFg }}>
                  de {money(g.targetMinor)} · {hidePct(`${(r * 100).toFixed(0)}%`)}
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full" style={{ background: feat ? 'rgba(255,255,255,.2)' : 'var(--muted)' }}>
                <div data-grow="" className="h-full origin-left rounded-full transition-[width] duration-[600ms]" style={{ width: `${(r * 100).toFixed(1)}%`, background: feat || doneGoal ? '#C6FF33' : '#7D39EB' }} />
              </div>
              <div className="text-[13px]" style={{ color: late ? (feat ? '#fff' : 'var(--danger-text)') : subFg }}>
                {paused
                  ? 'Pausada: não recebe aporte nem entra no limite do mês.'
                  : doneGoal
                    ? 'Meta concluída. Parabéns!'
                    : late
                      ? 'O prazo passou. Ajuste a data ou o valor.'
                      : !need
                        ? 'Calculando quanto guardar por mês…'
                        : g.monthlyContributionMinor
                          ? `Plano: ${money(g.monthlyContributionMinor)}/mês · precisa de ${money(need)}/mês`
                          : `Guarde ${money(need)} por mês para chegar lá`}
              </div>
              {!paused && <GoalChance goal={g} insight={insightOf(g.id)} months={insights.data?.months ?? 0} featured={feat} />}
              <div className="flex gap-2">
                {!paused && (
                  <button
                    onClick={() => open({ kind: 'add', goal: g })}
                    className="btn h-[46px] flex-1"
                    style={{ background: feat ? '#C6FF33' : 'var(--card)', color: feat ? '#000' : 'var(--foreground)', borderColor: feat ? '#C6FF33' : 'var(--border)' }}
                  >
                    <Icon icon="plus" size={16} />
                    Registrar valor guardado
                  </button>
                )}
                {!doneGoal && (
                  <button
                    onClick={() => status.mutate({ g, to: paused ? 'ativa' : 'pausada' })}
                    disabled={status.isPending}
                    className={`btn h-[46px] ${paused ? 'btn-primary flex-1' : ''}`}
                    style={paused ? undefined : { background: 'transparent', color: 'inherit', borderColor: feat ? 'rgba(255,255,255,.4)' : 'var(--border)' }}
                    aria-label={paused ? `Retomar ${g.name}` : `Pausar ${g.name}`}
                  >
                    {paused ? 'Retomar' : 'Pausar'}
                  </button>
                )}
                {doneGoal && g.status !== 'concluida' && (
                  <button onClick={() => status.mutate({ g, to: 'concluida' })} className="btn btn-outline h-[46px]">
                    Concluir
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {list.length > 0 && <GoalsPlanCard />}
      <ObligationsCard />

      {interview && (
        <GoalInterview
          draftId={interview === 'new' ? null : interview}
          onClose={() => {
            setInterview(null);
            refresh();
          }}
        />
      )}

      {dialog?.kind === 'add' && (
        <Sheet onClose={() => setDialog(null)} onSubmit={confirm} label="Registrar valor guardado">
          <div className="text-xl font-bold tracking-[-0.02em]">Guardar em “{dialog.goal.name}”</div>
          <div className="text-[13px] text-muted-foreground">Registre o que você já separou para esta meta. O Pluto não movimenta dinheiro.</div>
          <label className="field">
            Quanto você guardou?
            <input value={amount.text} onChange={(e) => setAmount(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input h-14 text-2xl font-bold" autoFocus />
          </label>
          {error && (
            <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
              <Icon icon="circle-alert" size={16} />
              {error}
            </div>
          )}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setDialog(null)} className="btn btn-outline h-[50px] flex-1 text-[15px]">
              Cancelar
            </button>
            <button type="submit" disabled={!ok || busy} className="btn btn-primary h-[50px] flex-1 text-[15px]" style={{ opacity: ok && !busy ? 1 : 0.5 }}>
              {busy ? 'Salvando…' : 'Registrar'}
            </button>
          </div>
        </Sheet>
      )}

      {dialog?.kind === 'delete' && (
        <Sheet onClose={() => setDialog(null)} role="alertdialog" label="Excluir meta" width={400} top="26vh">
          <div className="text-xl font-bold tracking-[-0.02em]">Excluir “{dialog.goal.name}”?</div>
          <div className="text-sm text-muted-foreground">O histórico de valores guardados desta meta será apagado.</div>
          {error && <div className="text-[13px] text-danger-text">{error}</div>}
          <div className="flex gap-2.5">
            <button onClick={() => setDialog(null)} className="btn btn-outline h-12 flex-1">
              Cancelar
            </button>
            <button onClick={() => remove.mutate(dialog.goal)} disabled={busy} className="btn h-12 flex-1 border-transparent bg-danger-soft text-danger-text">
              Excluir
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Chance de cumprir no prazo e o que fazer para chegar a 85% (doc. "Metas"). */
function GoalChance({ goal, insight, months, featured }: { goal: Goal; insight: GoalInsights['goals'][number] | undefined; months: number; featured: boolean }) {
  if (!insight || goal.savedMinor >= goal.targetMinor) return null;
  const sub = featured ? 'rgba(255,255,255,.85)' : 'var(--muted-foreground)';
  if (insight.chance === null)
    return (
      <div className="text-xs" style={{ color: sub }}>
        A chance de cumprir aparece com 3 meses de histórico.
      </div>
    );
  const cut = insight.cutCategory ? categoryOf(insight.cutCategory).label.toLowerCase() : null;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl p-2.5" style={{ background: featured ? 'rgba(255,255,255,.12)' : 'var(--muted)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <ProbabilityBadge p={insight.chance} label="de chance no prazo" />
      </div>
      {insight.extraFor85Minor !== null && insight.extraFor85Minor > 0 && (
        <div className="text-[13px] leading-snug">
          Guardando {money(insight.extraFor85Minor)} a mais por mês{cut ? ` (por exemplo, menos em ${cut})` : ''}, a chance sobe para 85%.
        </div>
      )}
      <div className={featured ? '[&_button]:text-white' : ''}>
        <Why>
          Precisa de {money(insight.requiredMonthlyMinor)} por mês em {insight.months} {insight.months === 1 ? 'mês' : 'meses'}. Simulamos 4.000 vezes os
          próximos meses sorteando a sobra (receitas menos despesas) dos seus últimos {months} meses. A sobra vai primeiro para as metas de prioridade mais
          alta, e mês no vermelho não tira dinheiro de meta.
        </Why>
      </div>
    </div>
  );
}
