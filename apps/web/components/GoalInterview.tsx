'use client';

import {
  GOAL_KINDS,
  GOAL_KIND_LABEL,
  GOAL_REASONS,
  GOAL_REASON_LABEL,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type GoalAnswers,
  type GoalDraft,
  type GoalKindV2,
  type GoalScenario,
} from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { maskMoney } from '@/lib/format';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';
import { Sheet } from './ui/Sheet';

// Nova meta com o Plutao (doc. Pluton 4): intencao -> entrevista (1 ou 2 perguntas por vez) ->
// diagnostico -> proposta com ate 3 cenarios -> confirmacao ou descarte com motivo. Todo numero vem
// do servidor; aqui so se pergunta e mostra.

const KIND_ICON: Record<GoalKindV2, string> = { purchase: 'laptop', fixed: 'shield', debt_payoff: 'landmark', experience: 'plane' };
const VERDICT = {
  aprovar: { label: 'Aprovada', bg: '#C6F432', fg: '#111' },
  adiar: { label: 'Melhor adiar', bg: '#FDE68A', fg: '#111' },
  recusar: { label: 'Não cabe agora', bg: 'var(--danger-soft)', fg: 'var(--danger-text)' },
} as const;

type Raw = Record<string, string>;

/** Converte o que foi digitado no formato da API; undefined = ainda nao respondido. */
function parse(input: string, raw: string | undefined): unknown {
  if (raw === undefined || raw === '') return undefined;
  switch (input) {
    case 'money':
      return Math.round(maskMoney(raw).value * 100);
    case 'bool':
      return raw === 'sim';
    case 'urgency':
    case 'int':
      return Math.round(Number(raw));
    case 'percent':
    case 'rate':
      return Math.round((Number(raw.replace(',', '.')) / 100) * 1e6) / 1e6;
    default:
      return raw.trim() || undefined;
  }
}

