'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { useShell } from '@/components/shell/ShellContext';
import { StatTiles, tileBrand, tilePlain } from '@/components/StatTiles';
import { LiveTransactionList } from '@/components/TransactionList';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { categoryOf } from '@/lib/categories';
import { fmtDateTimeIn, monthLabelIn, startOfMonthIn } from '@/lib/datetime';
import { downloadCsv, fmt } from '@/lib/format';
import { useEnter } from '@/lib/motion';
import { useApp } from '@/lib/store';

export default function TransacoesPage() {
  const { mode, nav } = useShell();
  const tz = useApp((s) => s.user?.settings.timezone) ?? 'America/Manaus';
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const now = new Date();
  const from = startOfMonthIn(now, tz);
  const summary = useQuery({ queryKey: ['transactions', 'summary', from.toISOString()], queryFn: () => api.transactionSummary(from) });
  const s = summary.data;
  const money = (minor: number | undefined) => (minor === undefined ? '—' : fmt(minor / 100));

  // Exportacao das transacoes do mes (RF-14 usa /export completo; aqui e so a visao atual).
  const exportCsv = async () => {
    const rows: (string | number)[][] = [['Data', 'Descrição', 'Categoria', 'Valor', 'Status']];
    let cursor: string | undefined;
    do {
      const page = await api.transactions({ from, limit: 200, cursor });
      page.items.forEach((t) =>
        rows.push([fmtDateTimeIn(t.date, tz), t.description, categoryOf(t.providerCategory).label, (t.amountMinor / 100).toFixed(2).replace('.', ','), t.status === 'PENDING' ? 'Pendente' : 'Concluída']),
      );
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    downloadCsv(`transacoes-${from.toISOString().slice(0, 7)}.csv`, rows);
  };

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Transações</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">{monthLabelIn(now, tz)} · todas as contas e cartões</p>
        </div>
        <button onClick={() => void exportCsv()} className="btn btn-outline">
          <Icon icon="download" size={16} />
          Exportar CSV
        </button>
      </div>
      <StatTiles
        tiles={[
          { label: 'Entradas', value: money(s?.incomeMinor), ...tileBrand },
          { label: 'Saídas', value: money(s?.expensesMinor), ...tilePlain },
          { label: 'Resultado', value: s ? fmt((s.incomeMinor - s.expensesMinor) / 100) : '—', ...tilePlain },
        ]}
      />
      <div data-anim="">
        <LiveTransactionList mode={mode} title="Todas as transações" onConnect={() => nav('settings')} />
      </div>
    </div>
  );
}
