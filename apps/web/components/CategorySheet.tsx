'use client';

import { CATEGORIES, categoryOf, type Transaction } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { fmtDateTimeIn } from '@/lib/datetime';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';
import { CloseWhen, Sheet, SheetCloseButton } from './ui/Sheet';

// Saida: categorias de gasto + internas. Entrada: categorias de receita + internas.
const groupsFor = (amountMinor: number) =>
  amountMinor > 0
    ? [
        { title: 'Entradas', items: CATEGORIES.filter((c) => c.group === 'income') },
        { title: 'Não é receita', items: CATEGORIES.filter((c) => c.group === 'internal') },
      ]
    : [
        { title: 'Essenciais', items: CATEGORIES.filter((c) => c.group === 'essential') },
        { title: 'Estilo de vida', items: CATEGORIES.filter((c) => c.group === 'lifestyle') },
        { title: 'Não é gasto', items: CATEGORIES.filter((c) => c.group === 'internal') },
      ];

/** Trocar a categoria de uma transacao (RN-12), opcionalmente criando uma regra para as parecidas. */
export function CategorySheet({ tx, tz, onClose }: { tx: Transaction; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [key, setKey] = useState(tx.categoryKey);
  const [similarToo, setSimilarToo] = useState(true);
  const [done, setDone] = useState(false);
  const similar = useQuery({ queryKey: ['similar', tx.id], queryFn: () => api.similar(tx.id) });
  const others = Math.max(0, (similar.data?.count ?? 1) - 1);

  const save = useMutation({
    mutationFn: () => api.setCategory(tx.id, key, similarToo && others > 0),
    onSuccess: async () => {
      // Categoria muda graficos, orcamento, planejamento e a propria lista.
      await Promise.all(['transactions', 'dashboard', 'budgets', 'category-rules'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      setDone(true);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (key === tx.categoryKey && !(similarToo && others > 0)) return setDone(true);
    save.mutate();
  };

  return (
    <Sheet onClose={onClose} label="Categoria da transação" width={520} top="8vh" gap={14} onSubmit={submit}>
      <div className="flex items-start gap-3">
        <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-muted">
          <Icon icon={categoryOf(key).icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-bold tracking-[-0.01em] break-words">{tx.merchant ?? tx.description}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {fmtDateTimeIn(tx.date, tz)} · {tx.amountMinor > 0 ? '+ ' : '− '}
            {money(Math.abs(tx.amountMinor))}
          </div>
        </div>
        <SheetCloseButton>
          <Icon icon="x" size={18} />
        </SheetCloseButton>
      </div>

      <div className="-mx-1 flex max-h-[46vh] flex-col gap-3 overflow-y-auto px-1">
        {groupsFor(tx.amountMinor).map((g) => (
          <div key={g.title} className="flex flex-col gap-2">
            <div className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{g.title}</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={g.title}>
              {g.items.map((c) => {
                const on = c.key === key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setKey(c.key)}
                    className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium"
                    style={{
                      background: on ? 'var(--primary)' : 'transparent',
                      color: on ? 'var(--primary-foreground)' : 'var(--foreground)',
                      borderColor: on ? 'var(--primary)' : 'var(--border)',
                    }}
                  >
                    <Icon icon={c.icon} size={15} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {others > 0 && (
        <label className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-border p-3">
          <input type="checkbox" checked={similarToo} onChange={(e) => setSimilarToo(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-brand" />
          <span className="text-sm leading-snug">
            {similar.data!.byCounterparty ? (
              <>
                Aplicar também às outras {others} transaç{others > 1 ? 'ões' : 'ão'} para <b>{similar.data!.label}</b> (mesmo CPF/CNPJ ou conta) e às próximas que chegarem
              </>
            ) : (
              <>
                Aplicar também às outras {others} transaç{others > 1 ? 'ões' : 'ão'} de <b>“{similar.data!.matchKey}”</b> e às próximas que chegarem
              </>
            )}
            <span className="mt-0.5 block text-xs text-muted-foreground">Vale só para {tx.amountMinor > 0 ? 'entradas' : 'saídas'}. Você pode desfazer em Configurações.</span>
          </span>
        </label>
      )}

      <CloseWhen when={done} />
      {save.isError && <div className="text-sm text-danger-text">Não consegui salvar. Tente de novo.</div>}
      <button type="submit" disabled={save.isPending} className="btn btn-primary h-12">
        {save.isPending ? 'Salvando…' : 'Salvar categoria'}
      </button>
    </Sheet>
  );
}
