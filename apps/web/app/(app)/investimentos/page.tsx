'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { InvestmentBoxesCard } from '@/components/InvestmentBoxesCard';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { useShell } from '@/components/shell/ShellContext';
import { CountUp } from '@/components/ui/CountUp';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { fmtDayFull, hidePct } from '@/lib/format';
import { useEnter } from '@/lib/motion';
import { monthLong, money, useInvestments, useSummary } from '@/lib/queries';

// Secao 5.4: o app informa e organiza; nao recomenda produtos nem emite aconselhamento.
const TYPE_LABEL: Record<string, string> = {
  FIXED_INCOME: 'Renda fixa', STOCK: 'Ações', FUND: 'Fundos', ETF: 'ETFs', CRYPTO: 'Cripto', OTHER: 'Outros',
};
const TYPE_COLOR: Record<string, string> = {
  FIXED_INCOME: '#C6FF33', STOCK: '#7D39EB', FUND: '#B18CF7', ETF: '#9A68F2', CRYPTO: '#F59E0B', OTHER: '#A1A1AA',
};
const pctText = (v: number) => hidePct(`${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`);

export default function InvestimentosPage() {
  const { mode, nav } = useShell();
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);
  const inv = useInvestments();
  const summary = useSummary();
  const d = inv.data;
  // Boletos pagos com destino "para investir" (a Pluto so separa o valor; nao aplica).
  const charges = useQuery({ queryKey: ['charges'], queryFn: api.charges });
  const toInvestMinor = (charges.data ?? []).filter((c) => c.destination === 'INVESTMENT').reduce((s, c) => s + c.paidMinor, 0);
  const gain = d && d.appliedMinor ? ((d.totalMinor - d.appliedMinor) / d.appliedMinor) * 100 : null;
  const monthlyInvested = summary.data?.monthly ?? [];
  const names = (summary.data?.banks ?? []).map((b) => b.institutionName.replace(/\s+INSTITUI.*$/i, ''));
  const banks = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0];

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-col gap-1">
        <h1 className="page-title">Investimentos</h1>
        <p className="m-0 text-sm text-muted-foreground">Posições informadas pelas instituições via Open Finance</p>
      </div>

      {toInvestMinor > 0 && (
        <div data-anim="" className="card flex flex-wrap items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-black">
            <Icon icon="barcode" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-muted-foreground">Recebido por boleto para investir</div>
            <div className="text-xl font-bold tracking-[-0.03em] tabular-nums">{money(toInvestMinor)}</div>
          </div>
          <button onClick={() => nav('boleto')} className="btn btn-outline">
            Ver boletos
          </button>
        </div>
      )}

      {d && d.items.length === 0 && (
        <div data-anim="" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <PlutoLogo size={72} />
          <div className="text-[17px] font-semibold">Nenhum investimento nas suas conexões</div>
          <div className="max-w-[420px] text-sm text-pretty text-muted-foreground">
            {banks ? `${banks} não informaram posições de investimento.` : 'Suas instituições conectadas não informaram posições de investimento.'} Se você investe por uma corretora, conecte-a no Meu Pluggy e importe o Item ID em Configurações.
          </div>
          <button onClick={() => nav('settings')} className="btn btn-outline mt-1">
            <Icon icon="plus" size={16} />
            Conectar instituição
          </button>
        </div>
      )}

      <InvestmentBoxesCard />

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,7fr) minmax(0,5fr)' : 'minmax(0,1fr)' }}>
        <div className="flex min-w-0 flex-col gap-4">
          {d && d.items.length > 0 && (
            <div data-anim="" className="card flex flex-col gap-4">
              <div>
                <div className="text-[15px] font-medium text-muted-foreground">Patrimônio investido</div>
                <CountUp key={d.totalMinor} value={d.totalMinor / 100} className="mt-1.5 block text-[clamp(30px,7vw,40px)] font-bold tracking-[-0.045em] tabular-nums" />
                {gain !== null && (
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-[3px] rounded-full px-[9px] py-1 text-xs font-semibold"
                      style={{ background: gain >= 0 ? '#C6FF33' : 'var(--danger-soft)', color: gain >= 0 ? '#000' : 'var(--danger-text)' }}
                    >
                      <Icon icon={gain >= 0 ? 'arrow-up-right' : 'arrow-down-right'} size={13} />
                      {pctText(gain)}
                    </span>
                    <span className="text-[13px] text-muted-foreground">sobre {money(d.appliedMinor)} aplicados</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div data-anim="" className="card flex flex-col gap-1.5">
            <div className="card-title mb-1.5">Aplicações e resgates pela conta</div>
            <div className="mb-1 text-[13px] text-muted-foreground">Dinheiro que saiu das suas contas para investimentos (resgates aparecem negativos).</div>
            {monthlyInvested.map((m) => (
              <div key={m.month} className="flex min-h-12 items-center justify-between gap-3 border-t border-border text-sm">
                <span className="font-medium">{monthLong(m.month)}</span>
                <span className="font-semibold tabular-nums" style={{ color: m.investedMinor < 0 ? 'var(--danger-text)' : undefined }}>
                  {money(m.investedMinor)}
                </span>
              </div>
            ))}
          </div>

          {d && d.items.length > 0 && (
            <div data-anim="" className="card flex flex-col gap-1.5">
              <div className="card-title mb-1.5">Posições</div>
              {d.items.map((i) => {
                const g = i.appliedMinor ? ((i.currentValueMinor - i.appliedMinor) / i.appliedMinor) * 100 : null;
                return (
                  <div key={i.id} className="flex min-h-16 items-center gap-3 border-t border-border">
                    <span className="grid size-[42px] shrink-0 place-items-center rounded-xl text-[11px] font-bold" style={{ background: 'var(--muted)' }}>
                      {TYPE_LABEL[i.type]!.slice(0, 4).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{i.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[i.institutionName, i.rateInfo, i.dueDate ? `vence ${fmtDayFull(i.dueDate.toISOString())}` : null].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[15px] font-semibold tabular-nums">{money(i.currentValueMinor)}</span>
                      {g !== null && (
                        <span className="badge" style={{ background: g >= 0 ? '#C6FF33' : 'var(--danger-soft)', color: g >= 0 ? '#000' : 'var(--danger-text)' }}>
                          {pctText(g)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {d && d.items.length > 0 && (
          <div data-anim="" className="card flex flex-col gap-4">
            <div className="card-title">Alocação</div>
            <div className="flex h-3.5 gap-[3px] overflow-hidden rounded-full">
              {d.allocation.map((a) => (
                <div key={a.type} data-grow="" className="origin-left" style={{ width: `${((a.valueMinor / d.totalMinor) * 100).toFixed(1)}%`, background: TYPE_COLOR[a.type] }} />
              ))}
            </div>
            <div className="flex flex-col">
              {d.allocation.map((a) => (
                <div key={a.type} className="flex min-h-12 items-center gap-2.5 border-t border-border text-sm">
                  <span className="size-2.5 rounded-[3px]" style={{ background: TYPE_COLOR[a.type] }} />
                  <span className="flex-1">{TYPE_LABEL[a.type]}</span>
                  <span className="text-[13px] text-muted-foreground">{hidePct(`${((a.valueMinor / d.totalMinor) * 100).toFixed(0)}%`)}</span>
                  <strong className="min-w-[110px] text-right tabular-nums">{money(a.valueMinor)}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