export function GoalInterview({ draftId, onClose }: { draftId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [id, setId] = useState(draftId);
  const q = useQuery({ queryKey: ['goal-draft', id], queryFn: () => api.goalDraft(id!), enabled: !!id });
  const loans = useQuery({ queryKey: ['loans'], queryFn: api.loans });
  const [kind, setKind] = useState<GoalKindV2>('purchase');
  const [title, setTitle] = useState('');
  const [raw, setRaw] = useState<Raw>({});
  const [scenario, setScenario] = useState<GoalScenario['key'] | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  // Data alvo: a partir de amanha.
  const [minDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const fail = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : 'Não foi possível continuar. Tente de novo.');
  const put = (d: GoalDraft) => {
    qc.setQueryData(['goal-draft', d.id], d);
    setError('');
    setRaw({});
  };

  const create = useMutation({
    mutationFn: () => api.createGoalDraft(kind, title.trim()),
    onSuccess: (d) => {
      put(d);
      setId(d.id);
    },
    onError: fail,
  });
  const answer = useMutation({ mutationFn: (a: GoalAnswers) => api.answerGoalDraft(id!, a), onSuccess: put, onError: fail });
  const diagnose = useMutation({ mutationFn: () => api.diagnoseGoalDraft(id!), onSuccess: (d) => (put(d), setScenario(d.diagnosis?.scenarios[0]?.key ?? null)), onError: fail });
  const confirm = useMutation({ mutationFn: () => api.confirmGoalDraft(id!, scenario!), onSuccess: onClose, onError: fail });
  const discard = useMutation({ mutationFn: () => api.discardGoalDraft(id!, reason.trim()), onSuccess: onClose, onError: fail });
  const busy = create.isPending || answer.isPending || diagnose.isPending || confirm.isPending || discard.isPending;

  const d = id ? q.data : null;
  const dx = d?.diagnosis ?? null;

  const field = (f: GoalDraft['next'][number]) => {
    const v = raw[f.field] ?? '';
    const set = (x: string) => setRaw((r) => ({ ...r, [f.field]: x }));
    const chips = (items: [string, string][]) => (
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={f.question}>
        {items.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={v === k}
            onClick={() => set(k)}
            className="h-10 cursor-pointer rounded-full border px-3.5 text-[13px] font-semibold"
            style={{ background: v === k ? 'var(--brand-soft)' : 'var(--card)', borderColor: v === k ? 'var(--brand)' : 'var(--border)', color: 'var(--foreground)' }}
          >
            {label}
          </button>
        ))}
      </div>
    );
    let control;
    if (f.input === 'money') control = <input value={maskMoney(v).text} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="R$ 0,00" className="input h-12 text-lg font-bold" />;
    else if (f.input === 'bool') control = chips([['sim', 'Sim'], ['nao', 'Não']]);
    else if (f.input === 'urgency') control = chips(['1', '2', '3', '4', '5'].map((n) => [n, n]));
    else if (f.input === 'reason') control = chips(GOAL_REASONS.map((r) => [r, GOAL_REASON_LABEL[r]]));
    else if (f.input === 'payment') control = chips(PAYMENT_METHODS.map((p) => [p, PAYMENT_METHOD_LABEL[p]]));
    else if (f.input === 'date') control = <input type="date" value={v} min={minDate} onChange={(e) => set(e.target.value)} className="input" />;
    else if (f.input === 'int') control = <input type="number" min={1} value={v} onChange={(e) => set(e.target.value)} className="input" />;
    else if (f.input === 'percent' || f.input === 'rate')
      control = (
        <div className="flex items-center gap-2">
          <input value={v} onChange={(e) => set(e.target.value.replace(/[^\d,.]/g, '').slice(0, 5))} inputMode="decimal" placeholder={f.input === 'percent' ? '0' : 'Ex.: 2,5'} className="input flex-1" />
          <span className="text-[13px] text-muted-foreground">{f.input === 'percent' ? '%' : '% ao mês'}</span>
        </div>
      );
    else if (f.input === 'loan')
      control = (
        <select value={v} onChange={(e) => set(e.target.value)} className="input">
          <option value="">Escolha a dívida</option>
          {loans.data?.items
            .filter((l) => l.balanceMinor > 0)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.creditor} · {money(l.balanceMinor)}
              </option>
            ))}
        </select>
      );
    else control = <input value={v} onChange={(e) => set(e.target.value)} maxLength={f.field === 'alternative' ? 200 : 80} className="input" />;
    return (
      <div key={f.field} className="field">
        <span className="text-[15px] font-semibold">{f.question}</span>
        <span className="-mt-1 text-[12px] font-normal text-muted-foreground">{f.why}</span>
        {control}
        {f.input === 'loan' && loans.data && !loans.data.items.length && <span className="text-[12.5px] text-muted-foreground">Cadastre a dívida em Contas a pagar › Dívidas com juros.</span>}
      </div>
    );
  };

  const nextAnswers = () => Object.fromEntries((d?.next ?? []).map((f) => [f.field, parse(f.input, raw[f.field])]).filter(([, v]) => v !== undefined)) as GoalAnswers;
  const canAnswer = !!d && d.next.length > 0 && d.next.every((f) => parse(f.input, raw[f.field]) !== undefined);

  return (
    <Sheet onClose={onClose} label="Nova meta com o Plutão" width={480} top="10vh">
      <div className="flex items-center gap-2 text-xl font-bold tracking-[-0.02em]">
        <Icon icon="sparkles" size={18} />
        {d ? d.title : 'Nova meta'}
      </div>

      {!id && (
        <>
          <div className="text-[13px] text-muted-foreground">O Plutão faz algumas perguntas, calcula se cabe no seu mês e propõe um plano. Nada é criado sem a sua confirmação.</div>
          <div className="grid grid-cols-2 gap-2">
            {GOAL_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className="flex cursor-pointer flex-col items-start gap-2 rounded-xl border p-3 text-left text-[13px] font-semibold"
                style={{ background: kind === k ? 'var(--brand-soft)' : 'var(--card)', borderColor: kind === k ? 'var(--brand)' : 'var(--border)', color: 'var(--foreground)' }}
              >
                <Icon icon={KIND_ICON[k]} size={18} />
                {GOAL_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="field">
            O que você quer?
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Computador para trabalhar" maxLength={80} className="input" autoFocus />
          </label>
          <button onClick={() => create.mutate()} disabled={!title.trim() || busy} className="btn btn-primary h-[50px] text-[15px]">
            Começar
          </button>
        </>
      )}

      {id && !d && <div className="h-40 animate-pulse rounded-xl bg-muted" />}

      {d && !dx && (
        <>
          {d.next.length > 0 ? (
            <>
              <div className="text-[12.5px] text-muted-foreground">
                {d.missing.length} pergunta{d.missing.length === 1 ? '' : 's'} para o diagnóstico
              </div>
              {d.next.map(field)}
              <button onClick={() => answer.mutate(nextAnswers())} disabled={!canAnswer || busy} className="btn btn-primary h-[50px] text-[15px]">
                {answer.isPending ? 'Salvando…' : 'Continuar'}
              </button>
            </>
          ) : (
            <>
              <div className="text-[14px]">Entrevista completa. O Plutão vai cruzar a meta com sua renda, fixos, dívidas, reserva e outras metas.</div>
              <button onClick={() => diagnose.mutate()} disabled={busy} className="btn btn-primary h-[50px] text-[15px]">
                {diagnose.isPending ? 'Calculando…' : 'Ver diagnóstico'}
              </button>
            </>
          )}
        </>
      )}

      {d && dx && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-3 py-1 text-[13px] font-semibold" style={{ background: VERDICT[dx.verdict].bg, color: VERDICT[dx.verdict].fg }}>
              {VERDICT[dx.verdict].label}
            </span>
            <span className="text-[13px] text-muted-foreground">Prioridade {Math.round(dx.score * 100)}/100</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[12px] text-muted-foreground">
            <div>
              Precisa por mês
              <div className="text-[15px] font-bold text-foreground tabular-nums">{money(dx.requiredMonthlyMinor)}</div>
            </div>
            <div>
              Livre no mês
              <div className="text-[15px] font-bold text-foreground tabular-nums">{money(dx.freeMinor)}</div>
            </div>
            <div>
              Meta
              <div className="text-[15px] font-bold text-foreground tabular-nums">{money(dx.targetMinor)}</div>
            </div>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-snug">
            {dx.rationale.map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                {r}
              </li>
            ))}
          </ul>

          {dx.scenarios.length > 0 && (
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Cenários">
              <div className="text-[14px] font-semibold">Escolha um plano</div>
              {dx.scenarios.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="radio"
                  aria-checked={scenario === s.key}
                  onClick={() => setScenario(s.key)}
                  className="flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left"
                  style={{ background: scenario === s.key ? 'var(--brand-soft)' : 'var(--card)', borderColor: scenario === s.key ? 'var(--brand)' : 'var(--border)', color: 'var(--foreground)' }}
                >
                  <span className="flex justify-between gap-2 text-[14px] font-semibold">
                    {s.label}
                    <span className="tabular-nums">{money(s.monthlyMinor)}/mês</span>
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {money(s.targetMinor)} até {s.targetDate.split('-').reverse().join('/')}. {s.note}
                  </span>
                </button>
              ))}
            </div>
          )}

          {discarding ? (
            <div className="flex flex-col gap-2">
              <label className="field">
                Por que descartar? (fica registrado)
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="input" autoFocus />
              </label>
              <div className="flex gap-2.5">
                <button type="button" onClick={() => setDiscarding(false)} className="btn btn-outline h-12 flex-1">
                  Voltar
                </button>
                <button type="button" onClick={() => discard.mutate()} disabled={!reason.trim() || busy} className="btn h-12 flex-1 border-transparent bg-danger-soft text-danger-text">
                  Descartar meta
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setDiscarding(true)} className="btn btn-outline h-[50px] flex-1 text-[15px]">
                Descartar
              </button>
              {dx.scenarios.length > 0 && (
                <button type="button" onClick={() => confirm.mutate()} disabled={!scenario || busy} className="btn btn-primary h-[50px] flex-1 text-[15px]">
                  {confirm.isPending ? 'Criando…' : 'Confirmar meta'}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}
    </Sheet>
  );
}
