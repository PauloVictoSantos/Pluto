'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';

// Sugestoes pelo historico de cupons (doc. Melhorias, passo 10): "Cafe: comprado a cada ~15 dias,
// ultimo ha 14 dias", com preco medio e onde saiu mais barato.

export function ShoppingInsightsCard() {
  const q = useQuery({ queryKey: ['shopping-insights'], queryFn: api.shoppingInsights });
  const items = (q.data ?? []).filter((i) => i.everyDays !== null).slice(0, 8);
  if (!items.length) return null;
  return (
    <section data-anim="" className="card flex flex-col" aria-label="Pelo seu histórico">
      <div className="card-title">Pelo seu histórico</div>
      <div className="mt-1 mb-1 text-[13px] text-muted-foreground">Calculado pelos cupons que você escaneou.</div>
      {items.map((i) => (
        <div key={i.itemId} className="flex items-center gap-3 border-t border-border py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: i.due ? 'var(--brand-soft)' : 'var(--muted)' }}>
            <Icon icon={i.due ? 'clock' : 'shopping-cart'} size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">
              {i.name}
              {i.due && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-text">hora de comprar</span>}
            </span>
            <span className="block text-[12px] text-muted-foreground">
              Comprado a cada ~{i.everyDays} dias, último há {i.lastDaysAgo} {i.lastDaysAgo === 1 ? 'dia' : 'dias'}
            </span>
            <span className="block text-[12px] text-muted-foreground">
              Preço médio {money(i.avgUnitPriceMinor)}
              {i.cheapest ? ` · mais barato em ${i.cheapest.store} (${money(i.cheapest.unitPriceMinor)})` : ''}
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}
