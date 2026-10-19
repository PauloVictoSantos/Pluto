'use client';

import { useRef, useState } from 'react';
import { BankLogo } from '@/components/BankLogo';
import { CommitmentsCard } from '@/components/CommitmentsCard';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { useShell } from '@/components/shell/ShellContext';
import { StatTiles, tileBrand, tilePlain } from '@/components/StatTiles';
import { Icon } from '@/components/ui/Icon';
import { bankBrand } from '@/lib/banks';
import { ymdIn } from '@/lib/datetime';
import { daysBetween, fmtDay } from '@/lib/format';
import { nextDue } from '@/lib/insights';
import { useEnter } from '@/lib/motion';
import { addMonth, monthLong, money, useCards, useCurrentMonth, useInvoices, useTz } from '@/lib/queries';

// Faturas de cartao (secao 4.3: invoices) + fatura em andamento de cada cartao. O Pluto
// informa vencimentos e nao executa pagamentos (secao 1.2).

type Kind = 'PAID' | 'OPEN' | 'OVERDUE' | 'CLOSED';
const STYLE: Record<Kind, { label: string; dot: string; bg: string; fg: string; border: string }> = {
  PAID: { label: 'Paga', dot: '#7DBF00', bg: '#C6FF33', fg: '#000', border: 'transparent' },
  OPEN: { label: 'A vencer', dot: '#7D39EB', bg: 'transparent', fg: 'var(--foreground)', border: 'var(--border)' },
  OVERDUE: { label: 'Não paga', dot: '#EF4444', bg: 'var(--danger-soft)', fg: 'var(--danger-text)', border: 'transparent' },
  CLOSED: { label: 'Fechada', dot: '#A1A1AA', bg: 'var(--muted)', fg: 'var(--muted-foreground)', border: 'transparent' },
};
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

interface Bill {
  id: string;
  name: string;
  sub: string;
  bank: string;
  date: string;
  amount: number;
  kind: Kind;
}

