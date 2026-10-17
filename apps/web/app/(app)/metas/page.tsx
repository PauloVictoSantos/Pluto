'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { MESES, daysBetween, fmt, maskMoney } from '@/lib/format';
import { MOCK, TODAY, type Goal } from '@/lib/mock/data';
import { useEnter } from '@/lib/motion';

const monthsTo = (iso: string) => Math.max(1, Math.round(daysBetween(TODAY, iso) / 30.4));

export default function MetasPage() {
  const [goals, setGoals] = useState<Goal[]>(() => MOCK.goals.map((g) => ({ ...g })));
  const [dialog, setDialog] = useState<string | null>(null);
  const [amount, setAmount] = useState({ text: '', value: 0 });
  const [name, setName] = useState('');
  const [deadline, setDeadline] = useState('2027-12-31');
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const isNew = dialog === 'new', ok = amount.value > 0 && (!isNew || !!name.trim());
  const total = goals.reduce((t, g) => t + g.saved, 0);
  const current = goals.find((g) => g.id === dialog);

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    if (isNew)
      setGoals((p) => [...p, { id: 'g' + Date.now(), name: name.trim(), icon: 'target', target: amount.value, saved: 0, deadline: deadline || '2027-12-31' }]);
    else setGoals((p) => p.map((g) => (g.id === dialog ? { ...g, saved: g.saved + amount.value } : g)));
    setDialog(null);
  };

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Metas</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            {goals.length} metas · {fmt(total)} guardados
          </p>
        </div>
        <button
          onClick={() => {
            setDialog('new');
            setAmount({ text: '', value: 0 });
            setName('');
          }}
          className="btn btn-primary"
        >
          <Icon icon="plus" size={16} />
          Nova meta
        </button>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))' }}>
        {goals.map((g, i) => {
          const r = Math.min(g.saved / g.target, 1), doneGoal = r >= 1, feat = i === 0, left = g.target - g.saved;
          const [y, m] = g.deadline.split('-');
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
                <div className="min-w-0">
                  <div className="text-base font-semibold">{g.name}</div>
                  <div className="mt-0.5 text-xs" style={{ color: subFg }}>
                    até {MESES[+m! - 1]} {y}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[28px] font-bold tracking-[-0.04em] tabular-nums">{fmt(g.saved)}</div>
                <div className="mt-0.5 text-[13px]" style={{ color: subFg }}>
                  de {fmt(g.target)} · {(r * 100).toFixed(0)}%
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full" style={{ background: feat ? 'rgba(255,255,255,.2)' : 'var(--muted)' }}>
                <div
                  data-grow=""
                  className="h-full origin-left rounded-full transition-[width] duration-[600ms]"
                  style={{ width: `${(r * 100).toFixed(1)}%`, background: feat || doneGoal ? '#C6FF33' : '#7D39EB' }}
                />
              </div>
              <div className="text-[13px]" style={{ color: subFg }}>
                {doneGoal ? 'Meta concluída. Parabéns!' : `Guarde ${fmt(left / monthsTo(g.deadline))} por mês para chegar lá`}
              </div>
              <button
                onClick={() => {
                  setDialog(g.id);
                  setAmount({ text: '', value: 0 });
                }}
                className="btn h-[46px]"
                style={{ background: feat ? '#C6FF33' : 'var(--card)', color: feat ? '#000' : 'var(--foreground)', borderColor: feat ? '#C6FF33' : 'var(--border)' }}
              >
                <Icon icon="plus" size={16} />
                Guardar dinheiro
              </button>
            </div>
          );
        })}
      </div>

      {dialog && (
        <Sheet onClose={() => setDialog(null)} onSubmit={confirm} label={isNew ? 'Nova meta' : 'Guardar dinheiro'}>
          <div className="text-xl font-bold tracking-[-0.02em]">{isNew ? 'Nova meta' : `Guardar em “${current?.name}”`}</div>
          {isNew && (
            <>
              <label className="field">
                Nome da meta
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Carro novo" className="input" />
              </label>
              <label className="field">
                Prazo
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input" />
              </label>
            </>
          )}
          <label className="field">
            {isNew ? 'Quanto você quer juntar?' : 'Quanto guardar agora?'}
            <input
              value={amount.text}
              onChange={(e) => setAmount(maskMoney(e.target.value))}
              inputMode="numeric"
              placeholder="R$ 0,00"
              className="input h-14 text-2xl font-bold"
            />
          </label>
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setDialog(null)} className="btn btn-outline h-[50px] flex-1 text-[15px]">
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary h-[50px] flex-1 text-[15px]" style={{ opacity: ok ? 1 : 0.5 }}>
              {isNew ? 'Criar meta' : 'Guardar'}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
