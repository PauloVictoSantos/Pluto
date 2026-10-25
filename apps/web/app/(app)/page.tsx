'use client';

import type { Bill, Card } from '@pluto/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BankLogo } from '@/components/BankLogo';
import { PlutoMascot } from '@/components/brand/PlutoMascot';
import { CategoryChart, PlutoTip } from '@/components/charts/CategoryChart';
import { RevenueChart } from '@/components/charts/RevenueChart';
import { CreditCard, cardLook } from '@/components/CreditCard';
import { FinancialHealthGauge } from '@/components/FinancialHealthGauge';
import { ForecastCard } from '@/components/ForecastCard';
import { useShell } from '@/components/shell/ShellContext';
import { Sparkline } from '@/components/Sparkline';
import { LiveTransactionList } from '@/components/TransactionList';
import { CountUp } from '@/components/ui/CountUp';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { bankBrand } from '@/lib/banks';
import { fmtDateTimeIn, ymdIn } from '@/lib/datetime';
import { VALUE_MASK, daysBetween, fmtDay } from '@/lib/format';
import { nextDue, spendingTip } from '@/lib/insights';
import { useEnter } from '@/lib/motion';
import { change, monthLower, monthProgress, money, useBudget, useCards, useCurrentMonth, useInvestments, useSpending, useSummary, useTz } from '@/lib/queries';
import { setHideValues, useApp } from '@/lib/store';
import { useHydrated, type Mode } from '@/lib/viewport';

// Visao geral (tarefa 7): 7 blocos em destaque em cima (Saldo, Receitas, Despesas, Investido, Compras
// recentes, Proximos vencimentos, Limite de gastos) e o resto na secao "Analises", recolhivel.

