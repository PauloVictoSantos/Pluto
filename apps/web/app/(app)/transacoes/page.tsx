'use client';

import { useRef } from 'react';
import { useShell } from '@/components/shell/ShellContext';
import { StatTiles, tileBrand, tilePlain } from '@/components/StatTiles';
import { TransactionList } from '@/components/TransactionList';
import { Icon } from '@/components/ui/Icon';
import { downloadCsv, fmt, fmtDate } from '@/lib/format';
import { MOCK } from '@/lib/mock/data';
import { STATUS } from '@/lib/mock/vm';
import { useEnter } from '@/lib/motion';

export default function TransacoesPage() {
  const { mode } = useShell();
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const tx = MOCK.pluggy.transactions;
  const inc = tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const out = tx.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);

  const exportCsv = () =>
    downloadCsv('transacoes-outubro-2026.csv', [
      ['Data', 'Descrição', 'Categoria', 'Valor', 'Status'],
      ...tx.map((t) => [fmtDate(t.date), t.description, t.category, t.amount.toFixed(2).replace('.', ','), STATUS[t.status]!.label]),
    ]);

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Transações</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">Outubro 2026 · todas as contas e cartões</p>
        </div>
        <button onClick={exportCsv} className="btn btn-outline">
          <Icon icon="download" size={16} />
          Exportar CSV
        </button>
      </div>
      <StatTiles
        tiles={[
          { label: 'Entradas', value: fmt(inc), ...tileBrand },
          { label: 'Saídas', value: fmt(out), ...tilePlain },
          { label: 'Resultado', value: fmt(inc - out), ...tilePlain },
        ]}
      />
      <div data-anim="">
        <TransactionList mode={mode} title="Todas as transações" />
      </div>
    </div>
  );
}
