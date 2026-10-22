'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { money } from '@/lib/queries';

/**
 * Plano das metas (doc. Pluton 5.4, MT-04): a sobra do mes vai da meta de maior prioridade para a
 * menor ate acabar. O que fica sem aporte aparece em espera, com o motivo.
 */
export function GoalsPlanCard() {
  const q = useQuery({ queryKey: ['goals-plan'], queryFn: api.goalsPlan, refetchOnMount: 'always' });
  const p = q.data;
  if (!p || !p.goals.length) return null;
  const used = p.capacityMinor > 0 ? Math.min(1, p.allocatedMinor / p.capacityMinor) : 0;
  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Plano das metas">
      <div>
        <div className="card-title">Plano das metas</div>
        <div className="mt-1 text-[13px] text-muted-foreground">
          Sua sobra no mês é {money(p.capacityMinor)}. Ela vai primeiro para as metas de maior prioridade; a soma dos aportes nunca passa dela.
        </div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-label="Sobra comprometida com metas">
        <div className="h-full rounded-full bg-brand" style={{ width: `${used * 100}%` }} />
      </div>
      <div className="text-[12.5px] text-muted-foreground">
        {money(p.allocatedMinor)} em metas · {money(p.freeMinor)} livres
      </div>
      <div className="flex flex-col">
        {p.goals.map((g, i) => (
          <div key={g.goalId} className="flex items-center gap-3 border-t border-border py-2.5" style={{ opacity: g.status === 'pausada' ? 0.6 : 1 }}>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[12px] font-bold">{g.status === 'pausada' ? '–' : `${i + 1}º`}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{g.name}</span>
              <span className="block text-[12px]" style={{ color: g.waiting && g.status !== 'pausada' ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>
                {g.note}
              </span>
            </span>
            <span className="shrink-0 text-right text-[13px] tabular-nums">
              <span className="block font-semibold">{money(g.allocatedMinor)}</span>
              <span className="block text-[11.5px] text-muted-foreground">de {money(g.requiredMinor)}/mês</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
