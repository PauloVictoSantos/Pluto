'use client';

import { INCOME_TYPES, INCOME_TYPE_LABEL, MAX_INCOME_PROFILES, PROFILE_COVERS, type IncomeProfile, type IncomeType, type ProfileCover } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { useDraft } from '@/lib/draft';
import { maskMoney } from '@/lib/format';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';
import { MoneyInput } from './ui/MoneyInput';
import { Sheet, useSheetClose } from './ui/Sheet';

// Perfis financeiros (doc. Melhorias, passo 6): ate 2 fontes de renda, cada uma num card com capa,
// nome, renda, dia de recebimento e tipo de renda. A renda que o Plutao usa e a soma dos perfis.

/** Capas padrao (sem upload de imagem): gradiente + icone. */
export const COVERS: Record<ProfileCover, { label: string; bg: string; icon: string; fg: string }> = {
  violeta: { label: 'Violeta', bg: 'linear-gradient(135deg, #7D39EB 0%, #B18CF7 100%)', icon: 'briefcase', fg: '#fff' },
  lima: { label: 'Lima', bg: 'linear-gradient(135deg, #C6F432 0%, #8BD43A 100%)', icon: 'laptop', fg: '#0b0b0e' },
  oceano: { label: 'Oceano', bg: 'linear-gradient(135deg, #0EA5E9 0%, #2563EB 100%)', icon: 'wallet', fg: '#fff' },
  'por-do-sol': { label: 'Pôr do sol', bg: 'linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)', icon: 'sun', fg: '#fff' },
  grafite: { label: 'Grafite', bg: 'linear-gradient(135deg, #17171c 0%, #3f3f46 100%)', icon: 'landmark', fg: '#fff' },
  floresta: { label: 'Floresta', bg: 'linear-gradient(135deg, #059669 0%, #10B981 100%)', icon: 'piggy-bank', fg: '#fff' },
};

type Editing = { mode: 'new' } | { mode: 'edit'; p: IncomeProfile };

export function IncomeProfilesCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['income-profiles'], queryFn: api.incomeProfiles });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<IncomeProfile | null>(null);
  const done = (data: Awaited<ReturnType<typeof api.incomeProfiles>>) => {
    qc.setQueryData(['income-profiles'], data);
    // A renda do plano mudou: perfil, limite, metas e analises recalculam.
    for (const k of ['agent-profile', 'agent-limit', 'goals-plan', 'obligations', 'analytics', 'agent-chat']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const remove = useMutation({ mutationFn: (id: string) => api.deleteIncomeProfile(id), onSuccess: (d) => (done(d), setConfirmDelete(null)) });

  const d = q.data;
  const full = !!d && d.items.length >= d.max;
  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Perfis financeiros">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="card-title">Perfis financeiros</div>
          <div className="mt-1 text-[13px] text-pretty text-muted-foreground">
            Cada perfil é uma fonte de renda (ex.: salário e freela). O Plutão usa a soma{d?.items.length ? `: ${money(d.totalIncomeMinor)} por mês` : ''}.
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button onClick={() => setEditing({ mode: 'new' })} disabled={!d || full} className="btn btn-primary h-10 px-4 text-[14px] disabled:opacity-50">
            <Icon icon="plus" size={16} />
            Novo perfil
          </button>
          {full && <span className="text-[12px] text-muted-foreground">Limite de {MAX_INCOME_PROFILES} perfis</span>}
        </div>
      </div>

      {q.isPending && <div className="h-40 animate-pulse rounded-2xl bg-muted" />}
      {d && !d.items.length && (
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
          Nenhum perfil ainda. Sem perfil, o Plutão usa a renda do campo abaixo.
        </div>
      )}
      {d && d.items.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {d.items.map((p) => (
            <ProfileCard key={p.id} p={p} onEdit={() => setEditing({ mode: 'edit', p })} onDelete={() => setConfirmDelete(p)} />
          ))}
        </div>
      )}

      {editing && <ProfileSheet editing={editing} onClose={() => setEditing(null)} onSaved={done} />}
      {confirmDelete && (
        <Sheet role="alertdialog" label="Excluir perfil" onClose={() => setConfirmDelete(null)} width={400} top="24vh">
          <div className="text-lg font-bold">Excluir “{confirmDelete.name}”?</div>
          <p className="m-0 text-[14px] text-muted-foreground">A renda dele sai da soma usada pelo Plutão. O limite do mês e as metas são recalculados.</p>
          <DeleteActions busy={remove.isPending} onConfirm={() => remove.mutate(confirmDelete.id)} />
        </Sheet>
      )}
    </section>
  );
}

