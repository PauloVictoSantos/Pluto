'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { PlutoMascot } from '@/components/brand/PlutoMascot';
import { CategoryChart, PlutoTip } from '@/components/charts/CategoryChart';
import { RevenueChart } from '@/components/charts/RevenueChart';
import { BankLogo } from '@/components/BankLogo';
import { CreditCard, cardLook } from '@/components/CreditCard';
import { useShell } from '@/components/shell/ShellContext';
import { LiveTransactionList } from '@/components/TransactionList';
import { CountUp } from '@/components/ui/CountUp';
import { Icon } from '@/components/ui/Icon';
import { bankBrand } from '@/lib/banks';
import { fmtDateTimeIn, ymdIn } from '@/lib/datetime';
import { VALUE_MASK, fmtDay } from '@/lib/format';
import { nextDue, spendingTip } from '@/lib/insights';
import { useEnter } from '@/lib/motion';
import { change, monthLower, money, useBudget, useCards, useCurrentMonth, useInvestments, useSpending, useSummary, useTz } from '@/lib/queries';
import { setHideValues, useApp } from '@/lib/store';
import { useHydrated, type Mode } from '@/lib/viewport';

type Block = 'saldo' | 'kpis' | 'chart' | 'pie' | 'limit' | 'cards' | 'due' | 'invest' | 'tx';
const LAYOUT: Record<Mode, Partial<Record<Block, string>>> = {
  desktop: { saldo: 'span 5', kpis: 'span 7', chart: 'span 8', pie: 'span 4', cards: 'span 5', invest: 'span 4', limit: 'span 3', due: 'span 3' },
  tablet: { saldo: '1 / -1', kpis: '1 / -1', chart: '1 / -1', pie: 'span 6', limit: 'span 6', cards: '1 / -1', due: 'span 6', invest: 'span 6' },
  mobile: {},
};
const MOBILE_ORDER: Block[] = ['saldo', 'kpis', 'limit', 'cards', 'due', 'pie', 'chart', 'tx', 'invest'];
const pctText = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`);

export default function OverviewPage() {
  const { mode, nav, openChat } = useShell();
  const isMobile = mode === 'mobile';
  const userName = (useApp((s) => s.user?.name) ?? '').split(' ')[0];
  const hydrated = useHydrated();
  const tz = useTz();
  const month = useCurrentMonth();
  const root = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  useEnter(root);

  const summary = useSummary();
  const spending = useSpending();
  const budget = useBudget(month);
  const cards = useCards();
  const invest = useInvestments();

  const hide = useApp((st) => st.hideValues);
  const [cardIdx, setCardIdx] = useState(0);

  const L = (k: Block): CSSProperties => ({ gridColumn: LAYOUT[mode][k] ?? '1 / -1', order: isMobile ? MOBILE_ORDER.indexOf(k) : 0 });
  const now = new Date();
  const hour = hydrated ? +fmtDateTimeIn(now, tz).slice(-5, -3) : 12;
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const today = ymdIn(now, tz);

  const s = summary.data;
  const cur = s?.current, prev = s?.previous;
  const kpis = [
    { label: 'Receitas', v: cur?.incomeMinor, c: cur && prev ? change(cur.incomeMinor, prev.incomeMinor) : null, icon: 'arrow-down-left', featured: true, invert: false },
    { label: 'Despesas', v: cur?.expensesMinor, c: cur && prev ? change(cur.expensesMinor, prev.expensesMinor) : null, icon: 'arrow-up-right', featured: false, invert: true },
    {
      label: 'Saldo do mês',
      v: cur ? cur.incomeMinor - cur.expensesMinor : undefined,
      c: cur && prev ? change(cur.incomeMinor - cur.expensesMinor, prev.incomeMinor - prev.expensesMinor) : null,
      icon: 'wallet', featured: false, invert: false,
    },
    { label: 'Investido', v: cur?.investedMinor, c: cur && prev ? change(cur.investedMinor, prev.investedMinor) : null, icon: 'piggy-bank', featured: false, invert: false },
  ];

  const limitTotal = (budget.data?.items ?? []).reduce((t, b) => t + b.limitMinor, 0);
  const spent = cur?.expensesMinor ?? 0;
  const used = limitTotal ? (spent / limitTotal) * 100 : 0;

  const cardList = cards.data ?? [];
  const dues = cardList
    .filter((c) => c.dueDay && c.currentBillMinor > 0)
    .map((c) => ({ id: c.id, name: c.name, date: nextDue(c.dueDay!, today), amount: c.currentBillMinor }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const overdue = cardList.filter((c) => c.invoice?.status === 'OVERDUE');

  const actions = [
    { label: 'Extrato', icon: 'arrow-left-right', bg: 'var(--primary)', fg: 'var(--primary-foreground)', border: 'transparent', go: () => nav('tx') },
    { label: 'Faturas', icon: 'calendar-days', bg: 'var(--accent)', fg: '#000', border: 'transparent', go: () => nav('bills') },
    { label: 'Metas', icon: 'target', bg: 'var(--muted)', fg: 'var(--foreground)', border: 'var(--border)', go: () => nav('goals') },
    { label: 'Planejar', icon: 'pie-chart', bg: 'var(--muted)', fg: 'var(--foreground)', border: 'var(--border)', go: () => nav('plan') },
  ];

  const scrollToCard = (i: number) => {
    const el = cardsRef.current, c = el?.children[i] as HTMLElement | undefined;
    if (el && c) el.scrollTo({ left: c.offsetLeft - el.offsetLeft - 4, behavior: 'smooth' });
  };

  const phrases = cur
    ? [`Miau! Seu resumo de ${monthLower(month)} está pronto.`, `Você recebeu ${money(cur.incomeMinor)} este mês.`, 'Prrr… carinho aceito.']
    : ['Miau!', 'Prrr… carinho aceito.'];

  return (
    <div ref={root} className="flex flex-col gap-4">
      <section data-anim="" className="mb-1 flex flex-wrap items-center gap-3.5">
        <div className="relative size-[76px] shrink-0 overflow-visible rounded-[22px] bg-brand-soft">
          <PlutoMascot scene="wave" phrases={phrases} />
        </div>
        <div className="min-w-[200px] flex-1">
          <h1 className="m-0 text-[clamp(22px,5vw,30px)] leading-[1.15] font-bold tracking-[-0.035em]">
            {greeting}, {userName}!
          </h1>
          <p className="mt-1 mb-0 text-sm text-pretty text-muted-foreground">A Pluto preparou seu resumo de hoje.</p>
        </div>
        {!isMobile && (
          <div className="flex items-center gap-2.5">
            <span className="text-sm text-muted-foreground">{hydrated ? `${fmtDay(today)} ${today.slice(0, 4)}` : ''}</span>
            <button onClick={openChat} className="btn btn-accent">
              <Icon icon="sparkles" size={16} />
              Perguntar à Pluto
            </button>
          </div>
        )}
      </section>

      <div className="grid grid-cols-12 gap-4">
        {/* Saldo */}
        <div data-anim="" className="card flex flex-col gap-5" style={L('saldo')}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-medium text-muted-foreground">Saldo em conta</span>
            <button onClick={() => setHideValues(!hide)} aria-label={hide ? 'Mostrar valores' : 'Ocultar valores'} aria-pressed={hide} className="icon-btn">
              <Icon icon={hide ? 'eye-off' : 'eye'} size={17} />
            </button>
          </div>
          <div>
            {s ? (
              <CountUp
                key={s.balanceMinor}
                value={s.balanceMinor / 100}
                text={undefined}
                className="block text-[clamp(34px,8vw,44px)] leading-[1.05] font-bold tracking-[-0.045em] tabular-nums"
              />
            ) : (
              <div className="h-[46px] w-56 animate-pulse rounded-xl bg-muted" />
            )}
            <div className="mt-2.5 text-[13px] text-muted-foreground">
              Contas corrente e poupança{s?.lastSyncAt ? ` · atualizado ${fmtDateTimeIn(s.lastSyncAt, tz)}` : ''}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {actions.map((a) => (
              <button key={a.label} onClick={a.go} className="group flex cursor-pointer flex-col items-center gap-2 border-0 bg-transparent py-1 text-xs font-semibold text-foreground">
                <span className="grid size-[54px] place-items-center rounded-full transition-transform group-hover:scale-105" style={{ background: a.bg, color: a.fg, border: `1px solid ${a.border}` }}>
                  <Icon icon={a.icon} size={20} />
                </span>
                {a.label}
              </button>
            ))}
          </div>
          <div className="border-t border-border pt-4">
            <div className="mb-3 text-[13px] font-medium text-muted-foreground">Contas conectadas · Open Finance</div>
            {s && s.banks.length === 0 && (
              <button onClick={() => nav('settings')} className="btn btn-outline">
                <Icon icon="plus" size={16} />
                Conectar banco
              </button>
            )}
            <div className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1">
              {(s?.banks ?? []).map((b) => (
                <div key={b.connectionId} className="flex flex-[1_0_148px] snap-start flex-col gap-2.5 rounded-[14px] border border-border p-3.5">
                  <div className="flex items-center gap-2">
                    <BankLogo name={b.institutionName} color={b.primaryColor} />
                    <span className="truncate text-sm font-semibold">{bankBrand(b.institutionName).label}</span>
                  </div>
                  <div className="text-[17px] font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums">{money(b.balanceMinor)}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-[7px] rounded-full" style={{ background: b.needsAction ? '#EF4444' : '#22C55E' }} />
                    {b.needsAction ? 'Reconectar' : 'Conectada'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* KPIs do mes */}
        <div className="grid grid-cols-2" style={{ ...L('kpis'), gap: isMobile ? 10 : 16 }}>
          {kpis.map((k) => {
            const up = (k.c ?? 0) >= 0, good = k.invert ? !up : up;
            return (
              <div
                key={k.label}
                data-anim=""
                className="flex min-w-0 flex-col justify-between gap-4 rounded-2xl"
                style={{
                  background: k.featured ? '#7D39EB' : 'var(--card)',
                  color: k.featured ? '#fff' : 'var(--foreground)',
                  border: `1px solid ${k.featured ? '#7D39EB' : 'var(--border)'}`,
                  padding: isMobile ? 14 : 20,
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="grid size-9 place-items-center rounded-full" style={{ background: k.featured ? 'rgba(255,255,255,.16)' : 'var(--muted)' }}>
                    <Icon icon={k.icon} size={17} />
                  </span>
                  {k.c !== null && (
                    <span
                      className="inline-flex items-center gap-[3px] rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap"
                      style={{
                        background: good ? '#C6FF33' : k.featured ? '#FFFFFF' : 'var(--danger-soft)',
                        color: good ? '#000' : k.featured ? '#B42318' : 'var(--danger-text)',
                      }}
                    >
                      <Icon icon={up ? 'arrow-up-right' : 'arrow-down-right'} size={13} />
                      {pctText(k.c)}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{k.label}</div>
                  <div className="mt-1 truncate leading-[1.15] font-bold tracking-[-0.04em] tabular-nums" style={{ fontSize: isMobile ? 19 : 26 }}>
                    {k.v === undefined ? '—' : money(k.v)}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: k.featured ? 'rgba(255,255,255,.85)' : 'var(--muted-foreground)' }}>
                    {cur && prev ? `${monthLower(cur.month)} vs. ${monthLower(prev.month)}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div data-anim="" className="min-w-0" style={L('chart')}>
          <RevenueChart data={s?.monthly ?? []} loading={summary.isPending} />
        </div>
        <div data-anim="" className="min-w-0" style={L('pie')}>
          <CategoryChart spending={spending.data} loading={spending.isPending} tip={spendingTip(spending.data, budget.data)} />
        </div>

        {/* Limite de gastos (orcamento do mes, RN-20) */}
        <div data-anim="" className="card flex flex-col gap-3.5" style={L('limit')}>
          <div className="flex items-center justify-between">
            <span className="card-title">Limite de gastos</span>
            <button onClick={() => nav(limitTotal ? 'budget' : 'plan')} className="h-10 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
              {limitTotal ? 'Ver' : 'Definir'}
            </button>
          </div>
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-[28px] font-bold tracking-[-0.04em] tabular-nums">{money(spent)}</span>
            <span className="text-sm text-muted-foreground">{limitTotal ? `de ${money(limitTotal)}` : `gastos em ${monthLower(month)}`}</span>
          </div>
          {limitTotal ? (
            <>
              <div role="progressbar" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100} aria-label="Limite usado" className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div data-grow="" className="h-full origin-left rounded-full" style={{ width: `${Math.min(used, 100).toFixed(1)}%`, background: used > 100 ? '#EF4444' : '#7D39EB' }} />
              </div>
              <div className="flex justify-between gap-2 text-[13px] text-muted-foreground">
                <span>{used.toFixed(1).replace('.', ',')}% usado</span>
                <span>
                  {limitTotal >= spent ? 'Restam ' : 'Passou '}
                  <strong className="text-foreground">{money(Math.abs(limitTotal - spent))}</strong>
                </span>
              </div>
            </>
          ) : (
            <div className="text-[13px] leading-normal text-muted-foreground">Você ainda não definiu um orçamento para este mês. O Planejamento sugere limites pelos seus gastos reais.</div>
          )}
        </div>

        {/* Cartoes */}
        <div data-anim="" className="card flex flex-col gap-4" style={L('cards')}>
          <div className="flex items-center justify-between">
            <span className="card-title">Meus cartões</span>
            <button onClick={() => nav('cards')} className="btn btn-outline h-10 gap-1.5 px-3.5 text-[13px]">
              Ver todos
              <Icon icon="chevron-right" size={15} />
            </button>
          </div>
          {cards.isSuccess && cardList.length === 0 && <div className="text-sm text-muted-foreground">Nenhum cartão de crédito nas contas conectadas.</div>}
          <div
            ref={cardsRef}
            onScroll={(e) => {
              const el = e.currentTarget, w = el.firstElementChild ? (el.firstElementChild as HTMLElement).offsetWidth + 14 : 1;
              const i = Math.round(el.scrollLeft / w);
              if (i !== cardIdx) setCardIdx(i);
            }}
            className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3.5 overflow-x-auto overscroll-x-contain px-1"
          >
            {cardList.map((c, i) => (
              <div key={c.id} className="flex min-w-0 snap-start flex-col gap-2.5" style={{ flex: `0 0 ${isMobile ? '84%' : 'calc(50% - 7px)'}` }}>
                <div onClick={() => nav('cards')} className="cursor-pointer">
                  <CreditCard card={cardLook(c, i)} />
                </div>
                <div className="flex justify-between gap-2 text-[13px]">
                  <span className="text-muted-foreground">{c.dueDay ? `Fatura atual · vence ${fmtDay(nextDue(c.dueDay, today))}` : 'Fatura atual'}</span>
                  <strong className="tabular-nums">{money(c.currentBillMinor)}</strong>
                </div>
              </div>
            ))}
          </div>
          {isMobile && cardList.length > 1 && (
            <div className="flex justify-center gap-1.5">
              {cardList.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => scrollToCard(i)}
                  aria-label={`Ver cartão ${c.name}`}
                  className="h-2 cursor-pointer rounded-full border-0 p-0 transition-all"
                  style={{ width: i === cardIdx ? 22 : 8, background: i === cardIdx ? '#7D39EB' : 'var(--border)' }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Proximos vencimentos (Apendice B) */}
        <div data-anim="" className="card flex flex-col gap-3" style={L('due')}>
          <div className="flex items-center justify-between">
            <span className="card-title">Próximos vencimentos</span>
            <button onClick={() => nav('bills')} className="h-10 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
              Calendário
            </button>
          </div>
          {overdue.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger-text">
              <Icon icon="circle-alert" size={16} />
              {overdue.length === 1 ? `A última fatura do ${overdue[0]!.name} consta como não paga.` : `${overdue.length} faturas recentes constam como não pagas.`}
            </div>
          )}
          {dues.length === 0 && cards.isSuccess && <div className="text-sm text-muted-foreground">Nenhuma fatura em aberto.</div>}
          {dues.slice(0, 4).map((d) => (
            <div key={d.id} className="flex items-center gap-3 border-t border-border pt-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                <Icon icon="credit-card" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{d.name}</div>
                <div className="text-xs text-muted-foreground">Vence {fmtDay(d.date)}</div>
              </div>
              <span className="text-sm font-semibold whitespace-nowrap tabular-nums">{money(d.amount)}</span>
            </div>
          ))}
          <PlutoTip text="Pagar as faturas até o vencimento evita os juros do rotativo, que estão entre os mais altos do mercado." />
        </div>

        {/* Investimentos */}
        <div data-anim="" className="card flex flex-col gap-3.5" style={L('invest')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="card-title">Investimentos</div>
              <div className="mt-1 text-[13px] text-muted-foreground">Posições informadas pelo Open Finance</div>
            </div>
            {invest.data && invest.data.items.length > 0 && (
              <div className="text-xl font-bold tracking-[-0.035em] tabular-nums">{money(invest.data.totalMinor)}</div>
            )}
          </div>
          {invest.data && invest.data.items.length === 0 && (
            <div className="text-sm leading-normal text-muted-foreground">
              Nenhum investimento nas conexões atuais. Se você investe por uma corretora, conecte-a no Meu Pluggy e importe em Configurações.
            </div>
          )}
          {(invest.data?.items ?? []).slice(0, 5).map((i) => {
            const gain = i.appliedMinor ? ((i.currentValueMinor - i.appliedMinor) / i.appliedMinor) * 100 : null;
            return (
              <div key={i.id} className="flex min-h-14 items-center gap-3 border-t border-border">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{i.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{[i.institutionName, i.rateInfo].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="flex flex-col items-end gap-[3px]">
                  <div className="text-sm font-semibold tabular-nums">{money(i.currentValueMinor)}</div>
                  {gain !== null && (
                    <span className="badge" style={{ background: gain >= 0 ? '#C6FF33' : 'var(--danger-soft)', color: gain >= 0 ? '#000' : 'var(--danger-text)' }}>
                      {pctText(gain)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div data-anim="" className="min-w-0" style={{ gridColumn: '1 / -1', order: isMobile ? MOBILE_ORDER.indexOf('tx') : 0 }}>
          <LiveTransactionList mode={mode} limit={6} controls={false} onShowAll={() => nav('tx')} onConnect={() => nav('settings')} />
        </div>
      </div>
    </div>
  );
}
