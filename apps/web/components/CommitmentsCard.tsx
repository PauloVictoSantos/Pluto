'use client';

import { categoryOf, type Commitments } from '@pluto/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDay } from '@/lib/format';
import { money, useTz } from '@/lib/queries';
import { ymdIn } from '@/lib/datetime';
import { Icon } from './ui/Icon';

const PERIOD: Record<Commitments['recurring'][number]['period'], string> = { 7: 'toda semana', 14: 'a cada 2 semanas', 30: 'todo mês', 365: 'todo ano' };

/**
 * Compromissos ja conhecidos: contas fixas/assinaturas detectadas e parcelas que ainda vao cair.
 * Cada linha mostra o porque (RN-G06): quantas vezes apareceu e de quanto em quanto tempo.
 */
export function CommitmentsCard() {
  const tz = useTz();
  const q = useQuery({ queryKey: ['analytics', 'commitments'], queryFn: api.commitments });
  const out = (q.data?.recurring ?? []).filter((r) => r.direction === 'out');
  const inc = (q.data?.recurring ?? []).filter((r) => r.direction === 'in');
  const inst = q.data?.installments ?? [];
  const monthlyOut = out.reduce((s, r) => s + (r.period === 365 ? 0 : Math.round((r.amountMinor * 30) / r.period)), 0);
  const instMonth = inst.reduce((s, i) => s + i.amountMinor, 0);

  return (
    <div data-anim="" className="card flex flex-col gap-1">
      <div className="card-title">Compromissos que já sabemos</div>
      <div className="mb-2 text-[13px] text-muted-foreground">
        {q.isPending
          ? 'Procurando contas fixas e parcelas…'
          : q.isError
            ? 'Não foi possível carregar agora. Tente de novo em instantes.'
            : out.length || inst.length
              ? `Cerca de ${money(-(monthlyOut + instMonth))} por mês já estão comprometidos com contas fixas e parcelas.`
              : 'Ainda não há contas fixas nem parcelas por vir. Uma conta fixa aparece aqui depois de 3 meses no mesmo valor.'}
      </div>

      {[
        { title: 'Contas fixas e assinaturas', list: out },
        { title: 'Entradas recorrentes', list: inc },
      ].map(
        (g) =>
          g.list.length > 0 && (
            <section key={g.title} aria-label={g.title} className="flex flex-col">
              <div className="pt-2 pb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{g.title}</div>
              {g.list.map((r) => {
                const c = categoryOf(r.categoryKey);
                return (
                  <div key={`${r.direction}${r.label}${r.period}`} className="flex min-h-14 items-center gap-3 border-t border-border py-2">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                      <Icon icon={c.icon} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{r.label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {PERIOD[r.period]} · próxima {fmtDay(ymdIn(r.nextDate, tz))}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Por quê: {r.count} vezes, {PERIOD[r.period]}, sempre perto do mesmo valor
                        {r.key === 'destinatario' ? ' e para o mesmo destinatário' : ''}.
                      </div>
                    </div>
                    <span className="shrink-0 text-[15px] font-semibold tabular-nums" style={{ color: r.direction === 'in' ? 'var(--brand-text)' : undefined }}>
                      {money(Math.abs(r.amountMinor))}
                    </span>
                  </div>
                );
              })}
            </section>
          ),
      )}

      {inst.length > 0 && (
        <section aria-label="Parcelas por vir" className="flex flex-col">
          <div className="pt-2 pb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Parcelas por vir</div>
          {inst.map((i) => (
            <div key={i.groupId} className="flex min-h-14 items-center gap-3 border-t border-border py-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                <Icon icon="credit-card" size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{i.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Parcela {i.n} de {i.total} · falta{i.remaining > 1 ? 'm' : ''} {i.remaining} · {money(Math.abs(i.remainingMinor))} no total
                </div>
              </div>
              <span className="shrink-0 text-[15px] font-semibold tabular-nums">{money(Math.abs(i.amountMinor))}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
