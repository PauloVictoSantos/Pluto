'use client';

import { CATEGORIES, categoryOf, type MerchantGroup } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { Icon } from './ui/Icon';

const SPEND = CATEGORIES.filter((c) => c.group === 'essential' || c.group === 'lifestyle');

/**
 * Estabelecimentos agrupados (Configuracoes): a IA junta "UBER *TRIP SP" e "UBER TRIP HELP" em "Uber";
 * aqui o usuario renomeia, troca a categoria, junta grupos ("99" dentro de "Uber") e tira descricoes.
 */
export function MerchantGroupsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['merchant-groups'], queryFn: api.merchantGroups });
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const done = (data: Awaited<ReturnType<typeof api.merchantGroups>>) => {
    qc.setQueryData(['merchant-groups'], data);
    setError('');
    for (const k of ['transactions', 'dashboard', 'budgets', 'analytics']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const fail = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar. Tente de novo.');
  const refresh = useMutation({ mutationFn: api.refreshMerchantGroups, onSuccess: done, onError: fail });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: { name?: string; categoryKey?: string | null } }) => api.updateMerchantGroup(id, body), onSuccess: done, onError: fail });
  const merge = useMutation({ mutationFn: ({ id, intoId }: { id: string; intoId: string }) => api.mergeMerchantGroup(id, intoId), onSuccess: done, onError: fail });
  const drop = useMutation({ mutationFn: ({ id, key }: { id: string; key: string }) => api.removeMerchantKey(id, key), onSuccess: done, onError: fail });
  const d = q.data;

  return (
    <section data-anim="" className="card flex flex-col" aria-label="Estabelecimentos agrupados">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="card-title">Estabelecimentos agrupados</div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            Descrições diferentes do mesmo lugar viram um grupo com uma categoria, ex.: “UBER *TRIP SP” e “99 POP” em Transporte por app. Ao editar, vale como
            regra sua.
            {d && !d.aiAvailable && ' A IA está desligada: só juntamos descrições muito parecidas.'}
          </div>
        </div>
        <button onClick={() => refresh.mutate()} disabled={refresh.isPending} className="btn btn-outline h-10 px-3 text-[13px]">
          <Icon icon="sparkles" size={14} />
          {refresh.isPending ? 'Agrupando…' : d?.ungrouped ? `Agrupar ${d.ungrouped} novas` : 'Agrupar agora'}
        </button>
      </div>

      {q.isPending && <div className="mt-3 h-20 animate-pulse rounded-xl bg-muted" />}
      {d && !d.groups.length && <div className="border-t border-border py-4 text-sm text-muted-foreground mt-2">Nenhum grupo ainda. Toque em “Agrupar agora”.</div>}

      <div className="mt-2 flex flex-col">
        {d?.groups.map((g: MerchantGroup) => {
          const cat = g.categoryKey ? categoryOf(g.categoryKey) : null;
          const isOpen = open === g.id;
          return (
            <div key={g.id} className="border-t border-border py-2">
              <button
                onClick={() => setOpen(isOpen ? null : g.id)}
                aria-expanded={isOpen}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-foreground"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                  <Icon icon={cat?.icon ?? 'layout-grid'} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{g.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {cat?.label ?? 'Sem categoria'} · {g.transactions} transaç{g.transactions === 1 ? 'ão' : 'ões'} · {g.keys.length} descriç{g.keys.length === 1 ? 'ão' : 'ões'}
                    {g.source === 'ai' ? ' · sugerido pela IA' : ''}
                  </span>
                </span>
                <Icon icon={isOpen ? 'chevron-up' : 'chevron-down'} size={16} />
              </button>
              {isOpen && (
                <div className="mt-2 flex flex-col gap-3 pl-12">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="field">
                      Nome
                      <input
                        defaultValue={g.name}
                        maxLength={40}
                        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== g.name && update.mutate({ id: g.id, body: { name: e.target.value.trim() } })}
                        className="input h-11"
                      />
                    </label>
                    <label className="field">
                      Categoria
                      <select value={g.categoryKey ?? ''} onChange={(e) => update.mutate({ id: g.id, body: { categoryKey: e.target.value || null } })} className="input h-11">
                        <option value="">Sem categoria</option>
                        {SPEND.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1.5" aria-label="Descrições do grupo">
                    {g.keys.map((k) => (
                      <span key={k} className="inline-flex items-center gap-1 rounded-full border border-border py-1 pr-1 pl-3 text-xs">
                        {k}
                        <button onClick={() => drop.mutate({ id: g.id, key: k })} aria-label={`Tirar “${k}” do grupo`} className="grid size-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted-foreground">
                          <Icon icon="x" size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  {d.groups.length > 1 && (
                    <label className="field">
                      Juntar com outro grupo
                      <select value="" onChange={(e) => e.target.value && merge.mutate({ id: g.id, intoId: e.target.value })} className="input h-11">
                        <option value="">Escolha o grupo que fica…</option>
                        {d.groups
                          .filter((o) => o.id !== g.id)
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <div role="alert" className="mt-2 flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}
    </section>
  );
}
