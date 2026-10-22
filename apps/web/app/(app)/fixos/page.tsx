'use client';

import { CATEGORIES, FIXED_RECURRENCE_LABEL, categoryOf, type FixedExpense, type FixedRecurrence, type FixedSuggestion } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { StatTiles, tileBrand, tilePlain } from '@/components/StatTiles';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Sheet } from '@/components/ui/Sheet';
import { ApiRequestError, api } from '@/lib/api';
import { MESES, maskMoney } from '@/lib/format';
import { useEnter } from '@/lib/motion';
import { ROUTES } from '@/lib/nav';
import { money } from '@/lib/queries';

// Gastos fixos do Plutao (doc. Pluton 3.1): aluguel, contas, assinaturas. Valor variavel (luz, agua)
// segue a media dos ultimos 3 meses do extrato; parcelas de Contas a pagar entram como temporarias.

const SPEND = CATEGORIES.filter((c) => c.group === 'essential' || c.group === 'lifestyle');
const RECURRENCES: { id: FixedRecurrence; label: string }[] = (['monthly', 'weekly', 'yearly'] as const).map((id) => ({ id, label: FIXED_RECURRENCE_LABEL[id] }));
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

interface Form {
  name: string;
  amount: { text: string; value: number };
  categoryKey: string;
  recurrence: FixedRecurrence;
  dueDay: number;
  dueMonth: number;
  isVariable: boolean;
  endsOn: string;
  matchKey: string | null;
}
type Dialog = { kind: 'new'; from?: FixedSuggestion } | { kind: 'edit'; item: FixedExpense } | { kind: 'delete'; item: FixedExpense } | null;

const blank = (): Form => ({ name: '', amount: { text: '', value: 0 }, categoryKey: 'moradia', recurrence: 'monthly', dueDay: 10, dueMonth: 1, isVariable: false, endsOn: '', matchKey: null });
const fromItem = (i: Pick<FixedExpense, 'name' | 'amountMinor' | 'categoryKey' | 'recurrence' | 'dueDay' | 'matchKey'> & Partial<FixedExpense>): Form => ({
  name: i.name,
  amount: maskMoney(String(i.amountMinor)),
  categoryKey: SPEND.some((c) => c.key === i.categoryKey) ? i.categoryKey : 'outros',
  recurrence: i.recurrence,
  dueDay: i.dueDay,
  dueMonth: i.dueMonth ?? 1,
  isVariable: i.isVariable ?? false,
  endsOn: i.endsOn ?? '',
  matchKey: i.matchKey,
});

const dueText = (i: Pick<FixedExpense, 'recurrence' | 'dueDay' | 'dueMonth'>) =>
  i.recurrence === 'weekly'
    ? `toda ${WEEKDAYS[i.dueDay - 1]!.toLowerCase()}`
    : i.recurrence === 'yearly'
      ? `todo ano em ${i.dueDay} de ${MONTHS[(i.dueMonth ?? 1) - 1]}`
      : `todo dia ${i.dueDay}`;
const monthText = (m: string) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

