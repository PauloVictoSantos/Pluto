'use client';

import { useEffect, useRef, useState } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { CreditCard } from '@/components/CreditCard';
import { useShell } from '@/components/shell/ShellContext';
import { TransactionList } from '@/components/TransactionList';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { fmt } from '@/lib/format';
import { vm } from '@/lib/mock/vm';
import { animate, pop, reducedMotion, useEnter } from '@/lib/motion';

const BANKS: [string, string][] = [
  ['Bradesco', 'CC092D'], ['Santander', 'EC0000'], ['C6 Bank', '242424'],
  ['Banco do Brasil', '0038A8'], ['Caixa', '005CA9'], ['BTG Pactual', '0B2A4A'],
];

export default function CartoesPage() {
  const { mode, nav } = useShell();
  const isMobile = mode === 'mobile';
  const [sel, setSel] = useState(0);
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});
  const [virtual, setVirtual] = useState(false);
  const [add, setAdd] = useState<'pick' | 'busy' | 'done' | null>(null);
  const [addBank, setAddBank] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const virtualRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const prevSel = useRef(0);
  const addTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEnter(root);

  useEffect(() => () => clearTimeout(addTimer.current), []);
  useEffect(() => {
    if (sel !== prevSel.current && detailRef.current && !reducedMotion()) animate(detailRef.current, { opacity: [0.4, 1], y: [8, 0] }, { duration: 0.3 });
    prevSel.current = sel;
  }, [sel]);
  useEffect(() => {
    if (virtual) pop(virtualRef.current, { opacity: [0, 1], y: [-8, 0] });
  }, [virtual]);

  const scrollTo = (i: number) => {
    const el = scroller.current, c = el?.children[i] as HTMLElement | undefined, first = el?.children[0] as HTMLElement | undefined;
    if (el && c && first) el.scrollTo({ left: c.offsetLeft - first.offsetLeft - (el.clientWidth - c.offsetWidth) / 2 + 6, behavior: 'smooth' });
  };
  const select = (i: number) => {
    setSel(i);
    setVirtual(false);
  };

  const cards = vm.cards().map((c) => {
    const isBlocked = blocked[c.id] ?? !c.active;
    return { ...c, isBlocked, status: isBlocked ? 'Bloqueado' : 'Ativo', statusBg: isBlocked ? 'rgba(255,255,255,.2)' : '#C6FF33', statusFg: isBlocked ? '#fff' : '#000' };
  });
  const c = cards[sel]!;

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Cartões</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            {cards.length} cartões · faturas somam {fmt(cards.reduce((t, x) => t + x.billNum, 0))}
          </p>
        </div>
        <button onClick={() => setAdd('pick')} className="btn btn-outline shrink-0">
          <Icon icon="plus" size={16} />
          Adicionar cartão
        </button>
      </div>

      <div data-anim="" className="flex flex-col gap-3">
        <div
          ref={scroller}
          onScroll={(e) => {
            if (!isMobile) return;
            const el = e.currentTarget, first = el.children[0] as HTMLElement | undefined, w = first ? first.offsetWidth + 14 : 1;
            const i = Math.max(0, Math.min(el.children.length - 1, Math.round(el.scrollLeft / w)));
            if (i !== sel) select(i);
          }}
          className="no-scrollbar flex snap-x snap-mandatory gap-3.5 overflow-x-auto overscroll-x-contain p-1.5"
        >
          {cards.map((x, i) => (
            <div
              key={x.id}
              onClick={() => {
                select(i);
                if (isMobile) scrollTo(i);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && select(i)}
              aria-pressed={i === sel}
              aria-label={`${x.bank} final ${x.last4}`}
              className="min-w-0 max-w-[360px] cursor-pointer snap-center transition-opacity"
              style={{ flex: `0 0 ${isMobile ? '84%' : '320px'}`, opacity: i === sel ? 1 : 0.6 }}
            >
              <CreditCard card={x} selected={i === sel} />
            </div>
          ))}
        </div>
        {isMobile && (
          <div className="flex justify-center gap-1.5">
            {cards.map((x, i) => (
              <button
                key={x.id}
                onClick={() => {
                  select(i);
                  scrollTo(i);
                }}
                aria-label={`Ver ${x.bank}`}
                className="h-2 cursor-pointer rounded-full border-0 p-0 transition-all"
                style={{ width: i === sel ? 22 : 8, background: i === sel ? '#7D39EB' : 'var(--border)' }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,5fr) minmax(0,7fr)' : 'minmax(0,1fr)' }}>
        <div ref={detailRef} className="card flex flex-col gap-[18px]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm text-muted-foreground">Fatura atual · {c.bank}</div>
              <div className="mt-1 text-[clamp(28px,7vw,36px)] font-bold tracking-[-0.04em] tabular-nums">{c.bill}</div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">
                Vence em {c.due} · {c.level}
              </div>
            </div>
            <span
              className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: c.isBlocked ? 'var(--danger-soft)' : '#C6FF33', color: c.isBlocked ? 'var(--danger-text)' : '#000' }}
            >
              {c.status}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-[13px]">
              <span className="text-muted-foreground">Limite usado</span>
              <span>
                <strong>{c.used}</strong> de {c.limit}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${c.usedPct.toFixed(1)}%` }} />
            </div>
            <div className="text-[13px] text-muted-foreground">
              Disponível: <strong className="text-foreground">{c.available}</strong>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: c.isBlocked ? 'Desbloquear' : 'Bloquear', icon: c.isBlocked ? 'lock-open' : 'lock', go: () => setBlocked((p) => ({ ...p, [c.id]: !c.isBlocked })), primary: false },
              { label: 'Pagar fatura', icon: 'receipt', go: () => nav('bills'), primary: true },
              { label: 'Cartão virtual', icon: 'smartphone', go: () => setVirtual(!virtual), primary: false },
            ].map((a) => (
              <button
                key={a.icon}
                onClick={a.go}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-[14px] px-1 py-3 text-[13px] font-semibold ${a.primary ? 'border-0 bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground hover:bg-muted'}`}
              >
                <Icon icon={a.icon} size={20} />
                {a.label}
              </button>
            ))}
          </div>
          {virtual && (
            <div ref={virtualRef} className="flex flex-col gap-2 rounded-[14px] bg-brand-soft px-4 py-3.5 text-sm">
              <div className="font-semibold text-brand-text">Cartão virtual · válido por 24h</div>
              <div className="font-mono text-base tracking-[0.08em]">5162 9031 7745 {String(7000 + +c.last4).slice(-4)}</div>
              <div className="flex gap-[18px] text-[13px] text-muted-foreground">
                <span>Validade 10/31</span>
                <span>CVV 482</span>
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <TransactionList key={c.id} mode={mode} accountId={c.id} title="Compras no cartão" controls={false} />
        </div>
      </div>

      {add && (
        <Sheet onClose={() => setAdd(null)} label="Conectar cartão" width={440} top="18vh" gap={14}>
          {add === 'pick' && (
            <>
              <div>
                <div className="text-xl font-bold tracking-[-0.02em]">Conectar cartão</div>
                <div className="mt-1 text-sm text-muted-foreground">Escolha o banco. A conexão é feita pelo Open Finance, com seu consentimento.</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {BANKS.map(([name, color]) => (
                  <button
                    key={name}
                    onClick={() => {
                      setAdd('busy');
                      setAddBank(name);
                      addTimer.current = setTimeout(() => setAdd('done'), 1400);
                    }}
                    className="flex h-14 cursor-pointer items-center gap-2.5 rounded-[14px] border border-border bg-card px-3 text-left text-sm font-semibold text-foreground hover:bg-muted"
                  >
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: '#' + color }}>
                      {name.slice(0, 2).toUpperCase()}
                    </span>
                    {name}
                  </button>
                ))}
              </div>
              <button onClick={() => setAdd(null)} className="btn btn-outline h-12 text-[15px]">
                Cancelar
              </button>
            </>
          )}
          {add === 'busy' && (
            <div className="flex flex-col items-center gap-3 py-5 text-center">
              <PlutoLogo size={64} />
              <div className="text-[17px] font-semibold">Conectando com {addBank}…</div>
              <div className="text-sm text-muted-foreground">Você vai autorizar no app do banco.</div>
            </div>
          )}
          {add === 'done' && (
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-accent text-black">
                <Icon icon="check" size={26} />
              </span>
              <div className="text-[19px] font-bold">Pedido enviado ao {addBank}</div>
              <div className="text-sm text-muted-foreground">Assim que você autorizar, o cartão aparece aqui.</div>
              <button onClick={() => setAdd(null)} className="btn btn-primary mt-1 h-12 px-6 text-[15px]">
                Fechar
              </button>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
