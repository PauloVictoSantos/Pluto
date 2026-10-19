'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { daysBetween, fmtDay } from '@/lib/format';
import { money } from '@/lib/queries';
import { Why } from './Insight';

const pctText = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;

/**
 * Ordem recomendada de pagamento e custo de atrasar (topo de Contas a pagar). Com dinheiro curto,
 * paga primeiro o que custa mais por real atrasado: o rotativo do cartao quase sempre vem antes.
 */
export function PaymentPlanCard({ today }: { today: string }) {
  const q = useQuery({ queryKey: ['analytics', 'payments'], queryFn: api.paymentPlan });
  const p = q.data;
  if (q.isPending) return <div className="card h-32 animate-pulse" aria-busy="true" />;
  if (q.isError || !p || !p.items.length) return null;

  return (
    <section data-anim="" className="card flex flex-col gap-2" aria-label="Ordem recomendada de pagamento">
      <div className="card-title">Em que ordem pagar</div>
      <div className="text-[13px] text-muted-foreground">
        {p.short
          ? `Seu saldo em conta (${money(p.availableMinor)}) não cobre tudo (${money(p.totalDueMinor)}). Pague nesta ordem: o que custa mais caro atrasar vem primeiro.`
          : `Seu saldo em conta cobre as ${p.items.length} contas em aberto. Se precisar escolher, esta é a ordem que custa menos.`}
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {p.items.map((it, i) => {
          const diff = daysBetween(today, it.dueDate);
          const partial = p.short && it.payMinor < it.amountMinor;
          return (
            <li key={it.id} className="flex min-h-14 items-center gap-3 border-t border-border py-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{it.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {diff < 0 ? `Venceu ${fmtDay(it.dueDate)}` : diff === 0 ? 'Vence hoje' : `Vence ${fmtDay(it.dueDate)}`} · atrasar 30 dias custa{' '}
                  <strong className="text-foreground">{money(it.cost30Minor)}</strong>
                </div>
                {partial && (
                  <div className="mt-0.5 text-xs text-danger-text">
                    {it.payMinor > 0 ? `O saldo cobre ${money(it.payMinor)} desta conta.` : 'O saldo não alcança esta conta.'}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-[15px] font-semibold tabular-nums">{money(it.amountMinor)}</span>
            </li>
          );
        })}
      </ol>
      <Why>
        <div className="flex flex-col gap-1">
          <span>
            Custo de atrasar = juros do período + multa e, no cartão, IOF de 0,38% + 0,0082% ao dia. Em 30 dias, cada R$ 100 custa{' '}
            {p.items.map((it) => `${pctText(it.costPerReal)} em ${it.label}`).join('; ')}.
          </span>
          <span>
            O Open Finance não informa os juros do rotativo da sua fatura, então usamos {pctText(p.revolvingRateMonthly)} ao mês, típico no Brasil. Nos
            boletos: multa de 2% e juros de 1% ao mês, salvo outro valor no cadastro.
          </span>
        </div>
      </Why>
    </section>
  );
}
