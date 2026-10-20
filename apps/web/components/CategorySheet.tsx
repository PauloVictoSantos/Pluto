'use client';

import { CATEGORIES, categoryOf, type Transaction } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { MerchantLogo, merchantInfo } from '@/lib/merchants';
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
        { title: 'Não é gasto', items: CATEGORIES.filter((c) => c.group === 'internal' && c.key !== 'pago-dividido') },
      ];

/** Trocar a categoria de uma transacao (RN-12), opcionalmente criando uma regra para as parecidas. */
export function CategorySheet({ tx, tz, onClose }: { tx: Transaction; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  // Sugestao do modelo (0,60-0,90) vem pre-selecionada; so vale quando o usuario salva (RN-D01).
  const [key, setKey] = useState(tx.suggestion?.categoryKey ?? tx.categoryKey);
  const [similarToo, setSimilarToo] = useState(true);
  const [done, setDone] = useState(false);
  const similar = useQuery({ queryKey: ['similar', tx.id], queryFn: () => api.similar(tx.id) });
  const info = merchantInfo(tx);
  const [name, setName] = useState(info.name);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const rename = useMutation({
    mutationFn: (n: string | null) => api.renameTransaction(tx.id, n),
    onSuccess: (r) => {
      setName(r.name ?? merchantInfo({ ...tx, nameOverride: null }).name);
      setRenaming(false);
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['merchant-groups'] });
    },
  });
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
        <MerchantLogo brand={info.brand} categoryKey={key} size={42} />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                // Dentro do formulario da categoria: Enter salva so o nome.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (newName.trim()) rename.mutate(newName.trim());
                  }
                  if (e.key === 'Escape') setRenaming(false);
                }}
                maxLength={40}
                aria-label="Novo nome do estabelecimento"
                className="input h-10 min-w-0 flex-1"
              />
              <button type="button" onClick={() => newName.trim() && rename.mutate(newName.trim())} disabled={rename.isPending} className="btn btn-primary h-10 px-3 text-[13px]">
                Salvar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 text-[17px] font-bold tracking-[-0.01em] break-words">{name}</div>
              <button type="button" onClick={() => (setNewName(name), setRenaming(true))} aria-label="Renomear estabelecimento" className="icon-btn size-8 shrink-0 border-0">
                <Icon icon="pencil" size={14} />
              </button>
            </div>
          )}
          {renaming && (
            <div className="mt-1 text-xs text-muted-foreground">
              Vale para todas as compras de “{tx.description}”.{' '}
              {tx.nameOverride && (
                <button type="button" onClick={() => rename.mutate(null)} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-brand-text underline">
                  Voltar ao nome automático
                </button>
              )}
            </div>
          )}
          {name !== tx.description && !renaming && <div className="mt-0.5 truncate text-xs text-muted-foreground">{tx.description}</div>}
          <div className="mt-0.5 text-xs text-muted-foreground">
            {fmtDateTimeIn(tx.date, tz)} · {tx.amountMinor > 0 ? '+ ' : '− '}
            {money(Math.abs(tx.amountMinor))}
          </div>
        </div>
        <SheetCloseButton>
          <Icon icon="x" size={18} />
        </SheetCloseButton>
      </div>

      {tx.suggestion && (
        <div className="flex items-start gap-2 rounded-xl bg-brand-soft px-3 py-2.5 text-[13px] leading-snug text-brand-text">
          <Icon icon="sparkles" size={16} />
          <span>
            Sugestão da Pluto: <b>{categoryOf(tx.suggestion.categoryKey).label}</b> ({Math.round(tx.suggestion.p * 100)}% de confiança), aprendida com as
            categorias que você já corrigiu. Salve para confirmar ou escolha outra.
          </span>
        </div>
      )}
      {tx.outlier && (
        <div className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-[13px] leading-snug text-muted-foreground">
          <Icon icon="info" size={16} />
          <span>
            Fora do normal: {money(Math.abs(tx.amountMinor))} contra {money(tx.outlier.medianMinor)} de costume em {categoryOf(tx.categoryKey).label}. É só um
            aviso: nada muda na transação.
          </span>
        </div>
      )}

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
