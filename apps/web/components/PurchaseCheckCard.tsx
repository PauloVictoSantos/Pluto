'use client';

import { GOAL_REASONS, GOAL_REASON_LABEL, MOODS, MOOD_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PurchaseEvaluation, type PurchaseRequest } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { maskMoney } from '@/lib/format';
import { money } from '@/lib/queries';
import { GoalInterview } from './GoalInterview';
import { Icon } from './ui/Icon';
import { Sheet } from './ui/Sheet';

// "Posso comprar?" (doc. Pluton 3.4): o Plutao da APROVAR / ADIAR / RECUSAR com o numero que justifica.
// RECUSAR nao deixa planejar; comprar mesmo assim fica registrado como desvio, com a consequencia.

const VERDICT = {
  aprovar: { label: 'Aprovar', bg: '#C6F432', fg: '#111' },
  adiar: { label: 'Adiar', bg: '#FDE68A', fg: '#111' },
  recusar: { label: 'Recusar', bg: 'var(--danger-soft)', fg: 'var(--danger-text)' },
} as const;
const STATUS: Record<PurchaseEvaluation['status'], string> = {
  simulada: 'Simulação',
  avaliada: 'Avaliada',
  'espera-72h': 'Em espera de 72 h',
  planejada: 'Planejada',
  comprada: 'Comprada',
  desvio: 'Comprada fora do plano',
  desistiu: 'Desistiu',
};

function chips<T extends string>(items: readonly T[], labels: Record<T, string>, value: T, set: (v: T) => void, label: string) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {items.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => set(k)}
          className="h-9 cursor-pointer rounded-full border px-3 text-[12.5px] font-semibold"
          style={{ background: value === k ? 'var(--brand-soft)' : 'var(--card)', borderColor: value === k ? 'var(--brand)' : 'var(--border)', color: 'var(--foreground)' }}
        >
          {labels[k]}
        </button>
      ))}
    </div>
  );
}

