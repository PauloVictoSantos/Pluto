'use client';

import { categoryOf, type Transaction } from '@pluto/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { fmtDateTimeIn, ymdIn } from '@/lib/datetime';
import { fmtDay } from '@/lib/format';
import { MerchantLogo, merchantInfo } from '@/lib/merchants';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';
import { Sheet, SheetCloseButton, useSheetClose } from './ui/Sheet';

/** Detalhe da transacao (toque na lista): tudo o que se sabe dela, sem modal para editar dados. */
export function TransactionDetailSheet({ tx, tz, account, onClose, onCategory }: { tx: Transaction; tz: string; account: string; onClose: () => void; onCategory: () => void }) {
  const qc = useQueryClient();
  const info = merchantInfo(tx);
  const [name, setName] = useState(info.name);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(info.name);
  const rename = useMutation({
    mutationFn: (n: string | null) => api.renameTransaction(tx.id, n),
    onSuccess: (r) => {
      setName(r.name ?? merchantInfo({ ...tx, nameOverride: null }).name);
      setRenaming(false);
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const cat = categoryOf(tx.categoryKey);
  const inst = tx.installment;
  const parcel = Math.abs(tx.amountMinor);
  const remaining = inst ? parcel * (inst.total - inst.n) : null;
  const credit = tx.amountMinor > 0;
  const origin = tx.tags.includes('dividido') ? (tx.categoryKey === 'pago-dividido' ? 'Importada do banco · dividida entre compras' : 'Parte de um pagamento dividido') : 'Importada do banco';

  return (
    <Sheet onClose={onClose} label="Detalhe da transação" width={480} top="6vh" gap={14}>
      <div className="flex justify-end">
        <SheetCloseButton>
          <Icon icon="x" size={18} />
        </SheetCloseButton>
      </div>
      <div className="-mt-6 flex flex-col items-center gap-2 text-center">
        <MerchantLogo brand={info.brand} categoryKey={tx.categoryKey} size={72} />
        {renaming ? (
          <div className="flex w-full items-center gap-1.5">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) rename.mutate(draft.trim());
                if (e.key === 'Escape') setRenaming(false);
              }}
              maxLength={40}
              aria-label="Novo nome do estabelecimento"
              className="input h-11 min-w-0 flex-1"
            />
            <button onClick={() => draft.trim() && rename.mutate(draft.trim())} disabled={rename.isPending} className="btn btn-primary h-11 px-3">
              Salvar
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-lg font-bold tracking-[-0.01em]">{name}</span>
            <button onClick={() => (setDraft(name), setRenaming(true))} aria-label="Renomear estabelecimento" className="icon-btn size-8 border-0">
              <Icon icon="pencil" size={14} />
            </button>
          </div>
        )}
        {renaming && (
          <div className="text-xs text-muted-foreground">
            Vale para todas as compras de “{tx.description}”.{' '}
            {tx.nameOverride && (
              <button onClick={() => rename.mutate(null)} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-brand-text underline">
                Voltar ao nome automático
              </button>
            )}
          </div>
        )}
        <div className="text-[32px] font-bold tracking-[-0.04em] tabular-nums" style={{ color: credit ? 'var(--brand-text)' : undefined }}>
          {credit ? '+ ' : '− '}
          {money(parcel)}
        </div>
        {inst && <div className="-mt-1 text-sm text-muted-foreground">de {money(parcel * inst.total)} no total</div>}
      </div>

      <dl className="m-0 flex flex-col">
        <Row label="Descrição do banco">{tx.description}</Row>
        <Row label="Categoria">
          <button onClick={onCategory} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-1 text-sm text-foreground hover:border-brand">
            <Icon icon={cat.icon} size={14} />
            {cat.label}
            <Icon icon="chevron-right" size={14} />
          </button>
        </Row>
        {account && <Row label="Cartão ou conta">{account}</Row>}
        {inst && (
          <>
            <Row label="Parcela">
              {inst.n} de {inst.total} · {money(parcel)}
            </Row>
            <Row label="Falta pagar">{remaining ? `${money(remaining)} (${inst.total - inst.n} parcela${inst.total - inst.n > 1 ? 's' : ''})` : 'Nada: é a última parcela'}</Row>
          </>
        )}
        <Row label="Data">{tx.hasTime ? fmtDateTimeIn(tx.date, tz) : fmtDay(ymdIn(tx.date, tz))}</Row>
        <Row label="Status">{tx.status === 'PENDING' ? 'Pendente' : 'Concluída'}</Row>
        <Row label="Origem">{origin}</Row>
      </dl>
      <CloseButton />
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-t border-border py-2">
      <dt className="shrink-0 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

function CloseButton() {
  const close = useSheetClose();
  return (
    <button onClick={close} className="btn btn-outline h-12">
      Fechar
    </button>
  );
}
