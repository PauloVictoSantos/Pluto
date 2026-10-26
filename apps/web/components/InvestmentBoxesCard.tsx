'use client';

import type { InvestmentBox } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { hidePct } from '@/lib/format';
import { money } from '@/lib/queries';
import { BankLogo } from './BankLogo';
import { Icon } from './ui/Icon';

// Caixinhas, porquinhos e investimentos: um card por aplicacao com o banco, quanto tem, a taxa, a
// meta ligada e quanto rende em 1 mes, 1 ano e 5 anos (bruto, antes do IR).

const pct = (r: number) => `${(r * 100).toFixed(2).replace('.', ',')}%`;
const prazo = (months: number) => (months < 12 ? `${months} ${months === 1 ? 'mês' : 'meses'}` : `${Math.floor(months / 12)} ano${months >= 24 ? 's' : ''}${months % 12 ? ` e ${months % 12} ${months % 12 === 1 ? 'mês' : 'meses'}` : ''}`);
const monthsUntil = (deadline: string) => {
  const d = new Date(`${deadline}T12:00:00Z`), n = new Date();
  return (d.getUTCFullYear() - n.getUTCFullYear()) * 12 + d.getUTCMonth() - n.getUTCMonth();
};

export function InvestmentBoxesCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['investment-boxes'], queryFn: api.investmentBoxes });
  const link = useMutation({
    mutationFn: ({ id, goalId }: { id: string; goalId: string | null }) => api.linkBoxGoal(id, goalId),
    onSuccess: (d) => qc.setQueryData(['investment-boxes'], d),
  });
  const d = q.data;
  if (q.isPending) return <div className="h-48 animate-pulse rounded-2xl bg-muted" />;
  if (!d || !d.items.length) return null;
  return (
    <section data-anim="" className="flex flex-col gap-3" aria-label="Suas caixinhas">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="card-title">Suas caixinhas</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">Quanto cada uma rende e para qual meta ela é.</div>
        </div>
        <div className="text-[12px] text-muted-foreground">
          {d.rates.source === 'bcb'
            ? `CDI ${pct(d.rates.cdi)} · Selic ${pct(d.rates.selic)} · IPCA ${pct(d.rates.ipca)} ao ano (Banco Central)`
            : `Banco Central indisponível: usando ${pct(d.rates.cdi)} ao ano (seu rendimento de referência)`}
        </div>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {d.items.map((b) => (
          <BoxCard key={b.id} b={b} goals={d.goals} busy={link.isPending} onLink={(goalId) => link.mutate({ id: b.id, goalId })} />
        ))}
      </div>
      <div className="text-[12px] text-muted-foreground">Rendimento bruto estimado, antes do IR, sem novos aportes. Taxas variam: é uma projeção, não uma promessa.</div>
    </section>
  );
}

function BoxCard({ b, goals, busy, onLink }: { b: InvestmentBox; goals: { id: string; name: string }[]; busy: boolean; onLink: (goalId: string | null) => void }) {
  const g = b.goal;
  const progress = g ? Math.min(1, g.savedMinor / Math.max(1, g.targetMinor)) : 0;
  const late = g?.deadline && g.monthsToTarget !== null ? g.monthsToTarget > monthsUntil(g.deadline) : false;
  return (
    <article className="card flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          <BankLogo name={b.institutionName} size={40} />
          <span className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full border-2 border-card bg-brand text-white">
            <Icon icon={b.kind === 'poupanca' ? 'wallet' : 'piggy-bank'} size={12} />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{b.name}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{b.institutionName || 'Instituição'}</span>
        </span>
      </div>
      <div>
        <div className="text-[24px] font-bold tracking-[-0.03em] tabular-nums">{money(b.valueMinor)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
          <span>{b.rateLabel}</span>
          <span>· {hidePct(pct(b.annualRate))} ao ano</span>
          {b.estimated && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px]">estimado</span>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['1 mês', b.projection.monthMinor],
            ['1 ano', b.projection.yearMinor],
            ['5 anos', b.projection.fiveYearsMinor],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="@container flex min-w-0 flex-col rounded-xl bg-muted px-2 py-2">
            <span className="text-[11px] leading-tight text-muted-foreground">Em {label}</span>
            {/* Encolhe com o bloco (cqi): o valor aparece inteiro, sem reticencias. */}
            <span className="text-[clamp(10px,13cqi,14px)] font-semibold whitespace-nowrap text-brand-text tabular-nums">+{money(v)}</span>
          </div>
        ))}
      </div>
      {g ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-border p-2.5">
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-1.5 font-semibold">
              <Icon icon="target" size={14} />
              <span className="truncate">{g.name}</span>
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {money(g.savedMinor)} de {money(g.targetMinor)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={`Progresso de ${g.name}`}>
            <div className="h-full rounded-full bg-brand" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="text-[12px]" style={{ color: late ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>
            {g.monthsToTarget === 0
              ? 'Meta alcançada.'
              : g.monthsToTarget === null
                ? 'Sem aporte mensal, o rendimento sozinho não chega no alvo.'
                : `Com o rendimento${g.monthlyMinor ? ` e ${money(g.monthlyMinor)} por mês` : ''}, chega em ~${prazo(g.monthsToTarget)}${late ? ', depois do prazo' : ''}.`}
          </div>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="shrink-0">Meta:</span>
        <select value={g?.id ?? ''} onChange={(e) => onLink(e.target.value || null)} disabled={busy} aria-label={`Meta da caixinha ${b.name}`} className="input h-9 min-w-0 flex-1 py-0 text-[13px]">
          <option value="">Sem meta ligada</option>
          {goals.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}