export function PurchaseCheckCard() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['purchases'], queryFn: api.purchases });
  const [form, setForm] = useState(false);
  const [shown, setShown] = useState<PurchaseEvaluation | null>(null);
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fail = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : 'Não foi possível continuar.');
  const done = (e: PurchaseEvaluation) => {
    setShown(e);
    setError('');
    for (const k of ['purchases', 'agent-limit', 'goals-plan']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const act = useMutation({
    mutationFn: ({ id, what }: { id: string; what: 'plan' | 'bought' | 'give-up' }) => api.purchaseAction(id, what),
    onSuccess: done,
    onError: fail,
  });
  const [contesting, setContesting] = useState('');
  const [contested, setContested] = useState(false);
  const contest = useMutation({
    mutationFn: (e: PurchaseEvaluation) => api.contest(`Veredito da compra: ${e.description}`, contesting.trim()),
    onSuccess: () => (setContested(true), setContesting(''), void qc.invalidateQueries({ queryKey: ['contestations'] })),
    onError: fail,
  });
  const toGoal = useMutation({ mutationFn: (id: string) => api.purchaseToGoal(id), onSuccess: (d) => (setShown(null), setGoalDraft(d.id)), onError: fail });

  const recent = (list.data ?? []).filter((p) => !['desistiu', 'comprada'].includes(p.status)).slice(0, 4);

  const result = (e: PurchaseEvaluation) => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full px-3 py-1 text-[13px] font-semibold" style={{ background: VERDICT[e.verdict].bg, color: VERDICT[e.verdict].fg }}>
          {VERDICT[e.verdict].label}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {e.description} · {money(e.priceMinor)} · {STATUS[e.status]}
        </span>
      </div>
      <div className="text-[15px] font-semibold leading-snug">{e.headline}</div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-snug">
        {e.explanation.map((l) => (
          <li key={l} className="flex gap-2">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
            {l}
          </li>
        ))}
      </ul>
      {e.holdUntil && e.status === 'espera-72h' && !e.canPlan && (
        <div className="rounded-xl bg-muted p-2.5 text-[12.5px]">Reavaliação liberada em {new Date(e.holdUntil).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.</div>
      )}
      {e.consequence && (
        <div role="status" className="flex flex-col gap-1 rounded-xl bg-danger-soft p-3 text-[13px] text-danger-text">
          {e.consequence.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      )}
      {e.id && e.verdict !== 'aprovar' && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          {contested ? (
            <span className="text-[12.5px] text-muted-foreground">Contestação registrada para revisão.</span>
          ) : (
            <>
              <label className="text-[12.5px] font-semibold" htmlFor="contest">
                Discorda do veredito? Conte por quê
              </label>
              <div className="flex gap-2">
                <input id="contest" value={contesting} onChange={(x) => setContesting(x.target.value)} maxLength={1000} className="input h-10 flex-1" />
                <button onClick={() => contest.mutate(e)} disabled={!contesting.trim() || contest.isPending} className="btn btn-outline h-10 px-3 text-[13px]">
                  Contestar
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {e.id && !['comprada', 'desvio', 'desistiu'].includes(e.status) && (
        <div className="flex flex-wrap gap-2">
          {e.canPlan && (
            <button onClick={() => act.mutate({ id: e.id!, what: 'plan' })} disabled={act.isPending} className="btn btn-primary h-10 px-4 text-[13px]">
              {e.status === 'espera-72h' ? 'Reavaliar e planejar' : 'Planejar compra'}
            </button>
          )}
          {e.verdict === 'recusar' && (
            <button onClick={() => toGoal.mutate(e.id!)} disabled={toGoal.isPending} className="btn btn-primary h-10 px-4 text-[13px]">
              Transformar em meta
            </button>
          )}
          <button onClick={() => act.mutate({ id: e.id!, what: 'bought' })} disabled={act.isPending} className="btn btn-outline h-10 px-3 text-[13px]">
            {e.status === 'planejada' ? 'Já comprei' : 'Comprei mesmo assim'}
          </button>
          <button onClick={() => act.mutate({ id: e.id!, what: 'give-up' })} disabled={act.isPending} className="btn btn-outline h-10 px-3 text-[13px]">
            Desisti
          </button>
        </div>
      )}
    </div>
  );

  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Posso comprar?">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="card-title">Posso comprar?</div>
          <div className="mt-1 text-[13px] text-muted-foreground">Conte o que quer comprar. O Plutão cruza com seu limite, metas, reserva e dívidas e dá o veredito com o número.</div>
        </div>
        <button onClick={() => (setForm(true), setShown(null), setError(''))} className="btn btn-primary h-10 px-3 text-[13px]">
          <Icon icon="sparkles" size={14} />
          Avaliar compra
        </button>
      </div>
      {recent.map((p) => (
        <button key={p.id} onClick={() => (setShown(p), setContested(false))} className="flex cursor-pointer items-center gap-3 border-0 border-t border-solid border-border bg-transparent py-2.5 text-left text-foreground">
          <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold" style={{ background: VERDICT[p.verdict].bg, color: VERDICT[p.verdict].fg }}>
            {VERDICT[p.verdict].label}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.description}</span>
          <span className="text-[12px] text-muted-foreground">{STATUS[p.status]}</span>
          <span className="text-[13px] font-semibold tabular-nums">{money(p.priceMinor)}</span>
        </button>
      ))}

      {form && <PurchaseForm onClose={() => setForm(false)} onResult={(e) => (setForm(false), done(e))} />}
      {shown && !form && (
        <Sheet onClose={() => setShown(null)} label="Veredito da compra" width={460} closeButton>
          {result(shown)}
          {error && <div className="text-[13px] text-danger-text">{error}</div>}
        </Sheet>
      )}
      {goalDraft && (
        <GoalInterview
          draftId={goalDraft}
          onClose={() => {
            setGoalDraft(null);
            for (const k of ['goals', 'goal-drafts', 'goals-plan', 'agent-limit']) void qc.invalidateQueries({ queryKey: [k] });
          }}
        />
      )}
    </section>
  );
}

function PurchaseForm({ onClose, onResult }: { onClose: () => void; onResult: (e: PurchaseEvaluation) => void }) {
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState({ text: '', value: 0 });
  const [payment, setPayment] = useState<PurchaseRequest['payment']>('cash');
  const [installments, setInstallments] = useState('');
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState<PurchaseRequest['reason']>('desejo');
  const [urgency, setUrgency] = useState(3);
  const [mood, setMood] = useState<PurchaseRequest['mood']>('calmo');
  const [error, setError] = useState('');
  const n = installments ? Math.round(+installments) : null;
  const r = rate.trim() ? Number(rate.replace(',', '.')) / 100 : null;
  const ok = !!description.trim() && price.value > 0 && (payment === 'cash' || payment === 'card' || (n !== null && n >= 2)) && (payment !== 'financed' || r !== null);
  const body = (): PurchaseRequest => ({
    description: description.trim(),
    priceMinor: Math.round(price.value * 100),
    payment,
    installments: payment === 'cash' ? null : n,
    monthlyRate: payment === 'financed' || payment === 'card' ? r : null,
    reason,
    urgency,
    mood,
  });
  const evaluate = useMutation({ mutationFn: () => api.evaluatePurchase(body()), onSuccess: onResult, onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não foi possível avaliar.') });

  return (
    <Sheet
      onClose={onClose}
      label="Avaliar compra"
      closeButton
      width={480}
      top="10vh"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) evaluate.mutate();
      }}
    >
      <div className="text-xl font-bold tracking-[-0.02em]">Posso comprar?</div>
      <label className="field">
        O que você quer comprar?
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Tênis de corrida" maxLength={80} className="input" autoFocus />
      </label>
      <label className="field">
        Valor
        <input value={price.text} onChange={(e) => setPrice(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input h-12 text-lg font-bold" />
      </label>
      <div className="field">
        Como vai pagar?
        {chips(PAYMENT_METHODS, PAYMENT_METHOD_LABEL, payment, setPayment, 'Forma de pagamento')}
      </div>
      {payment !== 'cash' && (
        <div className="flex gap-2.5">
          <label className="field flex-1">
            Parcelas
            <input type="number" min={2} max={120} value={installments} onChange={(e) => setInstallments(e.target.value)} placeholder={payment === 'card' ? 'à vista no cartão' : 'nº'} className="input" />
          </label>
          {(payment === 'financed' || payment === 'card') && (
            <label className="field flex-1">
              Juros ao mês (%)
              <input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d,.]/g, '').slice(0, 5))} inputMode="decimal" placeholder={payment === 'card' ? '0 se sem juros' : 'Ex.: 2,5'} className="input" />
            </label>
          )}
        </div>
      )}
      <div className="field">
        Para que é?
        {chips(GOAL_REASONS, GOAL_REASON_LABEL, reason, setReason, 'Motivo')}
      </div>
      <div className="field">
        Quão urgente? (1 a 5)
        {chips(['1', '2', '3', '4', '5'] as const, { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }, String(urgency) as '1', (v) => setUrgency(+v), 'Urgência')}
      </div>
      <div className="field">
        Como você está agora?
        {chips(MOODS, MOOD_LABEL, mood, setMood, 'Como você está')}
      </div>
      {error && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}
      <button type="submit" disabled={!ok || evaluate.isPending} className="btn btn-primary h-[50px] text-[15px]" style={{ opacity: ok ? 1 : 0.5 }}>
        {evaluate.isPending ? 'Avaliando…' : 'Ver veredito'}
      </button>
    </Sheet>
  );
}