export default function ContasPage() {
  const { mode } = useShell();
  const tz = useTz();
  const current = useCurrentMonth();
  const today = ymdIn(new Date(), tz);
  const [month, setMonth] = useState(current);
  const [day, setDay] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  // Faturas com vencimento no mes (datas so-dia, gravadas a meia-noite UTC).
  const from = new Date(`${month}-01T00:00:00Z`), to = new Date(`${addMonth(month, 1)}-01T00:00:00Z`);
  const invoices = useInvoices(from, to);
  const cards = useCards();

  const bills: Bill[] = (invoices.data ?? []).map((i) => ({
    id: i.id,
    name: i.cardName,
    sub: bankBrand(i.institutionName).label,
    bank: i.institutionName,
    date: i.dueDate.toISOString().slice(0, 10),
    amount: i.totalMinor,
    kind: (i.status === 'PAID' ? 'PAID' : i.status === 'OVERDUE' ? 'OVERDUE' : i.status === 'OPEN' ? 'OPEN' : 'CLOSED') as Kind,
  }));
  // Fatura em andamento: ainda nao fechada no Pluggy, vence no proximo dia de vencimento do cartao.
  for (const c of cards.data ?? []) {
    if (!c.dueDay || c.currentBillMinor <= 0) continue;
    const date = nextDue(c.dueDay, today);
    if (date.slice(0, 7) !== month || bills.some((b) => b.name === c.name && b.date === date)) continue;
    bills.push({ id: `cur-${c.id}`, name: c.name, sub: `${bankBrand(c.institutionName).label} · fatura atual`, bank: c.institutionName, date, amount: c.currentBillMinor, kind: 'OPEN' });
  }
  bills.sort((a, b) => a.date.localeCompare(b.date));

  const y = +month.slice(0, 4), m = +month.slice(5);
  const offset = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: nDays }, (_, i) => {
    const iso = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { d: i + 1, iso, bills: bills.filter((b) => b.date === iso), sel: day === iso, today: iso === today };
  });

  const list = bills.filter((b) => !day || b.date === day);
  const open = bills.filter((b) => b.kind === 'OPEN' || b.kind === 'OVERDUE');
  const paid = bills.filter((b) => b.kind === 'PAID');
  const overdue = bills.filter((b) => b.kind === 'OVERDUE');
  const loading = invoices.isPending || cards.isPending;

  const go = (n: number) => {
    setMonth(addMonth(month, n));
    setDay(null);
  };

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">Calendário de contas</h1>
          <p className="m-0 text-sm text-muted-foreground">Faturas dos seus cartões</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => go(-1)} aria-label="Mês anterior" className="icon-btn size-11">
            <Icon icon="chevron-left" size={18} />
          </button>
          <span className="min-w-36 text-center text-[15px] font-semibold">{monthLong(month)}</span>
          <button onClick={() => go(1)} aria-label="Próximo mês" className="icon-btn size-11">
            <Icon icon="chevron-right" size={18} />
          </button>
          {month !== current && (
            <button onClick={() => { setMonth(current); setDay(null); }} className="btn btn-outline h-11">
              Hoje
            </button>
          )}
        </div>
      </div>

      <StatTiles
        tiles={[
          { label: 'A pagar', value: money(open.reduce((t, b) => t + b.amount, 0)), ...tileBrand },
          { label: 'Pagas', value: money(paid.reduce((t, b) => t + b.amount, 0)), ...tilePlain },
          {
            label: 'Não pagas',
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
                aria-label={`${c.d} de ${monthLong(month)}${c.bills.length ? `, ${c.bills.length} fatura(s)` : ''}`}
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
                  {c.bills.slice(0, 3).map((b) => (
                    <span key={b.id} className="size-1.5 rounded-full" style={{ background: c.sel ? '#C6FF33' : STYLE[b.kind].dot }} />
                  ))}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3.5 pt-1 text-xs text-muted-foreground">
            {(['PAID', 'OPEN', 'OVERDUE', 'CLOSED'] as Kind[]).map((k) => (
              <span key={k} className="flex items-center gap-[5px]">
                <span className="size-[7px] rounded-full" style={{ background: STYLE[k].dot }} />
                {STYLE[k].label}
              </span>
            ))}
          </div>
        </div>

        <div data-anim="" className="card flex flex-col gap-1">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="card-title">{day ? `Faturas de ${fmtDay(day)}` : 'Faturas do mês'}</span>
            {day && (
              <button onClick={() => setDay(null)} className="btn btn-outline h-9 px-3 text-[13px]">
                Ver todas
              </button>
            )}
          </div>
          {loading && <div className="py-6 text-center text-sm text-muted-foreground">Carregando…</div>}
          {list.map((b) => {
            const st = STYLE[b.kind], diff = daysBetween(today, b.date);
            const when =
              b.kind === 'PAID'
                ? `Venceu ${fmtDay(b.date)}`
                : b.kind === 'OVERDUE'
                  ? `Venceu há ${-diff} dia${-diff > 1 ? 's' : ''}`
                  : b.kind === 'CLOSED'
                    ? `Venceu ${fmtDay(b.date)}`
                    : diff === 0
                      ? 'Vence hoje'
                      : diff > 0
                        ? `Vence em ${diff} dia${diff > 1 ? 's' : ''} · ${fmtDay(b.date)}`
                        : `Venceu ${fmtDay(b.date)}`;
            return (
              <div key={b.id} className="flex min-h-[68px] flex-wrap items-center gap-3 border-t border-border py-2">
                <BankLogo name={b.bank} size={42} />
                <div className="min-w-[120px] flex-1">
                  <div className="text-[15px] font-semibold">{b.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {when} · {b.sub}
                  </div>
                </div>
                <div className="ml-auto flex flex-col items-end gap-1">
                  <span className="text-[15px] font-semibold tabular-nums">{money(b.amount)}</span>
                  <span className="badge" style={{ background: st.bg, color: st.fg, borderColor: st.border }}>
                    {st.label}
                  </span>
                </div>
              </div>
            );
          })}
          {!loading && list.length === 0 && (
            <div className="flex flex-col items-center gap-2.5 border-t border-border px-3 py-7 text-center">
              <PlutoLogo size={56} />
              <div className="text-[15px] font-semibold">{day ? 'Nenhuma fatura neste dia' : 'Nenhuma fatura neste mês'}</div>
              <div className="text-[13px] text-muted-foreground">Dia livre. A Pluto avisa quando algo vencer.</div>
            </div>
          )}
          {overdue.length > 0 && (
            <p className="mt-2 mb-0 text-xs leading-normal text-muted-foreground">
              “Não paga” significa que o banco ainda não informou o pagamento ao Open Finance. Se você já pagou, o status se corrige na próxima sincronização.
            </p>
          )}
        </div>
      </div>
      <CommitmentsCard />
    </div>
  );
}
