'use client';

import { useRef, useState } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { useShell } from '@/components/shell/ShellContext';
import { StatTiles, tileBrand, tilePlain } from '@/components/StatTiles';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { daysBetween, fmt, fmtDay, fmtDayFull } from '@/lib/format';
import { MOCK, TODAY } from '@/lib/mock/data';
import { BILL_STATUS } from '@/lib/mock/vm';
import { useEnter } from '@/lib/motion';

const DOT = { PAID: '#7DBF00', OPEN: '#7D39EB', OVERDUE: '#EF4444' };
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export default function ContasPage() {
  const { mode } = useShell();
  const [paid, setPaid] = useState<Record<string, boolean>>({});
  const [day, setDay] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const all = MOCK.bills.map((b) => ({ ...b, status: paid[b.id] ? ('PAID' as const) : b.status }));
  const offset = new Date(2026, 9, 1).getDay();
  const days = Array.from({ length: 31 }, (_, i) => {
    const d = i + 1, iso = `2026-10-${String(d).padStart(2, '0')}`;
    return { d, iso, bills: all.filter((b) => b.dueDate === iso), sel: day === iso, today: iso === TODAY };
  });

  const list = all.filter((b) => !day || b.dueDate === day).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const open = all.filter((b) => b.status !== 'PAID'), done = all.filter((b) => b.status === 'PAID'), overdue = all.filter((b) => b.status === 'OVERDUE');
  const pb = all.find((b) => b.id === paying);

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-col gap-1">
        <h1 className="page-title">Calendário de contas</h1>
        <p className="m-0 text-sm text-muted-foreground">Outubro 2026</p>
      </div>

      <StatTiles
        tiles={[
          { label: 'A pagar', value: fmt(open.reduce((t, b) => t + b.amount, 0)), ...tileBrand },
          { label: 'Pagas', value: fmt(done.reduce((t, b) => t + b.amount, 0)), ...tilePlain },
          {
            label: 'Atrasadas',
            value: String(overdue.length),
            bg: overdue.length ? 'var(--danger-soft)' : 'var(--card)',
            fg: overdue.length ? 'var(--danger-text)' : 'var(--foreground)',
            border: overdue.length ? 'transparent' : 'var(--border)',
          },
        ]}
      />

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,5fr) minmax(0,7fr)' : 'minmax(0,1fr)' }}>
        <div data-anim="" className="card flex flex-col gap-3 p-[clamp(14px,4vw,24px)]">
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: offset }, (_, i) => (
              <span key={`e${i}`} />
            ))}
            {days.map((c) => (
              <button
                key={c.iso}
                onClick={() => setDay(c.sel ? null : c.iso)}
                aria-label={`${c.d} de outubro${c.bills.length ? `, ${c.bills.length} conta(s)` : ''}`}
                aria-pressed={c.sel}
                className="flex h-[52px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl p-0 text-sm"
                style={{
                  border: c.today && !c.sel ? '2px solid #7D39EB' : 0,
                  background: c.sel ? 'var(--primary)' : c.bills.length ? 'var(--muted)' : 'transparent',
                  color: c.sel ? 'var(--primary-foreground)' : 'var(--foreground)',
                  fontWeight: c.today || c.bills.length ? 700 : 500,
                }}
              >
                {c.d}
                <span className="flex h-1.5 gap-[3px]">
                  {c.bills.map((b) => (
                    <span key={b.id} className="size-1.5 rounded-full" style={{ background: c.sel ? '#C6FF33' : DOT[b.status] }} />
                  ))}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3.5 pt-1 text-xs text-muted-foreground">
            {[
              [DOT.PAID, 'Paga'],
              [DOT.OPEN, 'A vencer'],
              [DOT.OVERDUE, 'Atrasada'],
            ].map(([c, l]) => (
              <span key={l} className="flex items-center gap-[5px]">
                <span className="size-[7px] rounded-full" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
        </div>

        <div data-anim="" className="card flex flex-col gap-1">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="card-title">{day ? `Contas de ${fmtDay(day)}` : 'Todas as contas'}</span>
            {day && (
              <button onClick={() => setDay(null)} className="btn btn-outline h-9 px-3 text-[13px]">
                Ver todas
              </button>
            )}
          </div>
          {list.map((b) => {
            const st = BILL_STATUS[b.status]!, diff = daysBetween(TODAY, b.dueDate);
            const when =
              b.status === 'PAID'
                ? `Paga · ${fmtDay(b.dueDate)}`
                : b.status === 'OVERDUE'
                  ? `Venceu há ${-diff} dias`
                  : diff === 0
                    ? 'Vence hoje'
                    : `Vence em ${diff} dia${diff > 1 ? 's' : ''} · ${fmtDay(b.dueDate)}`;
            return (
              <div key={b.id} className="flex min-h-[68px] flex-wrap items-center gap-3 border-t border-border py-2">
                <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-muted">
                  <Icon icon={b.icon} size={18} />
                </span>
                <div className="min-w-[120px] flex-1">
                  <div className="text-[15px] font-semibold">{b.description}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {when} · {b.category}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-2.5">
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[15px] font-semibold tabular-nums">{fmt(b.amount)}</span>
                    <span className="badge" style={{ background: st.bg, color: st.fg, borderColor: st.border }}>
                      {st.label}
                    </span>
                  </div>
                  {b.status !== 'PAID' && (
                    <button onClick={() => setPaying(b.id)} className="btn btn-primary h-10 px-4 text-[13px]">
                      Pagar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {list.length === 0 && (
            <div className="flex flex-col items-center gap-2.5 border-t border-border px-3 py-7 text-center">
              <PlutoLogo size={56} />
              <div className="text-[15px] font-semibold">Nenhuma conta neste dia</div>
              <div className="text-[13px] text-muted-foreground">Dia livre. A Pluto avisa quando algo vencer.</div>
            </div>
          )}
        </div>
      </div>

      {pb && (
        <Sheet onClose={() => setPaying(null)} label={`Pagar ${pb.description}`} top="22vh">
          <div className="text-xl font-bold tracking-[-0.02em]">Pagar {pb.description}</div>
          <div className="flex flex-col gap-2 rounded-[14px] bg-muted px-4 py-3.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valor</span>
              <strong>{fmt(pb.amount)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vencimento</span>
              <strong>{fmtDayFull(pb.dueDate)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pagar com</span>
              <strong>Conta Nubank</strong>
            </div>
          </div>
          <div className="flex gap-2.5">
            <button onClick={() => setPaying(null)} className="btn btn-outline h-[50px] flex-1 text-[15px]">
              Cancelar
            </button>
            <button
              onClick={() => {
                setPaid((p) => ({ ...p, [pb.id]: true }));
                setPaying(null);
              }}
              className="btn btn-primary h-[50px] flex-1 text-[15px]"
            >
              Confirmar
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
