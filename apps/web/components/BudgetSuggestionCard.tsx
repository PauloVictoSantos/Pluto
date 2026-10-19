'use client';

import { categoryOf, type BudgetSuggestion } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { maskMoney } from '@/lib/format';
import { money } from '@/lib/queries';
import { Why } from './Insight';
import { Icon } from './ui/Icon';

/**
 * Limites sugeridos por categoria (aba Orcamento). E um rascunho editavel: nada vale ate o usuario
 * tocar em "Aceitar limites" (RN-M06).
 */
export function BudgetSuggestionCard({ month }: { month: string }) {
  const q = useQuery({ queryKey: ['analytics', 'budget'], queryFn: api.budgetSuggestion });
  const s = q.data;
  if (q.isPending) return <div className="card h-40 animate-pulse" aria-busy="true" />;
  if (q.isError || !s) return null;
  if (s.status === 'learning')
    return (
      <div data-anim="" className="card flex flex-col gap-1">
        <div className="card-title">Limites sugeridos</div>
        <div className="text-sm text-muted-foreground">Precisamos de pelo menos 2 meses completos de gastos para sugerir limites pelo seu hábito.</div>
      </div>
    );
  // key: recria o rascunho quando a sugestao do servidor muda.
  return <Draft key={s.lines.map((l) => `${l.categoryKey}${l.limitMinor}`).join()} s={s} month={month} />;
}

function Draft({ s, month }: { s: BudgetSuggestion; month: string }) {
  const qc = useQueryClient();
  const [values, setValues] = useState(() => Object.fromEntries(s.lines.map((l) => [l.categoryKey, maskMoney(String(l.limitMinor))])));
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const total = Object.values(values).reduce((t, v) => t + Math.round(v.value * 100), 0);
  const accept = useMutation({
    mutationFn: () => api.putBudget(month, Object.entries(values).map(([categoryKey, v]) => ({ categoryKey, limitMinor: Math.round(v.value * 100) }))),
    onSuccess: () => {
      setDone(true);
      void qc.invalidateQueries({ queryKey: ['budgets'] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar. Tente de novo.'),
  });

  return (
    <div data-anim="" className="card flex flex-col gap-3">
      <div>
        <div className="card-title">Limites sugeridos</div>
        <div className="mt-1 text-[13px] text-muted-foreground">
          {s.fits
            ? `Perto do que você costuma gastar, cabendo em ${money(Math.max(0, s.availableMinor))} por mês.`
            : `Nem os seus meses mais econômicos cabem nos ${money(Math.max(0, s.availableMinor))} que sobram. Mostramos o mínimo de cada categoria.`}
        </div>
      </div>
      <div className="flex flex-col">
        {s.lines.map((l) => {
          const c = categoryOf(l.categoryKey), v = values[l.categoryKey]!;
          const cut = l.q60Minor - Math.round(v.value * 100);
          return (
            <div key={l.categoryKey} className="flex min-h-14 items-center gap-3 border-t border-border py-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                <Icon icon={c.icon} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{c.label}</div>
                <div className="text-xs text-muted-foreground">
                  Você costuma gastar {money(l.q60Minor)}
                  {cut > 1000 ? ` · ${money(cut)} a menos` : ''}
                </div>
              </div>
              <input
                value={v.text}
                onChange={(e) => setValues((x) => ({ ...x, [l.categoryKey]: maskMoney(e.target.value) }))}
                inputMode="numeric"
                aria-label={`Limite de ${c.label}`}
                className="input h-11 w-32 text-right tabular-nums"
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">Total</span>
        <strong className="tabular-nums">{money(total)}</strong>
      </div>
      <Why>
        <div className="flex flex-col gap-1">
          <span>Receita mediana dos últimos {s.months} meses: {money(s.incomeMedianMinor)}</span>
          <span>− contas fixas e parcelas: {money(s.fixedMinor)}</span>
          <span>− aportes das metas: {money(s.goalsMinor)}</span>
          <span>= disponível para gastos do dia a dia: {money(s.availableMinor)}</span>
          <span>
            Cada limite parte do valor que você não passa em 6 de cada 10 meses. Se não couber, o corte vai mais para as categorias que variam muito de um mês
            para outro e menos para as estáveis, como mercado. Nenhum limite fica abaixo do seu mês mais econômico.
          </span>
        </div>
      </Why>
      {error && (
        <div role="alert" className="text-[13px] text-danger-text">
          {error}
        </div>
      )}
      <button onClick={() => accept.mutate()} disabled={accept.isPending || done} className="btn btn-primary h-12">
        <Icon icon="check" size={16} />
        {done ? 'Limites aplicados' : accept.isPending ? 'Salvando…' : 'Aceitar limites'}
      </button>
    </div>
  );
}