const pctText = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`);

/**
 * Areas da grade por largura: sem buraco nem card orfao, cards da mesma linha com a mesma altura.
 * Receitas e Despesas dividem o bloco "kpi" meio a meio (nunca abaixo de 280 px: com menos espaco,
 * empilham). Investido fica na coluna lateral (doc. Melhorias, passo 3).
 */
const AREAS: Record<Mode, string> = {
  desktop: `"saldo saldo saldo saldo saldo saldo kpi kpi kpi kpi kpi kpi"
            "tx tx tx tx tx tx tx due due due due due"
            "tx tx tx tx tx tx tx lim lim lim lim lim"
            "tx tx tx tx tx tx tx inv inv inv inv inv"`,
  tablet: `"saldo saldo" "kpi kpi" "inv inv" "tx due" "tx lim"`,
  mobile: '',
};
const KPI_GRID: CSSProperties = { gridArea: 'kpi', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 };

interface Due {
  id: string;
  name: string;
  sub: string;
  date: string;
  amount: number;
  overdue: boolean;
  bank: string | null;
}

export default function OverviewPage() {
  const { mode, nav, openChat } = useShell();
  const isMobile = mode === 'mobile';
  const fullName = useApp((s) => s.user?.name) ?? null;
  const userName = (fullName ?? '').split(' ')[0] ?? '';
  const hydrated = useHydrated();
  const tz = useTz();
  const month = useCurrentMonth();
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const summary = useSummary();
  const series = useQuery({ queryKey: ['dashboard', 'series'], queryFn: api.series, staleTime: 5 * 60_000 });
  const spending = useSpending();
  const budget = useBudget(month);
  const cards = useCards();
  const invest = useInvestments();
  const bills = useQuery({ queryKey: ['bills'], queryFn: api.bills });
  const [analysesOpen, setAnalysesOpen] = useState<boolean | null>(null);
  const hide = useApp((st) => st.hideValues);
  const showAnalyses = analysesOpen ?? !isMobile;

  const sr = series.data;
  const s = summary.data;
  const cur = s?.current, prev = s?.previous;
  const now = new Date();
  const today = ymdIn(now, tz);
  const hour = hydrated ? +fmtDateTimeIn(now, tz).slice(-5, -3) : 12;
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  // Proximos vencimentos: faturas dos cartoes + boletos a pagar, por data.
  const cardList = cards.data ?? [];
  const dues: Due[] = [
    ...cardList
      .filter((c) => c.dueDay && c.currentBillMinor > 0)
      .map((c) => ({ id: `c-${c.id}`, name: c.name, sub: 'Fatura atual', date: nextDue(c.dueDay!, today), amount: c.currentBillMinor, overdue: false, bank: c.institutionName })),
    ...cardList
      .filter((c) => c.invoice?.status === 'OVERDUE')
      .map((c) => ({ id: `o-${c.id}`, name: c.name, sub: 'Fatura não paga', date: c.invoice!.dueDate.toISOString().slice(0, 10), amount: c.invoice!.totalMinor - c.invoice!.paidMinor, overdue: true, bank: c.institutionName })),
    ...(bills.data ?? [])
      .filter((b: Bill) => b.status !== 'paid')
      .map((b: Bill) => ({ id: `b-${b.id}`, name: b.payee, sub: 'Boleto', date: b.dueDate, amount: b.amountMinor, overdue: b.status === 'overdue', bank: null })),
  ].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date));
  const urgent = dues.some((d) => d.overdue || daysBetween(today, d.date) <= 7);

  const area = (name: string): CSSProperties => (isMobile ? {} : { gridArea: name });

  const kpis = {
    rec: { label: 'Receitas', v: cur?.incomeMinor, c: cur && prev ? change(cur.incomeMinor, prev.incomeMinor) : null, icon: 'arrow-down-left', featured: true, invert: false, series: sr?.incomeMinor },
    desp: { label: 'Despesas', v: cur?.expensesMinor, c: cur && prev ? change(cur.expensesMinor, prev.expensesMinor) : null, icon: 'arrow-up-right', featured: false, invert: true, series: sr?.expensesMinor },
  };
  const sub = cur && prev ? `${monthLower(cur.month)} vs. ${monthLower(prev.month)}` : '';

  const blocks = {
    saldo: saldoCard(area('saldo')),
    rec: <KpiCard k={kpis.rec} sub={sub} days={sr?.days} compact={isMobile} style={{}} />,
    desp: <KpiCard k={kpis.desp} sub={sub} days={sr?.days} compact={isMobile} style={{}} />,
    inv: investedCard(area('inv')),
    tx: (
      <div data-anim="" className="min-w-0 [&>.card]:h-full [&>.card]:rounded-[24px]" style={area('tx')}>
        <LiveTransactionList mode={mode} limit={5} title="Compras recentes" controls={false} onShowAll={() => nav('tx')} onConnect={() => nav('settings')} />
      </div>
    ),
    due: dueCard(dues, cards.isPending || bills.isPending, area('due')),
    lim: limitCard(area('lim')),
  };

  return (
    <div ref={root} className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
      {/* Cabecalho em uma linha, altura fixa: nada fica cortado nem sobreposto. */}
      <section data-anim="" className="flex min-h-[56px] items-center gap-3">
        <div className="relative size-12 shrink-0 overflow-visible rounded-2xl bg-brand-soft">
          <PlutoMascot scene="wave" phrases={cur ? [`Miau! Seu resumo de ${monthLower(month)} está pronto.`, 'Prrr… carinho aceito.'] : ['Miau!']} />
        </div>
        <h1 className="m-0 min-w-0 flex-1 truncate text-[clamp(20px,4.5vw,28px)] leading-tight font-bold tracking-[-0.035em]">
          {greeting}, {userName}!
        </h1>
        {!isMobile && <span className="text-sm whitespace-nowrap text-muted-foreground">{hydrated ? `${fmtDay(today)} ${today.slice(0, 4)}` : ''}</span>}
        <button onClick={openChat} className="btn btn-accent shrink-0" aria-label="Falar com o Plutão">
          <Icon icon="sparkles" size={16} />
          {!isMobile && 'Falar com o Plutão'}
        </button>
      </section>

      {/* Os 7 blocos em destaque */}
      {isMobile ? (
        <div className="flex flex-col gap-3">
          {blocks.saldo}
          {urgent && blocks.due}
          <div className="grid grid-cols-2 gap-3">
            {blocks.rec}
            {blocks.desp}
          </div>
          {blocks.inv}
          {!urgent && blocks.due}
          {blocks.tx}
          {blocks.lim}
        </div>
      ) : (
        <div className="grid items-stretch gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'repeat(12, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gridTemplateAreas: AREAS[mode] }}>
          {blocks.saldo}
          <div className="min-w-0" style={KPI_GRID}>
            {blocks.rec}
            {blocks.desp}
          </div>
          {blocks.inv}
          {blocks.tx}
          {blocks.due}
          {blocks.lim}
        </div>
      )}

      {/* Analises: secundario, abaixo da dobra e recolhivel */}
      <section className="analises mt-2 flex flex-col gap-3" aria-labelledby="analises-title">
        <button
          onClick={() => setAnalysesOpen(!showAnalyses)}
          aria-expanded={showAnalyses}
          aria-controls="analises-body"
          className="flex min-h-11 cursor-pointer items-center justify-between rounded-2xl border-0 bg-transparent px-1 text-left text-foreground"
        >
          <span id="analises-title" className="text-[15px] font-semibold text-muted-foreground">
            Análises
          </span>
          <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
            {showAnalyses ? 'Recolher' : 'Ver projeção, gráficos, saúde financeira e cartões'}
            <Icon icon={showAnalyses ? 'chevron-up' : 'chevron-down'} size={16} />
          </span>
        </button>
        {showAnalyses && (
          <div id="analises-body" className="grid gap-3" style={{ gridTemplateColumns: mode === 'desktop' ? 'repeat(12, minmax(0, 1fr))' : 'minmax(0, 1fr)' }}>
            <div className="min-w-0" style={{ gridColumn: '1 / -1' }}>
              <ForecastCard />
            </div>
            <div className="min-w-0" style={{ gridColumn: mode === 'desktop' ? 'span 8' : '1 / -1' }}>
              <RevenueChart data={s?.monthly ?? []} loading={summary.isPending} />
            </div>
            <div className="min-w-0" style={{ gridColumn: mode === 'desktop' ? 'span 4' : '1 / -1' }}>
              <CategoryChart spending={spending.data} loading={spending.isPending} tip={spendingTip(spending.data, budget.data)} />
            </div>
            <div className="min-w-0" style={{ gridColumn: '1 / -1' }}>
              <FinancialHealthGauge firstName={userName} />
            </div>
            <div className="min-w-0" style={{ gridColumn: mode === 'desktop' ? 'span 7' : '1 / -1' }}>
              <CardsBlock cards={cardList} loaded={cards.isSuccess} holder={fullName} mobile={isMobile} />
            </div>
            <div className="min-w-0" style={{ gridColumn: mode === 'desktop' ? 'span 5' : '1 / -1' }}>
              {investmentsList()}
            </div>
          </div>
        )}
      </section>
    </div>
  );

  // ---------------------------------------------------------------------------------------------

  // Blocos montados como funcoes (nao componentes): nao remontam a cada renderizacao da pagina.
  function saldoCard(style: CSSProperties) {
    const monthChange = cur && prev ? change(cur.incomeMinor - cur.expensesMinor, prev.incomeMinor - prev.expensesMinor) : null;
    const actions = [
      { label: 'Extrato', icon: 'arrow-left-right', go: () => nav('tx') },
      { label: 'Faturas', icon: 'calendar-days', go: () => nav('bills') },
      { label: 'Metas', icon: 'target', go: () => nav('goals') },
      { label: 'Planejar', icon: 'pie-chart', go: () => nav('plan') },
    ];
    return (
      <div
        data-anim=""
        className="hero-card flex min-w-0 flex-col gap-4 text-white"
        style={{ ...style, background: 'radial-gradient(120% 120% at 100% 0%, rgba(198,244,50,.22) 0%, transparent 45%), linear-gradient(160deg, #17171c 0%, #0b0b0e 100%)', border: '1px solid #26262c' }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="card-title">Saldo em conta</span>
          <button onClick={() => setHideValues(!hide)} aria-label={hide ? 'Mostrar valores' : 'Ocultar valores'} aria-pressed={hide} className="icon-btn border-white/20 bg-white/10 text-white">
            <Icon icon={hide ? 'eye-off' : 'eye'} size={17} />
          </button>
        </div>
        <div className="@container">
          {s ? (
            <CountUp key={s.balanceMinor} value={s.balanceMinor / 100} text={hide ? VALUE_MASK : undefined} className="block text-[clamp(22px,9cqi,46px)] leading-[1.05] font-bold tracking-[-0.045em] whitespace-nowrap tabular-nums" />
          ) : (
            <div className="h-[48px] w-56 animate-pulse rounded-xl bg-white/10" />
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-white/75">
            <span>
              Saldo do mês <strong className="text-white tabular-nums">{cur ? money(cur.incomeMinor - cur.expensesMinor) : '—'}</strong>
            </span>
            {monthChange !== null && (
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: monthChange >= 0 ? '#c6f432' : 'rgba(248,113,113,.2)', color: monthChange >= 0 ? '#000' : '#FCA5A5' }}>
                {monthChange >= 0 ? '▲' : '▼'} {pctText(monthChange)}
              </span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {actions.map((a, i) => (
            <button key={a.label} onClick={a.go} className="group flex cursor-pointer flex-col items-center gap-1.5 border-0 bg-transparent py-1 text-xs font-semibold text-white">
              <span className="grid size-12 place-items-center rounded-full transition-transform group-hover:scale-105" style={{ background: i === 0 ? '#c6f432' : 'rgba(255,255,255,.1)', color: i === 0 ? '#000' : '#fff' }}>
                <Icon icon={a.icon} size={19} />
              </span>
              {a.label}
            </button>
          ))}
        </div>
        {/* Contas conectadas: faixa compacta de chips. */}
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {s && s.banks.length === 0 && (
            <button onClick={() => nav('settings')} className="btn h-9 border-white/20 bg-white/10 px-3 text-[13px] text-white">
              <Icon icon="plus" size={14} />
              Conectar banco
            </button>
          )}
          {(s?.banks ?? []).map((b) => {
            const line = sr?.banks.find((x) => x.connectionId === b.connectionId);
            return (
              <div key={b.connectionId} className="flex shrink-0 items-center gap-2 rounded-full bg-white/10 py-1.5 pr-3 pl-1.5">
                <BankLogo name={b.institutionName} color={b.primaryColor} size={24} />
                <span className="text-xs font-semibold whitespace-nowrap">{bankBrand(b.institutionName).label}</span>
                <span className="text-xs whitespace-nowrap text-white/80 tabular-nums">{money(b.balanceMinor)}</span>
                {line && (
                  <span className="w-12">
                    <Sparkline data={line.balanceMinor} height={18} interactive={false} label={`Saldo ${bankBrand(b.institutionName).label}`} color="#c6f432" />
                  </span>
                )}
                {b.needsAction && <span className="size-2 rounded-full bg-[#EF4444]" aria-label="Reconectar" />}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function investedCard(style: CSSProperties) {
    const total = invest.data?.totalMinor;
    const line = sr?.investedMinor;
    const first = line?.[0] ?? 0, last = line?.[line.length - 1] ?? 0;
    const c = line && first ? ((last - first) / Math.abs(first)) * 100 : null;
    // Agrupa posicoes iguais (mesma instituicao e indexador) numa linha so.
    const groups = new Map<string, { label: string; sub: string; value: number }>();
    for (const i of invest.data?.items ?? []) {
      const key = `${i.institutionName}|${i.rateInfo ?? i.subtype ?? i.type}`;
      const g = groups.get(key) ?? { label: i.subtype ?? i.name, sub: [i.institutionName, i.rateInfo].filter(Boolean).join(' · '), value: 0 };
      g.value += i.currentValueMinor;
      groups.set(key, g);
    }
    const top = [...groups.values()].sort((a, b) => b.value - a.value).slice(0, 3);
    return (
      <div data-anim="" className="hero-card card flex min-w-0 flex-col gap-3" style={style}>
        <div className="flex items-center justify-between gap-2">
          <span className="card-title">Investido</span>
          {c !== null && <Badge up={c >= 0} good={c >= 0} text={pctText(c)} />}
        </div>
        <div className="@container">
          <div className="text-[clamp(18px,9cqi,28px)] font-bold tracking-[-0.04em] whitespace-nowrap tabular-nums">{total === undefined ? '—' : money(total)}</div>
        </div>
        <div className="h-10 text-muted-foreground">
          {line ? <Sparkline data={line} days={sr?.days} height={40} filled label="Patrimônio investido" color={c === null || c >= 0 ? '#c6f432' : '#F87171'} /> : <div className="h-full animate-pulse rounded-lg bg-muted" />}
        </div>
        {invest.data && !invest.data.items.length ? (
          <div className="text-[13px] text-muted-foreground">Nenhum investimento nas conexões atuais.</div>
        ) : (
          <div className="flex flex-col">
            {top.map((g) => (
              <div key={g.label + g.sub} className="flex items-center justify-between gap-2 border-t border-border py-1.5 text-[13px]">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{g.label}</span> <span className="text-muted-foreground">{g.sub}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{money(g.value)}</span>
              </div>
            ))}
            <button onClick={() => nav('invest')} className="mt-1 h-9 cursor-pointer self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
              Ver todos
            </button>
          </div>
        )}
      </div>
    );
  }

  function dueCard(dues: Due[], loading: boolean, style: CSSProperties) {
    const overdue = dues.filter((d) => d.overdue);
    const chip = (d: Due) => {
      const n = daysBetween(today, d.date);
      if (d.overdue || n < 0) return { text: 'atrasada', bg: 'var(--danger-soft)', fg: 'var(--danger-text)' };
      if (n === 0) return { text: 'vence hoje', bg: 'var(--danger-soft)', fg: 'var(--danger-text)' };
      if (n <= 3) return { text: `em ${n} dia${n > 1 ? 's' : ''}`, bg: 'var(--danger-soft)', fg: 'var(--danger-text)' };
      if (n <= 7) return { text: `em ${n} dias`, bg: '#FEF3C7', fg: '#92400E' };
      return { text: `em ${n} dias`, bg: 'var(--muted)', fg: 'var(--muted-foreground)' };
    };
    return (
      <div data-anim="" className="hero-card card flex min-w-0 flex-col gap-3" style={style}>
        <div className="flex items-center justify-between">
          <span className="card-title">Próximos vencimentos</span>
          <button onClick={() => nav('bills')} className="h-10 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
            Contas a pagar
          </button>
        </div>
        {overdue.length > 0 && (
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-danger-text">
            <Icon icon="circle-alert" size={16} />
            {overdue.length === 1 ? `${overdue[0]!.name}: ${overdue[0]!.sub.toLowerCase()}, vencida em ${fmtDay(overdue[0]!.date)}.` : `${overdue.length} contas vencidas sem pagamento.`}
          </div>
        )}
        {loading && [0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-xl bg-muted" />)}
        {!loading && dues.length === 0 && <div className="py-3 text-sm text-muted-foreground">Nada para pagar agora. 🎉</div>}
        {dues
          .filter((d) => !d.overdue)
          .slice(0, 4)
          .map((d) => {
            const c = chip(d);
            return (
              <div key={d.id} className="flex items-center gap-3 border-t border-border pt-2.5">
                {d.bank ? (
                  <BankLogo name={d.bank} size={36} />
                ) : (
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                    <Icon icon="barcode" size={16} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.sub} · {fmtDay(d.date)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-semibold whitespace-nowrap tabular-nums">{money(d.amount)}</span>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>
                    {c.text}
                  </span>
                </div>
              </div>
            );
          })}
      </div>
    );
  }

  function limitCard(style: CSSProperties) {
    const limitTotal = (budget.data?.items ?? []).reduce((t, b) => t + b.limitMinor, 0);
    const spent = cur?.expensesMinor ?? 0;
    const used = limitTotal ? spent / limitTotal : 0;
    // RN-21: projecao do mes = gasto ate hoje / dias decorridos x dias do mes.
    const { days, elapsed } = monthProgress(month, today);
    const projected = elapsed ? Math.round((spent / elapsed) * days) : spent;
    const color = used >= 0.9 ? '#EF4444' : used >= 0.7 ? '#F59E0B' : '#7D39EB';
    if (budget.isSuccess && !limitTotal)
      return (
        <div data-anim="" className="hero-card card flex min-w-0 flex-col items-start justify-center gap-3" style={style}>
          <span className="card-title">Limite de gastos</span>
          <p className="m-0 text-sm text-muted-foreground">Defina quanto quer gastar por mês. A Pluto sugere limites pelo seu hábito real.</p>
          <button onClick={() => nav('budget')} className="btn btn-primary h-11">
            <Icon icon="plus" size={16} />
            Definir limite
          </button>
        </div>
      );
    return (
      <div data-anim="" className="hero-card card flex min-w-0 flex-col gap-3" style={style}>
        <div className="flex items-center justify-between">
          <span className="card-title">Limite de gastos</span>
          <button onClick={() => nav('budget')} className="h-10 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
            Ver
          </button>
        </div>
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-[28px] font-bold tracking-[-0.04em] tabular-nums">{money(spent)}</span>
          <span className="text-sm text-muted-foreground">de {money(limitTotal)}</span>
        </div>
        <div role="progressbar" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Limite usado" className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div data-grow="" className="h-full origin-left rounded-full" style={{ width: `${Math.min(used * 100, 100).toFixed(1)}%`, background: color }} />
        </div>
        <div className="flex justify-between gap-2 text-[13px] text-muted-foreground">
          <span>{(used * 100).toFixed(0)}% usado</span>
          <span>
            {limitTotal >= spent ? 'Restam ' : 'Passou '}
            <strong className="text-foreground">{money(Math.abs(limitTotal - spent))}</strong>
          </span>
        </div>
        <div className="text-[13px]" style={{ color: projected > limitTotal ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>
          No ritmo atual, o mês fecha em <strong>{money(projected)}</strong>
          {projected > limitTotal ? ', acima do limite.' : '.'}
        </div>
      </div>
    );
  }

  function investmentsList() {
    const items = invest.data?.items ?? [];
    return (
      <div className="card flex h-full flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="card-title">Investimentos</span>
          <button onClick={() => nav('invest')} className="h-9 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
            Ver todos
          </button>
        </div>
        {invest.isPending && <div className="h-24 animate-pulse rounded-xl bg-muted" />}
        {invest.data && !items.length && <div className="text-sm text-muted-foreground">Nenhum investimento nas conexões atuais.</div>}
        {items.slice(0, 5).map((i) => {
          const gain = i.appliedMinor ? ((i.currentValueMinor - i.appliedMinor) / i.appliedMinor) * 100 : null;
          return (
            <div key={i.id} className="flex min-h-12 items-center gap-3 border-t border-border">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{i.name}</div>
                <div className="truncate text-xs text-muted-foreground">{[i.institutionName, i.rateInfo].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="flex flex-col items-end gap-[3px]">
                <div className="text-sm font-semibold tabular-nums">{money(i.currentValueMinor)}</div>
                {gain !== null && <span className="text-xs tabular-nums" style={{ color: gain >= 0 ? '#16A34A' : 'var(--danger-text)' }}>{pctText(gain)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
}

function Badge({ up, good, text, featured }: { up: boolean; good: boolean; text: string; featured?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-[3px] rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap"
      style={{ background: good ? '#C6FF33' : featured ? '#FFFFFF' : 'var(--danger-soft)', color: good ? '#000' : featured ? '#B42318' : 'var(--danger-text)' }}
    >
      <Icon icon={up ? 'arrow-up-right' : 'arrow-down-right'} size={13} />
      {text}
    </span>
  );
}

interface Kpi {
  label: string;
  v: number | undefined;
  c: number | null;
  icon: string;
  featured: boolean;
  invert: boolean;
  series: number[] | undefined;
}

/** Card de Receitas/Despesas: icone, badge de variacao, sparkline, titulo, valor e comparacao. */
function KpiCard({ k, sub, days, compact, style }: { k: Kpi; sub: string; days?: string[]; compact: boolean; style: CSSProperties }) {
  const up = (k.c ?? 0) >= 0, good = k.invert ? !up : up;
  return (
    <div
      data-anim=""
      className="hero-card flex min-w-0 flex-col justify-between gap-3"
      style={{
        ...style,
        padding: compact ? 14 : undefined,
        background: k.featured ? '#7D39EB' : 'var(--card)',
        color: k.featured ? '#fff' : 'var(--foreground)',
        border: `1px solid ${k.featured ? '#7D39EB' : 'var(--border)'}`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="grid size-9 place-items-center rounded-full" style={{ background: k.featured ? 'rgba(255,255,255,.16)' : 'var(--muted)' }}>
          <Icon icon={k.icon} size={17} />
        </span>
        {k.c !== null && <Badge up={up} good={good} featured={k.featured} text={pctText(k.c)} />}
      </div>
      <div className="h-11" style={{ color: k.featured ? '#fff' : 'var(--muted-foreground)' }}>
        {k.series ? (
          <Sparkline data={k.series} days={days} height={44} filled label={k.label} color={k.featured ? 'rgba(255,255,255,.9)' : good ? '#c6f432' : '#F87171'} />
        ) : (
          <div className="h-full animate-pulse rounded-lg" style={{ background: k.featured ? 'rgba(255,255,255,.12)' : 'var(--muted)' }} />
        )}
      </div>
      <div className="@container min-w-0">
        <div className="text-sm font-semibold">{k.label}</div>
        <Value v={k.v} compact={compact} />
        <div className="mt-1 text-xs" style={{ color: k.featured ? 'rgba(255,255,255,.85)' : 'var(--muted-foreground)' }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

function Value({ v, compact }: { v: number | undefined; compact: boolean }): ReactNode {
  return (
    // Encolhe com a largura do card (cqi) em vez de cortar com reticencias: o valor aparece inteiro.
    <div className="mt-1 leading-[1.1] font-bold tracking-[-0.04em] whitespace-nowrap tabular-nums" style={{ fontSize: compact ? 'clamp(13px, 10cqi, 20px)' : 'clamp(16px, 10cqi, 28px)' }}>
      {v === undefined ? '—' : money(v)}
    </div>
  );
}

function CardsBlock({ cards, loaded, holder, mobile }: { cards: Card[]; loaded: boolean; holder: string | null; mobile: boolean }) {
  const { nav } = useShell();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="card flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="card-title">Meus cartões</span>
        <button onClick={() => nav('cards')} className="h-9 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
          Ver todos
        </button>
      </div>
      {loaded && cards.length === 0 && <div className="text-sm text-muted-foreground">Nenhum cartão de crédito nas contas conectadas.</div>}
      <div className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1">
        {cards.map((c, i) => (
          <div key={c.id} className="flex min-w-0 snap-start flex-col gap-2" style={{ flex: `0 0 ${mobile ? '84%' : 'min(300px, calc(50% - 6px))'}` }}>
            <button type="button" onClick={() => nav('cards')} className="cursor-pointer border-0 bg-transparent p-0 text-left" aria-label={`Abrir ${c.name}`}>
              <CreditCard card={cardLook(c, i, holder)} />
            </button>
            <div className="flex justify-between gap-2 text-[13px]">
              <span className="text-muted-foreground">{c.dueDay ? `Fatura atual · vence ${fmtDay(nextDue(c.dueDay, today))}` : 'Fatura atual'}</span>
              <strong className="tabular-nums">{money(c.currentBillMinor)}</strong>
            </div>
          </div>
        ))}
      </div>
      <PlutoTip text="Pagar as faturas até o vencimento evita os juros do rotativo, que estão entre os mais altos do mercado." />
    </div>
  );
}
