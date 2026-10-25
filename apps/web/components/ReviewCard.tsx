'use client';

import { CATEGORIES, TX_PAYMENT_LABEL, categoryOf, type Transaction } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDay } from '@/lib/format';
import { merchantInfo, MerchantLogo } from '@/lib/merchants';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';

// "Revisar" (doc. Melhorias, passo 8): gastos com categoria incerta (< 70%), como Pix para pessoas.
// Um toque confirma; a escolha vira regra para aquele destinatario e os proximos ja chegam certos.

const SPEND = CATEGORIES.filter((c) => c.group === 'essential' || c.group === 'lifestyle');

export function ReviewCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['transactions', 'review'], queryFn: () => api.transactions({ review: '1', limit: 20 }) });
  const confirm = useMutation({
    mutationFn: ({ t, key }: { t: Transaction; key: string }) => api.setCategory(t.id, key, true),
    onSuccess: () => {
      for (const k of ['transactions', 'dashboard', 'budgets', 'analytics', 'spending', 'category-rules', 'agent-chat']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section data-anim="" className="card flex flex-col" aria-label="Revisar categorias">
      <div className="flex items-center gap-2">
        <span className="card-title">Revisar</span>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-semibold text-brand-text">{items.length}{q.data?.nextCursor ? '+' : ''}</span>
      </div>
      <div className="mt-1 mb-1 text-[13px] text-muted-foreground">A Pluto não teve certeza do que estes pagamentos foram. Confirme com um toque: a escolha vale para os próximos do mesmo destinatário.</div>
      {items.map((t) => {
        const m = merchantInfo(t);
        const s = t.suggestion;
        return (
          <div key={t.id} className="flex flex-wrap items-center gap-3 border-t border-border py-2.5">
            <MerchantLogo brand={m.brand} categoryKey={t.categoryKey} size={36} />
            <span className="min-w-[140px] flex-1">
              <span className="block truncate text-[14px] font-semibold">{m.name}</span>
              <span className="block text-[12px] text-muted-foreground">
                {[t.paymentMethod ? TX_PAYMENT_LABEL[t.paymentMethod] : null, fmtDay(new Date(t.date).toISOString().slice(0, 10)), money(Math.abs(t.amountMinor))].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {s && (
                <button onClick={() => confirm.mutate({ t, key: s.categoryKey })} disabled={confirm.isPending} className="btn btn-primary h-9 px-3 text-[13px]">
                  <Icon icon="check" size={14} />É {categoryOf(s.categoryKey).label}
                </button>
              )}
              <select
                value=""
                onChange={(e) => e.target.value && confirm.mutate({ t, key: e.target.value })}
                aria-label={`Categoria de ${m.name}`}
                className="input h-9 w-auto py-0 text-[13px]"
              >
                <option value="">{s ? 'Outra categoria' : 'Escolher categoria'}</option>
                {SPEND.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </span>
          </div>
        );
      })}
    </section>
  );
}
