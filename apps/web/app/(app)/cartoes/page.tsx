'use client';

import { useEffect, useRef, useState } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { CreditCard, cardLook } from '@/components/CreditCard';
import { useShell } from '@/components/shell/ShellContext';
import { LiveTransactionList } from '@/components/TransactionList';
import { Icon } from '@/components/ui/Icon';
import { useApp } from '@/lib/store';
import { ymdIn } from '@/lib/datetime';
import { fmtDay, fmtDayFull } from '@/lib/format';
import { nextDue } from '@/lib/insights';
import { play, useEnter } from '@/lib/motion';
import { money, useCards, useInvoices, useTz } from '@/lib/queries';

const INVOICE_LABEL = { PAID: 'Paga', OPEN: 'Aberta', CLOSED: 'Fechada', OVERDUE: 'Não paga' } as const;

export default function CartoesPage() {
  const { mode, nav } = useShell();
  const holder = useApp((s) => s.user?.name) ?? null;
  const isMobile = mode === 'mobile';
  const tz = useTz();
  const today = ymdIn(new Date(), tz);
  const cards = useCards();
  const invoices = useInvoices();
  const [sel, setSel] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const prevSel = useRef(0);
  useEnter(root);

  useEffect(() => {
    // Troca de cartao: o detalhe acompanha, sem teletransportar os numeros.
    if (sel !== prevSel.current) play(detailRef.current, [{ opacity: 0.4, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 200 });
    prevSel.current = sel;
  }, [sel]);

  const list = cards.data ?? [];
  const c = list[Math.min(sel, Math.max(list.length - 1, 0))];
  const scrollTo = (i: number) => {
    const el = scroller.current, ch = el?.children[i] as HTMLElement | undefined, first = el?.children[0] as HTMLElement | undefined;
    if (el && ch && first) el.scrollTo({ left: ch.offsetLeft - first.offsetLeft - (el.clientWidth - ch.offsetWidth) / 2 + 6, behavior: 'smooth' });
  };
  const history = (invoices.data ?? []).filter((i) => c && i.accountId === c.id).sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime()).slice(0, 6);
  const usedPct = c?.creditLimitMinor && c.usedMinor != null ? (c.usedMinor / c.creditLimitMinor) * 100 : null;

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Cartões</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            {cards.isPending ? 'Carregando…' : `${list.length} cart${list.length === 1 ? 'ão' : 'ões'} · faturas atuais somam ${money(list.reduce((t, x) => t + x.currentBillMinor, 0))}`}
          </p>
        </div>
        <button onClick={() => nav('settings')} className="btn btn-outline shrink-0">
          <Icon icon="plus" size={16} />
          Conectar banco
        </button>
      </div>

      {cards.isSuccess && list.length === 0 && (
        <div data-anim="" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <PlutoLogo size={72} />
          <div className="text-[17px] font-semibold">Nenhum cartão de crédito</div>
          <div className="max-w-[360px] text-sm text-muted-foreground">As contas conectadas não têm cartão de crédito. Conecte o banco do seu cartão no Meu Pluggy.</div>
        </div>
      )}

      {list.length > 0 && c && (
        <>
          <div data-anim="" className="flex flex-col gap-3">
            <div
              ref={scroller}
              onScroll={(e) => {
                if (!isMobile) return;
                const el = e.currentTarget, first = el.children[0] as HTMLElement | undefined, w = first ? first.offsetWidth + 14 : 1;
                const i = Math.max(0, Math.min(el.children.length - 1, Math.round(el.scrollLeft / w)));
                if (i !== sel) setSel(i);
              }}
              className="no-scrollbar flex snap-x snap-mandatory gap-3.5 overflow-x-auto overscroll-x-contain p-1.5"
            >
              {list.map((x, i) => (
                <div
                  key={x.id}
                  onClick={() => {
                    setSel(i);
                    if (isMobile) scrollTo(i);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSel(i)}
                  aria-pressed={i === sel}
                  aria-label={`${x.name} final ${x.numberMasked ?? ''}`}
                  className="min-w-0 max-w-[360px] cursor-pointer snap-center transition-opacity"
                  style={{ flex: `0 0 ${isMobile ? '84%' : '320px'}`, opacity: i === sel ? 1 : 0.6 }}
                >
                  <CreditCard card={cardLook(x, i, holder)} selected={i === sel} />
                </div>
              ))}
            </div>
            {isMobile && list.length > 1 && (
              <div className="flex justify-center gap-1.5">
                {list.map((x, i) => (
                  <button
                    key={x.id}
                    onClick={() => {
                      setSel(i);
                      scrollTo(i);
                    }}
                    aria-label={`Ver ${x.name}`}
                    className="h-2 cursor-pointer rounded-full border-0 p-0 transition-all"
                    style={{ width: i === sel ? 22 : 8, background: i === sel ? '#7D39EB' : 'var(--border)' }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="grid items-start gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,5fr) minmax(0,7fr)' : 'minmax(0,1fr)' }}>
            <div className="flex min-w-0 flex-col gap-4">
              <div ref={detailRef} className="card flex flex-col gap-[18px]">
                <div>
                  <div className="text-sm text-muted-foreground">Fatura atual · {c.name}</div>
                  <div className="mt-1 text-[clamp(28px,7vw,36px)] font-bold tracking-[-0.04em] tabular-nums">{money(c.currentBillMinor)}</div>
                  <div className="mt-0.5 text-[13px] text-muted-foreground">
                    {c.dueDay ? `Vence ${fmtDay(nextDue(c.dueDay, today))}` : 'Vencimento não informado'}
                    {c.closingDay ? ` · fecha dia ${c.closingDay}` : ''}
                  </div>
                </div>
                {c.creditLimitMinor != null && (
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-[13px]">
                      <span className="text-muted-foreground">Limite usado</span>
                      <span>
                        <strong>{money(c.usedMinor ?? 0)}</strong> de {money(c.creditLimitMinor)}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.min(usedPct ?? 0, 100).toFixed(1)}%` }} />
                    </div>
                    {c.availableCreditMinor != null && (
                      <div className="text-[13px] text-muted-foreground">
                        Disponível: <strong className="text-foreground">{money(c.availableCreditMinor)}</strong>
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => nav('bills')} className="btn btn-outline">
                  <Icon icon="calendar-days" size={16} />
                  Ver no calendário de contas
                </button>
              </div>

              <div className="card flex flex-col gap-1">
                <div className="card-title mb-1.5">Últimas faturas</div>
                {invoices.isSuccess && history.length === 0 && <div className="py-3 text-sm text-muted-foreground">O banco ainda não informou faturas fechadas deste cartão.</div>}
                {history.map((i) => (
                  <div key={i.id} className="flex min-h-14 items-center justify-between gap-3 border-t border-border text-sm">
                    <span>Venceu {fmtDayFull(i.dueDate.toISOString())}</span>
                    <span className="flex items-center gap-2">
                      <strong className="tabular-nums">{money(i.totalMinor)}</strong>
                      <span
                        className="badge"
                        style={
                          i.status === 'PAID'
                            ? { background: '#C6FF33', color: '#000' }
                            : i.status === 'OVERDUE'
                              ? { background: 'var(--danger-soft)', color: 'var(--danger-text)' }
                              : { background: 'var(--muted)', color: 'var(--muted-foreground)' }
                        }
                      >
                        {INVOICE_LABEL[i.status]}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <LiveTransactionList key={c.id} mode={mode} accountId={c.id} title="Compras no cartão" controls={false} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
