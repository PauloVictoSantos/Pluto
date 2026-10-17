'use client';

import { useRef, useState } from 'react';
import { daysBetween, fmt, fmtDate, fmtDay } from '@/lib/format';
import { MOCK, TODAY } from '@/lib/mock/data';
import { CAT_ICON, STATUS } from '@/lib/mock/vm';
import { useEnter } from '@/lib/motion';
import type { Mode } from '@/lib/viewport';
import { PlutoLogo } from './brand/PlutoLogo';
import { Icon } from './ui/Icon';
import { Segmented } from './ui/Segmented';

type StatusFilter = 'ALL' | 'POSTED' | 'PENDING' | 'PROCESSING';
const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'Todas' },
  { id: 'POSTED', label: 'Concluídas' },
  { id: 'PENDING', label: 'Pendentes' },
  { id: 'PROCESSING', label: 'Processando' },
];

interface Props {
  mode: Mode;
  limit?: number;
  title?: string;
  controls?: boolean;
  onShowAll?: () => void;
  accountId?: string;
}

export function TransactionList({ mode, limit = 0, title = 'Transações recentes', controls = true, onShowAll, accountId }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);
  const isMobile = mode === 'mobile';

  const accName = Object.fromEntries(MOCK.pluggy.accounts.map((a) => [a.id, a.name]));
  const q = query.trim().toLowerCase();
  let list = MOCK.pluggy.transactions.filter(
    (t) =>
      (!accountId || t.accountId === accountId) &&
      (status === 'ALL' || t.status === status) &&
      (!q || (t.description + ' ' + t.category).toLowerCase().includes(q)),
  );
  list = [...list].sort((a, b) => b.date.localeCompare(a.date));
  const all = list.length;
  if (limit) list = list.slice(0, limit);

  const rows = list.map((t) => {
    const st = STATUS[t.status]!, credit = t.amount > 0;
    return {
      ...t,
      account: accName[t.accountId],
      icon: CAT_ICON[t.category] ?? 'receipt',
      amountText: (credit ? '+ ' : '− ') + fmt(Math.abs(t.amount)),
      amountFg: credit ? 'var(--brand-text)' : 'var(--foreground)',
      st,
      checked: !!selected[t.id],
    };
  });
  const groups: { key: string; label: string; rows: typeof rows }[] = [];
  rows.forEach((r) => {
    const d = r.date.slice(0, 10), diff = daysBetween(d, TODAY);
    const label = diff === 0 ? 'Hoje' : diff === 1 ? 'Ontem' : fmtDay(d);
    if (!groups.length || groups[groups.length - 1]!.key !== d) groups.push({ key: d, label, rows: [] });
    groups[groups.length - 1]!.rows.push(r);
  });

  const nSel = rows.filter((r) => r.checked).length, allChecked = rows.length > 0 && nSel === rows.length;
  const toggle = (id: string) => setSelected((p) => ({ ...p, [id]: !p[id] }));
  const toggleAll = () =>
    setSelected((p) => {
      const sel = { ...p };
      rows.forEach((r) => (sel[r.id] = !allChecked));
      return sel;
    });
  const summary = nSel
    ? `${nSel} selecionada${nSel > 1 ? 's' : ''}`
    : limit
      ? `Últimas ${rows.length} de ${all} em outubro`
      : `${all} transações em outubro`;

  const badge = (st: (typeof rows)[number]['st']) => ({ background: st.bg, color: st.fg, borderColor: st.border });

  return (
    <div ref={root} className="card flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="card-title">{title}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">{summary}</div>
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
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar estabelecimento ou categoria"
              aria-label="Buscar transações"
              className="w-full min-w-0 border-0 bg-transparent text-base text-foreground outline-none"
            />
          </label>
          <Segmented items={FILTERS} value={status} onChange={setStatus} itemClassName="px-3.5 text-[13px] font-medium" />
        </div>
      )}

      {isMobile ? (
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
                    <div className="truncate text-[15px] font-semibold">{t.description}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {t.category} · {t.date.slice(11, 16)}
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
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Selecionar todas" className="m-0 size-4 cursor-pointer accent-brand" />
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
                <tr key={t.id} className="hover:bg-muted" style={{ background: t.checked ? 'var(--brand-soft)' : undefined }}>
                  <td className="border-b border-border px-2 py-3">
                    <input type="checkbox" checked={t.checked} onChange={() => toggle(t.id)} aria-label={`Selecionar ${t.description}`} className="m-0 size-4 cursor-pointer accent-brand" />
                  </td>
                  <td className="border-b border-border px-2 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-muted">
                        <Icon icon={t.icon} size={17} />
                      </span>
                      <div>
                        <div className="font-semibold">{t.description}</div>
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
                  <td className="border-b border-border px-2 py-3 whitespace-nowrap text-muted-foreground">{fmtDate(t.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 && (
        <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
          <PlutoLogo size={64} />
          <div className="text-base font-semibold">Não achei nada por aqui</div>
          <div className="text-sm text-muted-foreground">Tente outro nome ou limpe os filtros.</div>
          <button
            onClick={() => {
              setQuery('');
              setStatus('ALL');
            }}
            className="btn btn-outline mt-1"
          >
            Limpar filtros
          </button>
        </div>
      )}
    </div>
  );
}
