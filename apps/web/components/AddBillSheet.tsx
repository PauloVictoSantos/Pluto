'use client';

import { parseBoletoLine } from '@pluto/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { fmtDay, maskMoney } from '@/lib/format';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';
import { Sheet, useSheetClose } from './ui/Sheet';

/** Cadastro de boleto a pagar: cole a linha digitavel (valor e vencimento saem dela) ou preencha a mao. */
export function AddBillSheet({ onClose, today }: { onClose: () => void; today: string }) {
  const qc = useQueryClient();
  const [payee, setPayee] = useState('');
  const [line, setLine] = useState('');
  const [amount, setAmount] = useState({ text: '', value: 0 });
  const [due, setDue] = useState('');
  const [error, setError] = useState('');

  const digits = line.replace(/\D/g, '');
  const parsed = digits.length >= 47 ? parseBoletoLine(digits) : null;
  const badLine = digits.length > 0 && (digits.length < 47 || !parsed);
  const needAmount = !parsed?.amountMinor, needDue = !parsed?.dueDate;
  const ok = !!payee.trim() && !badLine && (!needAmount || amount.value > 0) && (!needDue || !!due);

  const save = useMutation({
    mutationFn: () =>
      api.createBill({
        payee: payee.trim(),
        ...(digits ? { line: digits } : {}),
        ...(needAmount ? { amountMinor: Math.round(amount.value * 100) } : {}),
        ...(needDue ? { dueDate: due } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bills'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar. Tente de novo.'),
  });

  return (
    <Sheet
      onClose={onClose}
      label="Adicionar boleto"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) save.mutate();
      }}
    >
      <div className="text-xl font-bold tracking-[-0.02em]">Adicionar boleto a pagar</div>
      <label className="field">
        Para quem é
        <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Ex.: Condomínio, escola, energia" maxLength={80} className="input" autoFocus />
      </label>
      <label className="field">
        Linha digitável (opcional)
        <input
          value={line}
          onChange={(e) => setLine(e.target.value.replace(/[^\d. ]/g, '').slice(0, 64))}
          inputMode="numeric"
          placeholder="Cole os números do boleto"
          className="input font-mono text-[15px]"
          aria-invalid={badLine}
        />
      </label>
      {badLine && <div className="-mt-2 text-[13px] text-danger-text">{digits.length < 47 ? `Faltam ${47 - digits.length} dígitos.` : 'Algum número não confere. Confira a linha.'}</div>}
      {parsed && (parsed.amountMinor || parsed.dueDate) && (
        <div className="-mt-1 flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-2 text-[13px] text-brand-text">
          <Icon icon="circle-check" size={16} />
          Lido do boleto: {parsed.amountMinor ? money(parsed.amountMinor) : 'valor a informar'}
          {parsed.dueDate ? `, vence ${fmtDay(parsed.dueDate)}` : ''}
        </div>
      )}
      {(needAmount || needDue) && (
        <div className="grid grid-cols-2 gap-2">
          {needAmount && (
            <label className="field">
              Valor
              <input value={amount.text} onChange={(e) => setAmount(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input" />
            </label>
          )}
          {needDue && (
            <label className="field">
              Vencimento
              <input type="date" value={due} min={`${+today.slice(0, 4) - 1}${today.slice(4)}`} onChange={(e) => setDue(e.target.value)} className="input" />
            </label>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}
      <Actions ok={ok} busy={save.isPending} />
    </Sheet>
  );
}

function Actions({ ok, busy }: { ok: boolean; busy: boolean }) {
  const close = useSheetClose();
  return (
    <div className="flex gap-2.5">
      <button type="button" onClick={close} className="btn btn-outline h-[50px] flex-1">
        Cancelar
      </button>
      <button type="submit" disabled={!ok || busy} className="btn btn-primary h-[50px] flex-1" style={{ opacity: ok && !busy ? 1 : 0.5 }}>
        {busy ? 'Salvando…' : 'Adicionar'}
      </button>
    </div>
  );
}
