'use client';

import type { ObligationItem } from '@pluto/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';

// Dividas do mes (doc. Melhorias, passo 5): a mesma lista que o Plutao usa no chat, aqui em Metas e
// no Planejamento. Faturas + parcelamentos + gastos fixos + emprestimos.

const KINDS: { kind: ObligationItem['kind']; label: string; icon: string }[] = [
  { kind: 'fatura', label: 'Faturas de cartão', icon: 'credit-card' },
  { kind: 'parcelamento', label: 'Parcelamentos', icon: 'calendar-days' },
  { kind: 'fixo', label: 'Gastos fixos', icon: 'repeat' },
  { kind: 'emprestimo', label: 'Empréstimos', icon: 'landmark' },
];

const due = (i: ObligationItem) => (i.dueDate ? `vence ${i.dueDate.slice(8)}/${i.dueDate.slice(5, 7)}` : i.dueDay ? `dia ${i.dueDay}` : '');

export function ObligationsCard() {
  const q = useQuery({ queryKey: ['obligations'], queryFn: api.obligations, refetchOnMount: 'always' });
  const [open, setOpen] = useState(false);
  const o = q.data;
  if (!o) return null;
  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Dívidas do mês">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="card-title">Dívidas do mês</div>
          <div className="mt-1 text-[13px] text-pretty text-muted-foreground">Faturas, parcelamentos, gastos fixos e empréstimos. É a mesma conta que o Plutão usa.</div>
        </div>
        <div className="shrink-0 text-right text-[20px] font-bold tracking-[-0.03em] tabular-nums">{money(o.monthTotalMinor)}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {KINDS.map((k) => (
          <div key={k.kind} className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-muted px-3 py-2">
            <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Icon icon={k.icon} size={13} />
              {k.label}
            </span>
            <span className="text-[14px] font-semibold tabular-nums">{money(o.byKind[k.kind])}</span>
          </div>
        ))}
      </div>
      {o.items.length > 0 && (
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-9 cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
          {open ? 'Esconder itens' : o.items.length === 1 ? 'Ver 1 item' : `Ver os ${o.items.length} itens`}
          <Icon icon={open ? 'chevron-up' : 'chevron-down'} size={15} />
        </button>
      )}
      {open && (
        <ul className="m-0 flex list-none flex-col p-0">
          {o.items.map((i, n) => (
            <li key={n} className="flex items-center gap-3 border-t border-border py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{i.name}</span>
                <span className="block text-[12px] text-muted-foreground">
                  {[KINDS.find((k) => k.kind === i.kind)?.label, due(i), i.remainingInstallments ? `faltam ${i.remainingInstallments} parcelas` : '', i.inInvoice ? 'já está na fatura' : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right text-[14px] tabular-nums" style={{ color: i.overdue ? 'var(--danger-text)' : undefined, opacity: i.inInvoice ? 0.6 : 1 }}>
                {money(i.monthMinor)}
                {i.overdue && <span className="block text-[11px]">vencida</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
