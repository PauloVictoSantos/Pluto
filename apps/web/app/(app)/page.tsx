'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { PlutoMascot } from '@/components/brand/PlutoMascot';
import { CategoryChart, PlutoTip } from '@/components/charts/CategoryChart';
import { RevenueChart } from '@/components/charts/RevenueChart';
import { CreditCard } from '@/components/CreditCard';
import { useShell } from '@/components/shell/ShellContext';
import { LiveTransactionList } from '@/components/TransactionList';
import { CountUp } from '@/components/ui/CountUp';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { fmt, maskMoney } from '@/lib/format';
import { MOCK } from '@/lib/mock/data';
import { vm } from '@/lib/mock/vm';
import { useEnter } from '@/lib/motion';
import { useApp } from '@/lib/store';
import { useHydrated, type Mode } from '@/lib/viewport';

type Block = 'saldo' | 'kpis' | 'chart' | 'pie' | 'limit' | 'cards' | 'score' | 'invest' | 'tx';
const LAYOUT: Record<Mode, Partial<Record<Block, string>>> = {
  desktop: { saldo: 'span 5', kpis: 'span 7', chart: 'span 8', pie: 'span 4', cards: 'span 5', invest: 'span 4', limit: 'span 3', score: 'span 3' },
  tablet: { saldo: '1 / -1', kpis: '1 / -1', chart: '1 / -1', pie: 'span 6', limit: 'span 6', cards: '1 / -1', score: 'span 6', invest: 'span 6' },
  mobile: {},
};
const MOBILE_ORDER: Block[] = ['saldo', 'kpis', 'limit', 'cards', 'pie', 'chart', 'tx', 'score', 'invest'];

const DIALOGS = {
  transfer: { title: 'Transferir via Pix', desc: 'O dinheiro cai na hora, 24h por dia.', keyLabel: 'Chave Pix', keyPlaceholder: 'CPF, e-mail, celular ou chave aleatória', cta: 'Continuar', doneTitle: 'Pix enviado', doneDesc: 'Você recebe o comprovante por e-mail.' },
  request: { title: 'Solicitar via Pix', desc: 'Gere uma cobrança para enviar a quem vai te pagar.', keyLabel: 'Descrição (opcional)', keyPlaceholder: 'Ex.: Jantar de sexta', cta: 'Gerar cobrança', doneTitle: 'Cobrança criada', doneDesc: 'Link e QR Code copiados. É só compartilhar.' },
};
const MASK = 'R$ ••••••';