export default function FixosPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ['fixed-expenses'], queryFn: api.fixedExpenses });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [f, setF] = useState<Form>(blank);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const done = (data: Awaited<ReturnType<typeof api.fixedExpenses>>) => {
    qc.setQueryData(['fixed-expenses'], data);
    setDialog(null);
  };
  const fail = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.');
  const body = () => ({
    name: f.name.trim(),
    categoryKey: f.categoryKey,
    amountMinor: Math.round(f.amount.value * 100),
    isVariable: f.isVariable,
    recurrence: f.recurrence,
    dueDay: f.dueDay,
    dueMonth: f.recurrence === 'yearly' ? f.dueMonth : null,
    endsOn: f.endsOn || null,
    matchKey: f.matchKey,
  });
  const create = useMutation({ mutationFn: () => api.createFixedExpense({ ...body(), source: 'manual' }), onSuccess: done, onError: fail });
  const update = useMutation({ mutationFn: (id: string) => api.updateFixedExpense(id, body()), onSuccess: done, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteFixedExpense(id), onSuccess: done, onError: fail });
  const busy = create.isPending || update.isPending || remove.isPending;

  const open = (d: Dialog) => {
    setError('');
    if (d?.kind === 'new') setF(d.from ? fromItem({ ...d.from, isVariable: false }) : blank());
    if (d?.kind === 'edit') setF(fromItem(d.item));
    setDialog(d);
  };
  const ok = !!f.name.trim() && f.amount.value > 0 && (f.recurrence !== 'weekly' || f.dueDay <= 7);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ok || !dialog) return;
    if (dialog.kind === 'new') create.mutate();
    else if (dialog.kind === 'edit') update.mutate(dialog.item.id);
  };

  const d = q.data;
  const own = d?.items.filter((i) => i.source !== 'divida') ?? [];
  const debts = d?.items.filter((i) => i.source === 'divida') ?? [];
  const share = d?.incomeShare ?? null;

  const row = (i: FixedExpense) => {
    const cat = categoryOf(i.categoryKey);
    const isDebt = i.source === 'divida';
    return (
      <button
        key={i.id}
        onClick={() => (isDebt ? router.push(ROUTES.bills) : open({ kind: 'edit', item: i }))}
        className="flex w-full cursor-pointer items-center gap-3 border-0 border-t border-solid border-border bg-transparent py-3 text-left text-foreground"
        aria-label={isDebt ? `${i.name}: editar em Contas a pagar` : `Editar ${i.name}`}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
          <Icon icon={cat.icon} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{i.name}</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">
            {cat.label} · {dueText(i)}
            {i.installment ? ` · parcela ${i.installment.n} de ${i.installment.total}` : ''}
            {i.endsOn ? ` · até ${monthText(i.endsOn)}` : ''}
            {i.source === 'chat' ? ' · criado pelo Plutão' : ''}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[15px] font-semibold tabular-nums">{money(i.amountMinor)}</span>
          <span className="block text-[11.5px] text-muted-foreground tabular-nums">
            {i.isVariable ? (i.amountStdMinor !== null ? `média · ± ${money(i.amountStdMinor)}` : 'valor varia') : i.recurrence !== 'monthly' ? `${money(i.monthlyMinor)}/mês` : ''}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Gastos fixos</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">O que sai todo mês antes de qualquer escolha. O Plutão desconta isso antes de calcular o seu limite.</p>
        </div>
        <button onClick={() => open({ kind: 'new' })} className="btn btn-primary">
          <Icon icon="plus" size={16} />
          Novo gasto fixo
        </button>
      </div>

      <StatTiles
        tiles={[
          { label: 'Por mês', value: d ? money(d.monthlyTotalMinor) : '…', ...tileBrand },
          { label: 'Da renda', value: share === null ? '—' : `${Math.round(share * 100)}%`, ...tilePlain },
          { label: 'Gastos', value: d ? String(d.items.length) : '…', ...tilePlain },
        ]}
      />
      {share !== null && share > 0.5 && (
        <div data-anim="" role="status" className="flex items-start gap-2 rounded-2xl bg-danger-soft p-3.5 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          Fixos e parcelas passam de 50% da sua renda. O recomendado é ficar abaixo disso para sobrar espaço para metas e imprevistos.
        </div>
      )}
      {d && d.incomeMinor === null && (
        <div data-anim="" className="text-[13px] text-muted-foreground">
          Informe sua renda em <a href={ROUTES.settings} className="font-semibold text-brand-text underline">Configurações › Perfil financeiro</a> para ver quanto dela os fixos ocupam.
        </div>
      )}

      {q.isPending && <div className="h-40 animate-pulse rounded-2xl bg-muted" />}

      {d && d.suggestions.length > 0 && (
        <section data-anim="" className="card flex flex-col" aria-label="Encontrados no extrato">
          <div className="card-title">Encontrados no seu extrato</div>
          <div className="mt-1 mb-1 text-[13px] text-muted-foreground">Estes gastos se repetem. Confirme para virar gasto fixo.</div>
          {d.suggestions.map((s) => (
            <div key={s.matchKey} className="flex items-center gap-3 border-t border-border py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                <Icon icon={categoryOf(s.categoryKey).icon} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{s.name}</span>
                <span className="block text-[12px] text-muted-foreground">
                  {FIXED_RECURRENCE_LABEL[s.recurrence]} · {money(s.amountMinor)}
                </span>
              </span>
              <button onClick={() => open({ kind: 'new', from: s })} className="btn btn-outline h-9 px-3 text-[13px]">
                <Icon icon="plus" size={14} />
                Adicionar
              </button>
            </div>
          ))}
        </section>
      )}

      {d && !d.items.length && (
        <div data-anim="" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <PlutoLogo size={72} />
          <div className="text-[17px] font-semibold">Nenhum gasto fixo ainda</div>
          <div className="max-w-[360px] text-sm text-pretty text-muted-foreground">Aluguel, luz, internet, academia… Cadastre o que você paga todo mês.</div>
          <button onClick={() => open({ kind: 'new' })} className="btn btn-primary mt-1">
            <Icon icon="plus" size={16} />
            Cadastrar primeiro
          </button>
        </div>
      )}

      {own.length > 0 && (
        <section data-anim="" className="card flex flex-col" aria-label="Seus gastos fixos">
          <div className="card-title mb-1">Seus gastos fixos</div>
          {own.map(row)}
        </section>
      )}
      {debts.length > 0 && (
        <section data-anim="" className="card flex flex-col" aria-label="Parcelas e dívidas">
          <div className="card-title">Parcelas e dívidas</div>
          <div className="mt-1 mb-1 text-[13px] text-muted-foreground">Vêm de Contas a pagar e saem daqui sozinhas quando terminam.</div>
          {debts.map(row)}
        </section>
      )}

      {dialog && dialog.kind !== 'delete' && (
        <Sheet onClose={() => setDialog(null)} onSubmit={submit} label={dialog.kind === 'new' ? 'Novo gasto fixo' : 'Editar gasto fixo'}>
          <div className="text-xl font-bold tracking-[-0.02em]">{dialog.kind === 'new' ? 'Novo gasto fixo' : `Editar “${dialog.item.name}”`}</div>
          <label className="field">
            Nome
            <input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="Ex.: Aluguel" maxLength={60} className="input" autoFocus />
          </label>
          <label className="field">
            {f.isVariable ? 'Valor médio' : 'Valor'}
            <input value={f.amount.text} onChange={(e) => setF((x) => ({ ...x, amount: maskMoney(e.target.value) }))} inputMode="numeric" placeholder="R$ 0,00" className="input h-14 text-2xl font-bold" />
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input type="checkbox" checked={f.isVariable} onChange={(e) => setF((x) => ({ ...x, isVariable: e.target.checked }))} className="mt-0.5 size-4 accent-[var(--brand)]" />
            <span>
              <span className="font-semibold">O valor muda todo mês</span> (luz, água, gás)
              <span className="block text-muted-foreground">
                {f.matchKey ? 'Usamos a média dos últimos 3 meses do seu extrato.' : 'Informe uma média; ajuste quando quiser.'}
              </span>
            </span>
          </label>
          <label className="field">
            Categoria
            <select value={f.categoryKey} onChange={(e) => setF((x) => ({ ...x, categoryKey: e.target.value }))} className="input">
              {SPEND.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            Repete
            <Segmented
              items={RECURRENCES}
              value={f.recurrence}
              onChange={(r) => setF((x) => ({ ...x, recurrence: r, dueDay: r === 'weekly' ? Math.min(x.dueDay, 7) : x.dueDay }))}
              height={40}
              className="self-start"
            />
          </div>
          <div className="flex gap-2.5">
            {f.recurrence === 'weekly' ? (
              <label className="field flex-1">
                Dia da semana
                <select value={f.dueDay} onChange={(e) => setF((x) => ({ ...x, dueDay: +e.target.value }))} className="input">
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i + 1}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field flex-1">
                Dia do vencimento
                <input type="number" min={1} max={31} value={f.dueDay} onChange={(e) => setF((x) => ({ ...x, dueDay: Math.min(31, Math.max(1, +e.target.value || 1)) }))} className="input" />
              </label>
            )}
            {f.recurrence === 'yearly' && (
              <label className="field flex-1">
                Mês
                <select value={f.dueMonth} onChange={(e) => setF((x) => ({ ...x, dueMonth: +e.target.value }))} className="input">
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m[0]!.toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="field">
            Termina em (opcional)
            <input type="month" value={f.endsOn} onChange={(e) => setF((x) => ({ ...x, endsOn: e.target.value }))} className="input" />
          </label>
          {error && (
            <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
              <Icon icon="circle-alert" size={16} />
              {error}
            </div>
          )}
          <div className="flex gap-2.5">
            {dialog.kind === 'edit' ? (
              <button type="button" onClick={() => open({ kind: 'delete', item: dialog.item })} className="btn h-[50px] flex-1 border-transparent bg-danger-soft text-[15px] text-danger-text">
                Excluir
              </button>
            ) : (
              <button type="button" onClick={() => setDialog(null)} className="btn btn-outline h-[50px] flex-1 text-[15px]">
                Cancelar
              </button>
            )}
            <button type="submit" disabled={!ok || busy} className="btn btn-primary h-[50px] flex-1 text-[15px]" style={{ opacity: ok && !busy ? 1 : 0.5 }}>
              {busy ? 'Salvando…' : dialog.kind === 'new' ? 'Cadastrar' : 'Salvar'}
            </button>
          </div>
        </Sheet>
      )}

      {dialog?.kind === 'delete' && (
        <Sheet onClose={() => setDialog(null)} role="alertdialog" label="Excluir gasto fixo" width={400} top="26vh">
          <div className="text-xl font-bold tracking-[-0.02em]">Excluir “{dialog.item.name}”?</div>
          <div className="text-sm text-muted-foreground">Ele deixa de entrar no cálculo do seu limite. O histórico fica guardado.</div>
          {error && <div className="text-[13px] text-danger-text">{error}</div>}
          <div className="flex gap-2.5">
            <button onClick={() => setDialog(null)} className="btn btn-outline h-12 flex-1">
              Cancelar
            </button>
            <button onClick={() => remove.mutate(dialog.item.id)} disabled={busy} className="btn h-12 flex-1 border-transparent bg-danger-soft text-danger-text">
              Excluir
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
