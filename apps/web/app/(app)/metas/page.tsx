'use client';

import type { Goal } from '@pluto/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { ApiRequestError, api } from '@/lib/api';
import { ymdIn } from '@/lib/datetime';
import { MESES, daysBetween, maskMoney } from '@/lib/format';
import { useEnter } from '@/lib/motion';
import { money, useGoals, useTz } from '@/lib/queries';

const ICONS = ['target', 'plane', 'shield', 'laptop', 'house', 'car', 'heart-pulse', 'briefcase'];

type Dialog = { kind: 'new' } | { kind: 'add'; goal: Goal } | { kind: 'delete'; goal: Goal } | null;

export default function MetasPage() {
  const qc = useQueryClient();
  const tz = useTz();
  const today = ymdIn(new Date(), tz);
  const goals = useGoals();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [amount, setAmount] = useState({ text: '', value: 0 });
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('target');
  const [deadline, setDeadline] = useState(`${+today.slice(0, 4) + 1}-12-31`);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const list = goals.data ?? [];
  const total = list.reduce((t, g) => t + g.savedMinor, 0);
  const isNew = dialog?.kind === 'new';
  const ok = isNew ? amount.value > 0 && !!name.trim() && deadline > today : amount.value > 0;

  const done = () => {
    setDialog(null);
    void qc.invalidateQueries({ queryKey: ['goals'] });
  };
  const fail = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.');
  const create = useMutation({ mutationFn: () => api.createGoal({ name: name.trim(), icon, targetMinor: Math.round(amount.value * 100), deadline }), onSuccess: done, onError: fail });
  const add = useMutation({ mutationFn: (g: Goal) => api.updateGoal(g.id, { addMinor: Math.round(amount.value * 100) }), onSuccess: done, onError: fail });
  const remove = useMutation({ mutationFn: (g: Goal) => api.deleteGoal(g.id), onSuccess: done, onError: fail });

  const open = (d: Dialog) => {
    setError('');
    setAmount({ text: '', value: 0 });
    if (d?.kind === 'new') {
      setName('');
      setIcon('target');
    }
    setDialog(d);
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (!ok || !dialog) return;
    if (dialog.kind === 'new') create.mutate();
    else if (dialog.kind === 'add') add.mutate(dialog.goal);
  };
  const busy = create.isPending || add.isPending || remove.isPending;

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Metas</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            {goals.isPending ? 'Carregando…' : `${list.length} meta${list.length === 1 ? '' : 's'} · ${money(total)} guardados`}
          </p>
        </div>
        <button onClick={() => open({ kind: 'new' })} className="btn btn-primary">
          <Icon icon="plus" size={16} />
          Nova meta
        </button>
      </div>

      {goals.isSuccess && list.length === 0 && (
        <div data-anim="" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <PlutoLogo size={72} />
          <div className="text-[17px] font-semibold">Nenhuma meta ainda</div>
          <div className="max-w-[360px] text-sm text-pretty text-muted-foreground">
            Uma reserva de emergência, uma viagem, um notebook… Crie uma meta e o Planejamento calcula quanto guardar por mês.
          </div>
          <button onClick={() => open({ kind: 'new' })} className="btn btn-primary mt-1">
            <Icon icon="plus" size={16} />
            Criar primeira meta
          </button>
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))' }}>
        {list.map((g, i) => {
          const r = Math.min(g.savedMinor / g.targetMinor, 1), doneGoal = r >= 1, feat = i === 0, left = g.targetMinor - g.savedMinor;
          const months = Math.max(1, Math.ceil(daysBetween(today, g.deadline) / 30.4));
          const late = g.deadline < today && !doneGoal;
          const subFg = feat ? 'rgba(255,255,255,.85)' : 'var(--muted-foreground)';
          return (
            <div
              key={g.id}
              data-anim=""
              className="flex flex-col gap-4 rounded-2xl p-[clamp(18px,4vw,24px)]"
              style={{ background: feat ? '#7D39EB' : 'var(--card)', color: feat ? '#fff' : 'var(--foreground)', border: `1px solid ${feat ? '#7D39EB' : 'var(--border)'}` }}
            >
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-[14px]" style={{ background: feat ? 'rgba(255,255,255,.16)' : 'var(--brand-soft)' }}>
                  <Icon icon={g.icon} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold">{g.name}</div>
                  <div className="mt-0.5 text-xs" style={{ color: subFg }}>
                    até {MESES[+g.deadline.slice(5, 7) - 1]} {g.deadline.slice(0, 4)}
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
                  de {money(g.targetMinor)} · {(r * 100).toFixed(0)}%
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full" style={{ background: feat ? 'rgba(255,255,255,.2)' : 'var(--muted)' }}>
                <div data-grow="" className="h-full origin-left rounded-full transition-[width] duration-[600ms]" style={{ width: `${(r * 100).toFixed(1)}%`, background: feat || doneGoal ? '#C6FF33' : '#7D39EB' }} />
              </div>
              <div className="text-[13px]" style={{ color: late ? (feat ? '#fff' : 'var(--danger-text)') : subFg }}>
                {doneGoal
                  ? 'Meta concluída. Parabéns!'
                  : late
                    ? 'O prazo passou. Ajuste a data ou o valor.'
                    : g.monthlyContributionMinor
                      ? `Plano: ${money(g.monthlyContributionMinor)}/mês · precisa de ${money(Math.ceil(left / months))}/mês`
                      : `Guarde ${money(Math.ceil(left / months))} por mês para chegar lá`}
              </div>
              <button
                onClick={() => open({ kind: 'add', goal: g })}
                className="btn h-[46px]"
                style={{ background: feat ? '#C6FF33' : 'var(--card)', color: feat ? '#000' : 'var(--foreground)', borderColor: feat ? '#C6FF33' : 'var(--border)' }}
              >
                <Icon icon="plus" size={16} />
                Registrar valor guardado
              </button>
            </div>
          );
        })}
      </div>

      {dialog && dialog.kind !== 'delete' && (
        <Sheet onClose={() => setDialog(null)} onSubmit={confirm} label={isNew ? 'Nova meta' : 'Registrar valor guardado'}>
          <div className="text-xl font-bold tracking-[-0.02em]">{isNew ? 'Nova meta' : `Guardar em “${dialog.goal.name}”`}</div>
          {isNew ? (
            <>
              <label className="field">
                Nome da meta
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reserva de emergência" maxLength={80} className="input" autoFocus />
              </label>
              <div className="field">
                Ícone
                <div className="flex flex-wrap gap-1.5">
                  {ICONS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setIcon(ic)}
                      aria-label={`Ícone ${ic}`}
                      aria-pressed={icon === ic}
                      className="grid size-10 cursor-pointer place-items-center rounded-xl border"
                      style={{ background: icon === ic ? 'var(--brand-soft)' : 'var(--card)', borderColor: icon === ic ? 'var(--brand)' : 'var(--border)', color: 'var(--foreground)' }}
                    >
                      <Icon icon={ic} size={18} />
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                Prazo
                <input type="date" value={deadline} min={today} onChange={(e) => setDeadline(e.target.value)} className="input" />
              </label>
            </>
          ) : (
            <div className="text-[13px] text-muted-foreground">Registre o que você já separou para esta meta. O Pluto não movimenta dinheiro.</div>
          )}
          <label className="field">
            {isNew ? 'Quanto você quer juntar?' : 'Quanto você guardou?'}
            <input value={amount.text} onChange={(e) => setAmount(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input h-14 text-2xl font-bold" />
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
              {busy ? 'Salvando…' : isNew ? 'Criar meta' : 'Registrar'}
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