export default function OverviewPage() {
  const { mode, nav, openChat } = useShell();
  const isMobile = mode === 'mobile';
  const userName = (useApp((s) => s.user?.name) ?? '').split(' ')[0];
  const hydrated = useHydrated();
  const root = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  useEnter(root);

  const [hide, setHide] = useState(false);
  const [dialog, setDialog] = useState<keyof typeof DIALOGS | null>(null);
  const [step, setStep] = useState<'form' | 'done'>('form');
  const [pixValue, setPixValue] = useState('');
  const [cardIdx, setCardIdx] = useState(0);

  const L = (k: Block): CSSProperties => ({
    gridColumn: LAYOUT[mode][k] ?? '1 / -1',
    order: isMobile ? MOBILE_ORDER.indexOf(k) : 0,
  });
  const hour = hydrated ? new Date().getHours() : 12;
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  const total = vm.total(), m = MOCK.insights.monthly, cur = m[m.length - 1]!, lt = MOCK.insights.spendingLimit;
  const used = (cur.expenses / lt) * 100;
  const cards = vm.cards(), score = vm.score(), invest = vm.invest(), spark = vm.path(vm.series('1M'), 300, 64);

  const openDialog = (d: keyof typeof DIALOGS) => {
    setDialog(d);
    setStep('form');
    setPixValue('');
  };
  const actions = [
    { label: 'Transferir', icon: 'send', bg: 'var(--primary)', fg: 'var(--primary-foreground)', border: 'transparent', go: () => openDialog('transfer') },
    { label: 'Solicitar', icon: 'arrow-down-left', bg: 'var(--muted)', fg: 'var(--foreground)', border: 'var(--border)', go: () => openDialog('request') },
    { label: 'Boleto', icon: 'barcode', bg: 'var(--accent)', fg: '#000', border: 'transparent', go: () => nav('boleto') },
    { label: 'Pagar contas', icon: 'calendar-days', bg: 'var(--muted)', fg: 'var(--foreground)', border: 'var(--border)', go: () => nav('bills') },
  ];
  const d = DIALOGS[dialog ?? 'transfer'];

  const scrollToCard = (i: number) => {
    const el = cardsRef.current, c = el?.children[i] as HTMLElement | undefined;
    if (el && c) el.scrollTo({ left: c.offsetLeft - el.offsetLeft - 4, behavior: 'smooth' });
  };

  return (
    <div ref={root} className="flex flex-col gap-4">
      <section data-anim="" className="mb-1 flex flex-wrap items-center gap-3.5">
        <div className="relative size-[76px] shrink-0 overflow-visible rounded-[22px] bg-brand-soft">
          <PlutoMascot scene="wave" phrases={['Miau! Seu resumo está pronto.', 'Seu saldo subiu 6,8%!', 'Delivery passou do limite…', 'Prrr… carinho aceito.']} />
        </div>
        <div className="min-w-[200px] flex-1">
          <h1 className="m-0 text-[clamp(22px,5vw,30px)] leading-[1.15] font-bold tracking-[-0.035em]">
            {greeting}, {userName}!
          </h1>
          <p className="mt-1 mb-0 text-sm text-pretty text-muted-foreground">A Pluto preparou seu resumo de hoje.</p>
        </div>
        {!isMobile && (
          <div className="flex items-center gap-2.5">
            <span className="text-sm text-muted-foreground">16 out. 2026</span>
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
            <span className="text-[15px] font-medium text-muted-foreground">Saldo total</span>
            <button onClick={() => setHide(!hide)} aria-label={hide ? 'Mostrar valores' : 'Esconder valores'} className="icon-btn">
              <Icon icon={hide ? 'eye-off' : 'eye'} size={17} />
            </button>
          </div>
          <div>
            <CountUp value={total} text={hide ? MASK : undefined} className="block text-[clamp(34px,8vw,44px)] leading-[1.05] font-bold tracking-[-0.045em] tabular-nums" />
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-[3px] rounded-full bg-accent px-[9px] py-1 text-xs font-semibold text-black">
                <Icon icon="arrow-up-right" size={13} />
                6,8%
              </span>
              <span className="text-[13px] text-muted-foreground">vs. setembro · atualizado há 5 min</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {actions.map((a) => (
              <button key={a.label} onClick={a.go} className="group flex cursor-pointer flex-col items-center gap-2 border-0 bg-transparent py-1 text-xs font-semibold text-foreground">
                <span
                  className="grid size-[54px] place-items-center rounded-full transition-transform group-hover:scale-105"
                  style={{ background: a.bg, color: a.fg, border: `1px solid ${a.border}` }}
                >
                  <Icon icon={a.icon} size={20} />
                </span>
                {a.label}
              </button>
            ))}
          </div>
          <div className="border-t border-border pt-4">
            <div className="mb-3 text-[13px] font-medium text-muted-foreground">Contas conectadas · Open Finance</div>
            <div className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1">
              {vm.banks().map((b) => (
                <div key={b.id} className="flex flex-[1_0_148px] snap-start flex-col gap-2.5 rounded-[14px] border border-border p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: b.color }}>
                      {b.initials}
                    </span>
                    <span className="text-sm font-semibold whitespace-nowrap">{b.bank}</span>
                  </div>
                  <div className="text-[17px] font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums">{hide ? MASK : b.balance}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-[7px] rounded-full" style={{ background: b.dot }} />
                    {b.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2" style={{ ...L('kpis'), gap: isMobile ? 10 : 16 }}>
          {vm.kpis().map((k) => (
            <div
              key={k.label}
              data-anim=""
              className="flex min-w-0 flex-col justify-between gap-4 rounded-2xl"
              style={{ background: k.bg, color: k.fg, border: `1px solid ${k.border}`, padding: isMobile ? 14 : 20 }}
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="grid size-9 place-items-center rounded-full" style={{ background: k.iconBg }}>
                  <Icon icon={k.icon} size={17} />
                </span>
                <span className="inline-flex items-center gap-[3px] rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap" style={{ background: k.badgeBg, color: k.badgeFg }}>
                  <Icon icon={k.arrow} size={13} />
                  {k.change}
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{k.label}</div>
                <div className="mt-1 truncate leading-[1.15] font-bold tracking-[-0.04em] tabular-nums" style={{ fontSize: isMobile ? 19 : 26 }}>
                  {hide ? MASK : k.value}
                </div>
                <div className="mt-1 text-xs" style={{ color: k.subFg }}>
                  vs. setembro
                </div>
              </div>
            </div>
          ))}
        </div>

        <div data-anim="" className="min-w-0" style={L('chart')}>
          <RevenueChart />
        </div>
        <div data-anim="" className="min-w-0" style={L('pie')}>
          <CategoryChart />
        </div>

        {/* Limite */}
        <div data-anim="" className="card flex flex-col gap-3.5" style={L('limit')}>
          <div className="flex items-center justify-between">
            <span className="card-title">Limite de gastos</span>
            <button onClick={() => nav('budget')} className="h-10 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-text">
              Ajustar
            </button>
          </div>
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-[28px] font-bold tracking-[-0.04em] tabular-nums">{fmt(cur.expenses)}</span>
            <span className="text-sm text-muted-foreground">de {fmt(lt)}</span>
          </div>
          <div role="progressbar" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100} aria-label="Limite usado" className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div data-grow="" className="h-full origin-left rounded-full bg-brand" style={{ width: `${Math.min(used, 100).toFixed(1)}%` }} />
          </div>
          <div className="flex justify-between gap-2 text-[13px] text-muted-foreground">
            <span>{used.toFixed(1).replace('.', ',')}% usado</span>
            <span>
              Restam <strong className="text-foreground">{fmt(lt - cur.expenses)}</strong>
            </span>
          </div>
        </div>

        {/* Cartões */}
        <div data-anim="" className="card flex flex-col gap-4" style={L('cards')}>
          <div className="flex items-center justify-between">
            <span className="card-title">Meus cartões</span>
            <button onClick={() => nav('cards')} className="btn btn-outline h-10 gap-1.5 px-3.5 text-[13px]">
              <Icon icon="plus" size={15} />
              Adicionar
            </button>
          </div>
          <div
            ref={cardsRef}
            onScroll={(e) => {
              const el = e.currentTarget, w = el.firstElementChild ? (el.firstElementChild as HTMLElement).offsetWidth + 14 : 1;
              const i = Math.round(el.scrollLeft / w);
              if (i !== cardIdx) setCardIdx(i);
            }}
            className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3.5 overflow-x-auto overscroll-x-contain px-1"
          >
            {cards.map((c) => (
              <div key={c.id} className="flex min-w-0 snap-start flex-col gap-2.5" style={{ flex: `0 0 ${isMobile ? '84%' : 'calc(50% - 7px)'}` }}>
                <div onClick={() => nav('cards')} className="cursor-pointer">
                  <CreditCard card={c} />
                </div>
                <div className="flex justify-between gap-2 text-[13px]">
                  <span className="text-muted-foreground">Fatura · vence {c.due}</span>
                  <strong className="tabular-nums">{c.bill}</strong>
                </div>
              </div>
            ))}
          </div>
          {isMobile && (
            <div className="flex justify-center gap-1.5">
              {cards.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => scrollToCard(i)}
                  aria-label={`Ver cartão ${c.bank}`}
                  className="h-2 cursor-pointer rounded-full border-0 p-0 transition-all"
                  style={{ width: i === cardIdx ? 22 : 8, background: i === cardIdx ? '#7D39EB' : 'var(--border)' }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Score */}
        <div data-anim="" className="card flex flex-col gap-3.5" style={L('score')}>
          <div className="flex items-center justify-between">
            <span className="card-title">Score de crédito</span>
            <span className="rounded-full border border-border px-[9px] py-[3px] text-xs text-muted-foreground">Serasa</span>
          </div>
          <div className="relative mx-auto w-full max-w-[260px]">
            <svg viewBox="0 0 220 122" className="block w-full" role="img" aria-label={`Score ${score.value}, faixa ${score.band}`}>
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="#FCA5A5" strokeWidth={14} strokeDasharray="83.7 400" />
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="#D4D4D8" strokeWidth={14} strokeDasharray="55.4 400" strokeDashoffset={-85.4} />
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="#7D39EB" strokeWidth={14} strokeDasharray="55.4 400" strokeDashoffset={-141.9} />
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="#C6FF33" strokeWidth={14} strokeDasharray="84.3 400" strokeDashoffset={-198.5} />
              <circle cx={score.cx} cy={score.cy} r="9" fill="var(--card)" stroke="var(--foreground)" strokeWidth={4} />
            </svg>
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1">
              <span className="text-4xl leading-none font-bold tracking-[-0.04em]">{score.value}</span>
              <span className="rounded-full bg-accent px-2.5 py-[3px] text-xs font-semibold text-black">{score.band}</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-1.5 text-[11px] text-muted-foreground">
            {[
              ['#FCA5A5', 'Baixo'],
              ['#D4D4D8', 'Regular'],
              ['#7D39EB', 'Bom'],
              ['#C6FF33', 'Excelente'],
            ].map(([c, l]) => (
              <span key={l} className="flex items-center gap-1">
                <span className="size-[7px] rounded-full" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
          <PlutoTip text={score.tip} />
        </div>

        {/* Investimentos */}
        <div data-anim="" className="card flex flex-col gap-3.5" style={L('invest')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="card-title">Carteira B3</div>
              <div className="mt-1 text-[13px] text-muted-foreground">Cotações com atraso de 15 min</div>
            </div>
            <div className="flex shrink-0 flex-col items-end">
              <div className="text-xl font-bold tracking-[-0.035em] tabular-nums">{invest.totalText}</div>
              <span className="mt-1 inline-flex items-center gap-[3px] rounded-full bg-accent px-[9px] py-[3px] text-xs font-semibold text-black">
                <Icon icon="arrow-up-right" size={13} />
                {invest.dayChange} hoje
              </span>
            </div>
          </div>
          <svg viewBox="0 0 300 64" preserveAspectRatio="none" className="block h-16 w-full" aria-hidden="true">
            <defs>
              <linearGradient id="ovGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#7D39EB" stopOpacity="0.22" />
                <stop offset="1" stopColor="#7D39EB" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={spark.area} fill="url(#ovGrad)" />
            <path d={spark.line} fill="none" stroke="#7D39EB" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="flex flex-col">
            {vm.assets().map((s) => (
              <div key={s.symbol} className="flex min-h-14 items-center gap-3 border-t border-border">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-[11px] font-bold">{s.short}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{s.symbol}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.name}</div>
                </div>
                <div className="flex flex-col items-end gap-[3px]">
                  <div className="text-sm font-semibold tabular-nums">{s.price}</div>
                  <span className="badge" style={{ background: s.badgeBg, color: s.badgeFg }}>
                    {s.change}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div data-anim="" className="min-w-0" style={{ gridColumn: '1 / -1', order: isMobile ? MOBILE_ORDER.indexOf('tx') : 0 }}>
          <LiveTransactionList mode={mode} limit={6} controls={false} onShowAll={() => nav('tx')} onConnect={() => nav('settings')} />
        </div>
      </div>

      {dialog && (
        <Sheet onClose={() => setDialog(null)} label={d.title} width={440} top="18vh" gap={18}>
          {step === 'form' ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-bold tracking-[-0.02em]">{d.title}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{d.desc}</div>
                </div>
                <button onClick={() => setDialog(null)} aria-label="Fechar" className="icon-btn">
                  <Icon icon="x" size={16} />
                </button>
              </div>
              <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                {d.keyLabel}
                <input placeholder={d.keyPlaceholder} className="input" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                Valor
                <input
                  value={pixValue}
                  onChange={(e) => setPixValue(maskMoney(e.target.value).text)}
                  inputMode="numeric"
                  placeholder="R$ 0,00"
                  className="input h-14 text-2xl font-bold"
                />
              </label>
              <div className="text-[13px] text-muted-foreground">
                Saldo disponível no Nubank: <strong className="text-foreground">{fmt(MOCK.pluggy.accounts[0]!.balance)}</strong>
              </div>
              <div className="flex justify-end gap-2.5">
                <button onClick={() => setDialog(null)} className="btn btn-outline h-12 max-w-40 flex-1 text-[15px]">
                  Cancelar
                </button>
                <button onClick={() => setStep('done')} className="btn btn-primary h-12 max-w-[200px] flex-1 px-5 text-[15px]">
                  {d.cta}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-accent text-black">
                <Icon icon="check" size={26} />
              </span>
              <div className="text-xl font-bold">{d.doneTitle}</div>
              <div className="text-sm text-muted-foreground">{d.doneDesc}</div>
              <button onClick={() => setDialog(null)} className="btn btn-primary mt-1.5 h-12 px-6 text-[15px]">
                Fechar
              </button>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
