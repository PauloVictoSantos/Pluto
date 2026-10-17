'use client';

import type { Transaction } from '@pluto/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { categoryOf } from '@/lib/categories';
import { fmtDateTimeIn, fmtTimeIn, ymdIn } from '@/lib/datetime';
import { daysBetween, fmt, fmtDate, fmtDay } from '@/lib/format';
import { MOCK, TODAY } from '@/lib/mock/data';
import { CAT_ICON, STATUS, type StatusStyle } from '@/lib/mock/vm';
import { useEnter } from '@/lib/motion';
import { useApp } from '@/lib/store';
import type { Mode } from '@/lib/viewport';
import { PlutoLogo } from './brand/PlutoLogo';
import { Icon } from './ui/Icon';
import { Segmented } from './ui/Segmented';

type StatusFilter = 'ALL' | 'POSTED' | 'PENDING';
const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'Todas' },
  { id: 'POSTED', label: 'Concluídas' },
  { id: 'PENDING', label: 'Pendentes' },
];

interface Row {
  id: string;
  name: string;
  account: string;
  icon: string;
  category: string;
  amountText: string;
  amountFg: string;
  st: StatusStyle;
  dateText: string;
  timeText: string;
  dayKey: string;
  dayLabel: string;
}

const amount = (minorOrReais: number, credit: boolean) => ({
  amountText: (credit ? '+ ' : '− ') + fmt(Math.abs(minorOrReais)),
  amountFg: credit ? 'var(--brand-text)' : 'var(--foreground)',
});
const dayLabelOf = (day: string, today: string) => {
  const diff = daysBetween(day, today);
  return diff === 0 ? 'Hoje' : diff === 1 ? 'Ontem' : fmtDay(day);
};

interface ViewProps {
  mode: Mode;
  title: string;
  summary: string;
  rows: Row[];
  onShowAll?: () => void;
  controls: boolean;
  query: string;
  onQuery: (q: string) => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  empty: ReactNode;
  footer?: ReactNode;
}

