'use client';

import { CATEGORIES, categoryOf, type CategoryRule } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { Icon } from './ui/Icon';
import { Sheet, useSheetClose } from './ui/Sheet';

// Regras de categoria (doc. Melhorias, passo 6): agrupadas por categoria, com os estabelecimentos
// dentro (Mercado -> Atacadao, Carrefour). No modal da para adicionar, mover e remover; nada vale
// ate o "Salvar" fixo no rodape.

const SPEND = CATEGORIES.filter((c) => c.group === 'essential' || c.group === 'lifestyle');

interface Row {
  /** null: estabelecimento novo (ainda nao salvo). */
  id: string | null;
  label: string;
  categoryKey: string;
  byCounterparty: boolean;
  direction: 'in' | 'out';
}

const groupsOf = (rows: Row[]) => {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.categoryKey, [...(by.get(r.categoryKey) ?? []), r]);
  return [...by.entries()].sort((a, b) => categoryOf(a[0]).label.localeCompare(categoryOf(b[0]).label));
};

export function CategoryRulesCard() {
  const rules = useQuery({ queryKey: ['category-rules'], queryFn: api.categoryRules });
  const [open, setOpen] = useState(false);
  const list = rules.data ?? [];
  const groups = groupsOf(list.map(toRow));

  return (
    <div data-anim="" className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="card-title">Regras de categoria</div>
          <div className="mt-1 text-[13px] text-muted-foreground">Cada estabelecimento cai sempre na mesma categoria. Ex.: Atacadão e Carrefour em Mercado.</div>
        </div>
        <button onClick={() => setOpen(true)} disabled={rules.isPending} className="btn btn-outline h-10 shrink-0 px-4 text-[14px]">
          <Icon icon="pencil" size={15} />
          Organizar regras
        </button>
      </div>
      {rules.isPending && <div className="py-3 text-sm text-muted-foreground">Carregando…</div>}
      {!rules.isPending && list.length === 0 && <div className="border-t border-border py-4 text-sm text-muted-foreground">Nenhuma regra ainda. Toque em Organizar regras para criar.</div>}
      {groups.map(([key, rows]) => {
        const c = categoryOf(key);
        return (
          <div key={key} className="flex items-start gap-3 border-t border-border pt-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
              <Icon icon={c.icon} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">{c.label}</div>
              <div className="mt-0.5 text-[13px] break-words text-muted-foreground">{rows.map((r) => r.label).join(', ')}</div>
            </div>
          </div>
        );
      })}
      {open && rules.data && <RulesSheet rules={rules.data} onClose={() => setOpen(false)} />}
    </div>
  );
}

const toRow = (r: CategoryRule): Row => ({ id: r.id, label: r.label, categoryKey: r.categoryKey, byCounterparty: r.byCounterparty, direction: r.direction });