function DeleteActions({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const close = useSheetClose();
  return (
    <div className="flex gap-2">
      <button type="button" onClick={close} className="btn btn-outline h-11 flex-1">
        Cancelar
      </button>
      <button type="button" onClick={onConfirm} disabled={busy} className="btn h-11 flex-1 border-0 bg-[var(--danger-text)] text-white">
        {busy ? 'Excluindo…' : 'Excluir'}
      </button>
    </div>
  );
}

function ProfileCard({ p, onEdit, onDelete }: { p: IncomeProfile; onEdit: () => void; onDelete: () => void }) {
  const c = COVERS[p.cover];
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative flex h-24 items-end p-3.5" style={{ background: c.bg, color: c.fg }}>
        <span className="absolute top-3 right-3 grid size-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,.18)' }}>
          <Icon icon={c.icon} size={18} />
        </span>
        <span className="truncate text-[17px] font-bold tracking-[-0.02em]">{p.name}</span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2.5 p-3.5 text-[13px]">
        <div className="col-span-2">
          <dt className="text-muted-foreground">Renda mensal</dt>
          <dd className="m-0 text-[18px] font-bold tabular-nums">{money(p.netIncomeMinor)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Recebimento</dt>
          <dd className="m-0 font-semibold">Dia {p.payDay}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tipo de renda</dt>
          <dd className="m-0 font-semibold">{INCOME_TYPE_LABEL[p.incomeType]}</dd>
        </div>
        {p.notes && (
          <div className="col-span-2">
            <dt className="text-muted-foreground">Observações</dt>
            <dd className="m-0 break-words">{p.notes}</dd>
          </div>
        )}
      </dl>
      <div className="mt-auto flex gap-2 border-t border-border p-2.5">
        <button onClick={onEdit} className="btn btn-outline h-10 flex-1 text-[14px]">
          <Icon icon="pencil" size={15} />
          Editar
        </button>
        <button onClick={onDelete} aria-label={`Excluir ${p.name}`} className="btn btn-outline h-10 px-3 text-[14px] text-danger-text">
          <Icon icon="trash-2" size={15} />
          Excluir
        </button>
      </div>
    </article>
  );
}

function ProfileSheet({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: (d: Awaited<ReturnType<typeof api.incomeProfiles>>) => void }) {
  const p = editing.mode === 'edit' ? editing.p : null;
  // Rascunho fora do componente: ocultar valores com o modal aberto nao apaga o que foi digitado.
  const key = `income-profile:${p?.id ?? 'novo'}`;
  const [f, setF, clear] = useDraft(key, () => ({
    name: p?.name ?? '',
    cover: (p?.cover ?? 'violeta') as ProfileCover,
    income: maskMoney(p ? String(p.netIncomeMinor) : ''),
    payDay: String(p?.payDay ?? 5),
    incomeType: (p?.incomeType ?? 'clt') as IncomeType,
    notes: p?.notes ?? '',
  }));
  const [error, setError] = useState('');
  const day = Number(f.payDay);
  const ok = !!f.name.trim() && f.income.value > 0 && Number.isInteger(day) && day >= 1 && day <= 31;
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), cover: f.cover, netIncomeMinor: Math.round(f.income.value * 100), payDay: day, incomeType: f.incomeType, notes: f.notes.trim() || null };
      return p ? api.updateIncomeProfile(p.id, body) : api.createIncomeProfile(body);
    },
    onSuccess: (d) => {
      clear();
      onSaved(d);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar. Tente de novo.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && !save.isPending) save.mutate();
  };

  return (
    <Sheet onClose={onClose} onSubmit={submit} label={p ? 'Editar perfil financeiro' : 'Novo perfil financeiro'} width={480} top="6vh" gap={14}>
      <div className="text-xl font-bold tracking-[-0.02em]">{p ? 'Editar perfil' : 'Novo perfil'}</div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-semibold">Capa</legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Capa">
          {PROFILE_COVERS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={f.cover === k}
              aria-label={COVERS[k].label}
              onClick={() => setF((c) => ({ ...c, cover: k }))}
              className="grid h-14 cursor-pointer place-items-center rounded-xl border-2"
              style={{ background: COVERS[k].bg, color: COVERS[k].fg, borderColor: f.cover === k ? 'var(--foreground)' : 'transparent' }}
            >
              <Icon icon={f.cover === k ? 'check' : COVERS[k].icon} size={18} />
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Nome do perfil
        <input value={f.name} onChange={(e) => setF((c) => ({ ...c, name: e.target.value.slice(0, 40) }))} placeholder="Ex.: Salário, Freela" className="input" />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Renda líquida mensal
        <MoneyInput value={f.income.text} onChange={(m) => setF((c) => ({ ...c, income: m }))} className="input" aria-label="Renda líquida mensal" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Dia de recebimento
          <input value={f.payDay} onChange={(e) => setF((c) => ({ ...c, payDay: e.target.value.replace(/\D/g, '').slice(0, 2) }))} inputMode="numeric" className="input" aria-invalid={!(day >= 1 && day <= 31)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Tipo de renda
          <select value={f.incomeType} onChange={(e) => setF((c) => ({ ...c, incomeType: e.target.value as IncomeType }))} className="input">
            {INCOME_TYPES.map((t) => (
              <option key={t} value={t}>
                {INCOME_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Observações (opcional)
        <input value={f.notes} onChange={(e) => setF((c) => ({ ...c, notes: e.target.value.slice(0, 200) }))} placeholder="Ex.: varia entre meses" className="input" />
      </label>
      {error && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}
      <div className="sticky bottom-0 flex gap-2 bg-card pt-1">
        <CancelButton />
        <button type="submit" disabled={!ok || save.isPending} className="btn btn-primary h-11 flex-1 disabled:opacity-50">
          {save.isPending ? 'Salvando…' : 'Salvar perfil'}
        </button>
      </div>
    </Sheet>
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
