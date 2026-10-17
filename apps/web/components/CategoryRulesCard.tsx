'use client';

import { categoryOf } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Icon } from './ui/Icon';

/** Regras criadas ao recategorizar com "aplicar às parecidas" (RN-10). */
export function CategoryRulesCard() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['category-rules'], queryFn: api.categoryRules });
  const remove = useMutation({
    mutationFn: api.deleteCategoryRule,
    onSuccess: () => Promise.all(['category-rules', 'transactions', 'dashboard', 'budgets'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
  const list = rules.data ?? [];

  return (
    <div data-anim="" className="card flex flex-col">
      <div className="card-title">Regras de categoria</div>
      <div className="mt-1 mb-2 text-[13px] text-muted-foreground">
        Para criar uma regra, toque numa transação e escolha a categoria. Ex.: todo Pix para a faculdade vira Educação.
      </div>
      {rules.isPending && <div className="py-3 text-sm text-muted-foreground">Carregando…</div>}
      {!rules.isPending && list.length === 0 && <div className="border-t border-border py-4 text-sm text-muted-foreground">Nenhuma regra ainda.</div>}
      {list.map((r) => {
        const c = categoryOf(r.categoryKey);
        return (
          <div key={r.id} className="flex min-h-14 items-center gap-3 border-t border-border py-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
              <Icon icon={c.icon} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">“{r.matchKey}”</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {r.direction === 'out' ? 'Saídas' : 'Entradas'} → {c.label}
              </div>
            </div>
            <button
              onClick={() => remove.mutate(r.id)}
              disabled={remove.isPending}
              aria-label={`Remover regra de ${r.matchKey}`}
              className="icon-btn"
            >
              <Icon icon="x" size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