/** Visual da lista (design "Lista Transacoes"): tabela no desktop, grupos por dia no celular. */
function TransactionListView({ mode, title, summary, rows, onShowAll, controls, query, onQuery, status, onStatus, empty, footer }: ViewProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);
  const isMobile = mode === 'mobile';

  const groups: { key: string; label: string; rows: Row[] }[] = [];
  rows.forEach((r) => {
    if (!groups.length || groups[groups.length - 1]!.key !== r.dayKey) groups.push({ key: r.dayKey, label: r.dayLabel, rows: [] });
    groups[groups.length - 1]!.rows.push(r);
  });
  const nSel = rows.filter((r) => selected[r.id]).length, allChecked = rows.length > 0 && nSel === rows.length;
  const badge = (st: StatusStyle) => ({ background: st.bg, color: st.fg, borderColor: st.border });

  return (
    <div ref={root} className="card flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="card-title">{title}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">{nSel ? `${nSel} selecionada${nSel > 1 ? 's' : ''}` : summary}</div>
        </div>
        {onShowAll && (
          <button onClick={onShowAll} className="btn btn-outline h-10 gap-1 pr-3 pl-4 text-[13px]">
            Ver todas
            <Icon icon="chevron-right" size={16} />
          </button>
        )}
      </div>

      {controls && (
        <div className="flex flex-wrap items-center gap-2.5">
          <label
            className="box-border flex h-11 flex-[1_1_220px] items-center gap-2 rounded-full border border-border px-3.5 text-muted-foreground"
            style={{ maxWidth: isMobile ? '100%' : 300 }}
          >
            <Icon icon="search" size={16} />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Buscar estabelecimento"
              aria-label="Buscar nesta lista"
              className="w-full min-w-0 border-0 bg-transparent text-base text-foreground outline-none"
            />
          </label>
          <Segmented items={FILTERS} value={status} onChange={onStatus} itemClassName="px-3.5 text-[13px] font-medium" />
        </div>
      )}

      {rows.length > 0 &&
        (isMobile ? (
          <div className="flex flex-col gap-1.5">
            {groups.map((g) => (
              <div key={g.key} className="flex flex-col">
                <div className="pt-2 pb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{g.label}</div>
                {g.rows.map((t) => (
                  <div key={t.id} data-anim="" className="flex min-h-16 items-center gap-3 border-b border-border">
                    <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-muted">
                      <Icon icon={t.icon} size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{t.name}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {t.category} · {t.timeText}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[15px] font-semibold tabular-nums" style={{ color: t.amountFg }}>
                        {t.amountText}
                      </span>
                      <span className="badge" style={badge(t.st)}>
                        {t.st.label}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[13px] text-muted-foreground">
                  <th className="w-7 border-b border-border px-2 py-2.5 font-medium">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={() => setSelected(Object.fromEntries(rows.map((r) => [r.id, !allChecked])))}
                      aria-label="Selecionar todas"
                      className="m-0 size-4 cursor-pointer accent-brand"
                    />
                  </th>
                  <th className="border-b border-border px-2 py-2.5 font-medium">Estabelecimento</th>
                  <th className="border-b border-border px-2 py-2.5 font-medium">Categoria</th>
                  <th className="border-b border-border px-2 py-2.5 text-right font-medium">Valor</th>
                  <th className="border-b border-border px-2 py-2.5 font-medium">Status</th>
                  <th className="border-b border-border px-2 py-2.5 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-muted" style={{ background: selected[t.id] ? 'var(--brand-soft)' : undefined }}>
                    <td className="border-b border-border px-2 py-3">
                      <input
                        type="checkbox"
                        checked={!!selected[t.id]}
                        onChange={() => setSelected((p) => ({ ...p, [t.id]: !p[t.id] }))}
                        aria-label={`Selecionar ${t.name}`}
                        className="m-0 size-4 cursor-pointer accent-brand"
                      />
                    </td>
                    <td className="border-b border-border px-2 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-muted">
                          <Icon icon={t.icon} size={17} />
                        </span>
                        <div className="min-w-0">
                          <div className="max-w-[340px] truncate font-semibold">{t.name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{t.account}</div>
                        </div>
                      </div>
                    </td>
                    <td className="border-b border-border px-2 py-3">
                      <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium whitespace-nowrap">{t.category}</span>
                    </td>
                    <td className="border-b border-border px-2 py-3 text-right font-semibold whitespace-nowrap tabular-nums" style={{ color: t.amountFg }}>
                      {t.amountText}
                    </td>
                    <td className="border-b border-border px-2 py-3">
                      <span className="badge px-2.5 py-1 text-xs" style={badge(t.st)}>
                        {t.st.label}
                      </span>
                    </td>
                    <td className="border-b border-border px-2 py-3 whitespace-nowrap text-muted-foreground">{t.dateText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {rows.length === 0 && empty}
      {footer}
    </div>
  );
}

function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
      <PlutoLogo size={64} />
      <div className="text-base font-semibold">{title}</div>
      <div className="max-w-[340px] text-sm text-pretty text-muted-foreground">{text}</div>
      {action}
    </div>
  );
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Transacoes reais (GET /v1/transactions) com busca no servidor e paginacao por cursor. */
export function LiveTransactionList({
  mode,
  limit = 0,
  title = 'Transações recentes',
  controls = true,
  onShowAll,
  onConnect,
}: {
  mode: Mode;
  limit?: number;
  title?: string;
  controls?: boolean;
  onShowAll?: () => void;
  onConnect?: () => void;
}) {
  const tz = useApp((s) => s.user?.settings.timezone) ?? 'America/Manaus';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const q = useDebounced(query.trim());

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
  const tx = useInfiniteQuery({
    queryKey: ['transactions', { q, limit }],
    queryFn: ({ pageParam }) => api.transactions({ q: q || undefined, cursor: pageParam, limit: limit || 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (limit ? undefined : (last.nextCursor ?? undefined)),
  });

  const accName = Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a.numberMasked ? `${a.name} ·${a.numberMasked}` : a.name]));
  const today = ymdIn(new Date(), tz);
  const items: Transaction[] = (tx.data?.pages ?? []).flatMap((p) => p.items).filter((t) => status === 'ALL' || t.status === status);
  const rows: Row[] = items.map((t) => {
    const cat = categoryOf(t.providerCategory), day = ymdIn(t.date, tz);
    return {
      id: t.id,
      name: t.merchant ?? t.description,
      account: accName[t.accountId] ?? '',
      icon: cat.icon,
      category: t.type === 'CARD_PAYMENT' ? 'Pagamento de fatura' : t.type === 'TRANSFER' ? 'Entre minhas contas' : cat.label,
      ...amount(t.amountMinor / 100, t.amountMinor > 0),
      st: STATUS[t.status]!,
      dateText: fmtDateTimeIn(t.date, tz),
      timeText: fmtTimeIn(t.date, tz),
      dayKey: day,
      dayLabel: dayLabelOf(day, today),
    };
  });

  const summary = tx.isPending
    ? 'Carregando…'
    : tx.isError
      ? 'Não foi possível carregar'
      : limit
        ? `Últimas ${rows.length} transações`
        : `${rows.length}${tx.hasNextPage ? '+' : ''} transações`;

  const empty = tx.isPending ? (
    <div className="py-8 text-center text-sm text-muted-foreground">Carregando transações…</div>
  ) : tx.isError ? (
    <Empty title="Não consegui buscar suas transações" text="Verifique se a API está rodando e tente de novo." action={<button onClick={() => tx.refetch()} className="btn btn-outline mt-1">Tentar de novo</button>} />
  ) : q || status !== 'ALL' ? (
    <Empty title="Não achei nada por aqui" text="Tente outro nome ou limpe os filtros." action={<button onClick={() => { setQuery(''); setStatus('ALL'); }} className="btn btn-outline mt-1">Limpar filtros</button>} />
  ) : (
    <Empty
      title="Nenhuma transação ainda"
      text="Conecte um banco em Configurações. A Pluto importa o histórico na hora."
      action={onConnect && <button onClick={onConnect} className="btn btn-primary mt-1">Conectar banco</button>}
    />
  );

  return (
    <TransactionListView
      mode={mode}
      title={title}
      summary={summary}
      rows={rows}
      onShowAll={onShowAll}
      controls={controls}
      query={query}
      onQuery={setQuery}
      status={status}
      onStatus={setStatus}
      empty={empty}
      footer={
        tx.hasNextPage && (
          <button onClick={() => tx.fetchNextPage()} disabled={tx.isFetchingNextPage} className="btn btn-outline self-center">
            {tx.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </button>
        )
      }
    />
  );
}

/** Lista com dados de exemplo do design (usada onde a API ainda nao tem endpoint, como Cartoes). */
export function TransactionList({
  mode,
  limit = 0,
  title = 'Transações recentes',
  controls = true,
  onShowAll,
  accountId,
}: {
  mode: Mode;
  limit?: number;
  title?: string;
  controls?: boolean;
  onShowAll?: () => void;
  accountId?: string;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const accName = Object.fromEntries(MOCK.pluggy.accounts.map((a) => [a.id, a.name]));
  const q = query.trim().toLowerCase();
  let list = MOCK.pluggy.transactions
    .filter((t) => (!accountId || t.accountId === accountId) && (status === 'ALL' || t.status === status) && (!q || (t.description + ' ' + t.category).toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const all = list.length;
  if (limit) list = list.slice(0, limit);
  const rows: Row[] = list.map((t) => ({
    id: t.id,
    name: t.description,
    account: accName[t.accountId] ?? '',
    icon: CAT_ICON[t.category] ?? 'receipt',
    category: t.category,
    ...amount(t.amount, t.amount > 0),
    st: STATUS[t.status]!,
    dateText: fmtDate(t.date),
    timeText: t.date.slice(11, 16),
    dayKey: t.date.slice(0, 10),
    dayLabel: dayLabelOf(t.date.slice(0, 10), TODAY),
  }));
  return (
    <TransactionListView
      mode={mode}
      title={title}
      summary={limit ? `Últimas ${rows.length} de ${all} em outubro` : `${all} transações em outubro`}
      rows={rows}
      onShowAll={onShowAll}
      controls={controls}
      query={query}
      onQuery={setQuery}
      status={status}
      onStatus={setStatus}
      empty={<Empty title="Não achei nada por aqui" text="Tente outro nome ou limpe os filtros." />}
    />
  );
}