function RulesSheet({ rules, onClose }: { rules: CategoryRule[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => rules.map(toRow));
  const [removed, setRemoved] = useState<string[]>([]);
  const [adding, setAdding] = useState<{ categoryKey: string; label: string } | null>(null);
  const [error, setError] = useState('');

  const original = new Map(rules.map((r) => [r.id, r.categoryKey]));
  const changes = {
    create: rows.filter((r) => !r.id).map((r) => ({ label: r.label, categoryKey: r.categoryKey, direction: r.direction })),
    move: rows.filter((r) => r.id && original.get(r.id) !== r.categoryKey).map((r) => ({ id: r.id!, categoryKey: r.categoryKey })),
    remove: removed,
  };
  const dirty = changes.create.length + changes.move.length + changes.remove.length > 0;

  const save = useMutation({
    mutationFn: () => api.saveCategoryRules(changes),
    onSuccess: (data) => {
      qc.setQueryData(['category-rules'], data);
      // Transacoes recategorizadas: telas que somam por categoria recarregam.
      for (const k of ['transactions', 'dashboard', 'budgets', 'analytics', 'spending']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar. Tente de novo.'),
  });

  const move = (r: Row, categoryKey: string) => setRows((all) => all.map((x) => (x === r ? { ...x, categoryKey } : x)));
  const drop = (r: Row) => {
    setRows((all) => all.filter((x) => x !== r));
    if (r.id) setRemoved((ids) => [...ids, r.id!]);
  };
  const add = (e?: FormEvent) => {
    e?.preventDefault();
    const label = adding?.label.trim() ?? '';
    if (!adding || label.length < 2) return;
    setRows((all) => [...all, { id: null, label, categoryKey: adding.categoryKey, byCounterparty: false, direction: 'out' }]);
    setAdding(null);
  };

  const groups = groupsOf(rows);
  const used = new Set(groups.map(([k]) => k));
  return (
    <Sheet onClose={onClose} label="Regras de categoria" width={560} top="5vh" gap={12}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xl font-bold tracking-[-0.02em]">Regras de categoria</div>
        <CloseX />
      </div>
      <p className="m-0 text-[13px] text-muted-foreground">Mude a categoria de um estabelecimento, remova ou adicione novos. Nada muda até você salvar.</p>

      {groups.map(([key, items]) => {
        const c = categoryOf(key);
        return (
          <section key={key} className="flex flex-col rounded-2xl border border-border" aria-label={c.label}>
            <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                <Icon icon={c.icon} size={15} />
              </span>
              <span className="flex-1 text-[15px] font-semibold">{c.label}</span>
              <span className="text-[12px] text-muted-foreground">{items.length}</span>
            </div>
            {items.map((r) => (
              <div key={r.id ?? `novo:${r.label}`} className="flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-2">
                <span className="min-w-[120px] flex-1 truncate text-[14px]">
                  {r.label}
                  {!r.id && <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[11px] text-brand-text">novo</span>}
                  {r.direction === 'in' && <span className="ml-1.5 text-[11px] text-muted-foreground">entrada</span>}
                </span>
                <select value={r.categoryKey} onChange={(e) => move(r, e.target.value)} aria-label={`Mover ${r.label} para outra categoria`} className="input h-9 w-auto max-w-[170px] py-0 text-[13px]">
                  {CATEGORIES.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => drop(r)} aria-label={`Remover ${r.label}`} className="icon-btn size-9">
                  <Icon icon="trash-2" size={15} />
                </button>
              </div>
            ))}
            <AddRow categoryKey={key} adding={adding} setAdding={setAdding} onAdd={add} />
          </section>
        );
      })}

      <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-border p-3.5">
        <span className="text-[13px] font-semibold">Nova categoria com estabelecimento</span>
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <select
            value={adding && !used.has(adding.categoryKey) ? adding.categoryKey : ''}
            onChange={(e) => setAdding({ categoryKey: e.target.value, label: adding?.label ?? '' })}
            aria-label="Categoria"
            className="input h-10 w-auto min-w-[150px] flex-1 text-[14px]"
          >
            <option value="">Escolha a categoria</option>
            {SPEND.filter((c) => !used.has(c.key)).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          {adding && !used.has(adding.categoryKey) && (
            <>
              <input autoFocus value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value.slice(0, 80) })} placeholder="Ex.: Atacadão" aria-label="Estabelecimento" className="input h-10 min-w-[150px] flex-[2] text-[14px]" />
              <button type="submit" disabled={adding.label.trim().length < 2} className="btn btn-outline h-10 px-3 text-[13px]">
                Adicionar
              </button>
            </>
          )}
        </form>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}
      {/* Rodape fixo: Salvar sempre visivel, mesmo com muitas regras. */}
      <div className="sticky -bottom-[calc(24px+env(safe-area-inset-bottom))] -mx-5 mt-1 flex gap-2 border-t border-border bg-card px-5 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))] -mb-[calc(24px+env(safe-area-inset-bottom))]">
        <CancelButton />
        <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="btn btn-primary h-11 flex-1 disabled:opacity-50">
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </Sheet>
  );
}

function AddRow({ categoryKey, adding, setAdding, onAdd }: { categoryKey: string; adding: { categoryKey: string; label: string } | null; setAdding: (a: { categoryKey: string; label: string } | null) => void; onAdd: () => void }) {
  if (adding?.categoryKey !== categoryKey)
    return (
      <button type="button" onClick={() => setAdding({ categoryKey, label: '' })} className="flex h-10 cursor-pointer items-center gap-1.5 border-0 border-t border-border bg-transparent px-3.5 text-left text-[13px] font-semibold text-brand-text">
        <Icon icon="plus" size={14} />
        Adicionar estabelecimento
      </button>
    );
  return (
    <div className="flex gap-2 border-t border-border px-3.5 py-2">
      <input
        autoFocus
        value={adding.label}
        onChange={(e) => setAdding({ ...adding, label: e.target.value.slice(0, 80) })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onAdd();
          }
        }}
        placeholder="Nome como aparece no extrato"
        aria-label="Estabelecimento"
        className="input h-10 min-w-0 flex-1 text-[14px]"
      />
      <button type="button" onClick={onAdd} disabled={adding.label.trim().length < 2} className="btn btn-outline h-10 px-3 text-[13px]">
        Adicionar
      </button>
    </div>
  );
}

function CancelButton() {
  const close = useSheetClose();
  return (
    <button type="button" onClick={close} className="btn btn-outline h-11 flex-1">
      Cancelar
    </button>
  );
}

function CloseX() {
  const close = useSheetClose();
  return (
    <button type="button" onClick={close} aria-label="Fechar" className="icon-btn size-10">
      <Icon icon="x" size={18} />
    </button>
  );
}
