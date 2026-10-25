'use client';

import { LOAN_KINDS, LOAN_KIND_LABEL, type Loan, type LoanKind } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { MESES, maskMoney, hidePct } from '@/lib/format';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';
import { Sheet } from './ui/Sheet';

const pct = (r: number) => `${(r * 100).toFixed(2).replace('.', ',')}%`;
const monthText = (m: string) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const months = (n: number) => (n >= 12 ? `${Math.floor(n / 12)} ano${n >= 24 ? 's' : ''}${n % 12 ? ` e ${n % 12} ${n % 12 === 1 ? 'mês' : 'meses'}` : ''}` : `${n} ${n === 1 ? 'mês' : 'meses'}`);

/**
 * Dividas com juros (Contas a pagar): emprestimo, financiamento, rotativo, cheque especial. O servidor
 * calcula prazo, juros e a ordem de quitacao (maior taxa primeiro); aqui so se mostra e simula.
 */
export function LoansCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['loans'], queryFn: api.loans });
  const [sheet, setSheet] = useState<{ loan: Loan | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [extra, setExtra] = useState({ text: '', value: 0 });
  const sim = useMutation({ mutationFn: ({ id, amountMinor }: { id: string; amountMinor: number }) => api.loanExtra(id, amountMinor) });
  const saved = (data: Awaited<ReturnType<typeof api.loans>>) => {
    qc.setQueryData(['loans'], data);
    void qc.invalidateQueries({ queryKey: ['fixed-expenses'] });
    setSheet(null);
  };
  const d = q.data;
  const share = d?.incomeShare ?? null;

  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    setExtra({ text: '', value: 0 });
    sim.reset();
  };

  const row = (l: Loan) => {
    const isOpen = open === l.id;
    const done = l.balanceMinor <= 0;
    return (
      <div key={l.id} className="border-t border-border py-3">
        <button onClick={() => toggle(l.id)} aria-expanded={isOpen} className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-foreground">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-bold"
            style={{ background: l.highInterest ? 'var(--danger-soft)' : 'var(--muted)', color: l.highInterest ? 'var(--danger-text)' : 'var(--foreground)' }}
            title={l.payoffRank ? `${l.payoffRank}º a quitar` : 'Quitada'}
          >
            {l.payoffRank ? `${l.payoffRank}º` : <Icon icon="circle-check" size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{l.creditor}</span>
            <span className="block truncate text-[12.5px] text-muted-foreground">
              {LOAN_KIND_LABEL[l.kind]} · {pct(l.monthlyRate)} ao mês{l.rateInferred ? ' (calculada)' : ''}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-[15px] font-semibold tabular-nums">{money(l.balanceMinor)}</span>
            {l.installmentMinor && <span className="block text-[11.5px] text-muted-foreground tabular-nums">{money(l.installmentMinor)}/mês</span>}
          </span>
        </button>
        <div className="mt-1.5 pl-12 text-[12.5px]" style={{ color: l.payoffMonths === null && !done ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>
          {done
            ? 'Pelo saldo estimado, esta dívida já foi quitada. Exclua ou atualize o saldo.'
            : l.payoffMonths === null
              ? `${l.installmentMinor ? 'A parcela não cobre os juros' : 'Sem parcela fixa'}: são ${money(l.monthlyInterestMinor)} de juros por mês e a dívida não diminui.`
              : `Quita em ${months(l.payoffMonths)}${l.endsOn ? ` (${monthText(l.endsOn)})` : ''} · ainda ${money(l.totalInterestMinor ?? 0)} de juros`}
          {l.highInterest && !done && <span className="ml-1.5 font-semibold text-danger-text">Juros altos: quitar vem antes de metas de compra.</span>}
        </div>
        {isOpen && (
          <div className="mt-3 ml-12 flex flex-col gap-2.5 rounded-xl bg-muted p-3">
            {!done && (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  if (extra.value > 0) sim.mutate({ id: l.id, amountMinor: Math.round(extra.value * 100) });
                }}
              >
                <label className="text-[13px] font-semibold" htmlFor={`extra-${l.id}`}>
                  E se eu amortizar hoje…
                </label>
                <div className="flex gap-2">
                  <input id={`extra-${l.id}`} value={extra.text} onChange={(e) => setExtra(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input flex-1" />
                  <button type="submit" disabled={!extra.value || sim.isPending} className="btn btn-primary h-11 px-4 text-[14px]">
                    Simular
                  </button>
                </div>
                {sim.data && (
                  <div role="status" className="text-[13px]">
                    {sim.data.interestSavedMinor !== null ? (
                      <>
                        Você deixa de pagar <strong className="tabular-nums">{money(sim.data.interestSavedMinor)}</strong> de juros
                        {sim.data.monthsSaved ? ` e termina ${months(sim.data.monthsSaved)} antes` : ''}.
                      </>
                    ) : (
                      <>
                        São <strong className="tabular-nums">{money(sim.data.monthlyInterestSavedMinor)}</strong> a menos de juros já no próximo mês.
                      </>
                    )}
                  </div>
                )}
              </form>
            )}
            <div className="flex gap-2">
              <button onClick={() => setSheet({ loan: l })} className="btn btn-outline h-10 flex-1 bg-card text-[13px]">
                Atualizar saldo e dados
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <section data-anim="" className="card flex flex-col" aria-label="Dívidas com juros">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="card-title">Dívidas com juros</div>
          <div className="mt-1 text-[13px] text-muted-foreground">Empréstimos, financiamentos, rotativo e cheque especial. A ordem mostra qual quitar primeiro: a de maior juro.</div>
        </div>
        <button onClick={() => setSheet({ loan: null })} className="btn btn-outline h-10 px-3 text-[13px]">
          <Icon icon="plus" size={14} />
          Adicionar
        </button>
      </div>

      {q.isPending && <div className="mt-3 h-20 animate-pulse rounded-xl bg-muted" />}
      {d && d.items.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-[12px] text-muted-foreground">
          <div>
            Saldo devedor
            <div className="text-[16px] font-bold text-foreground tabular-nums">{money(d.balanceMinor)}</div>
          </div>
          <div>
            Parcelas/mês
            <div className="text-[16px] font-bold text-foreground tabular-nums">{money(d.monthlyInstallmentsMinor)}</div>
          </div>
          <div>
            Juros este mês
            <div className="text-[16px] font-bold text-danger-text tabular-nums">{money(d.monthlyInterestMinor)}</div>
          </div>
        </div>
      )}
      {share !== null && share > 0.3 && (
        <div role="status" className="mt-3 flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          As parcelas de dívida levam {hidePct(`${Math.round(share * 100)}%`)} da sua renda. O saudável é até 30%.
        </div>
      )}
      {d && !d.items.length && <div className="mt-2 border-t border-border py-4 text-sm text-muted-foreground">Nenhuma dívida com juros cadastrada.</div>}
      <div className="mt-2 flex flex-col">{d?.items.map(row)}</div>

      {sheet && <LoanSheet loan={sheet.loan} onClose={() => setSheet(null)} onSaved={saved} />}
    </section>
  );
}

function LoanSheet({ loan, onClose, onSaved }: { loan: Loan | null; onClose: () => void; onSaved: (d: Awaited<ReturnType<typeof api.loans>>) => void }) {
  const [creditor, setCreditor] = useState(loan?.creditor ?? '');
  const [kind, setKind] = useState<LoanKind>(loan?.kind ?? 'emprestimo');
  const [balance, setBalance] = useState(() => maskMoney(loan ? String(loan.balanceMinor) : ''));
  const [rate, setRate] = useState(loan && !loan.rateInferred ? (loan.monthlyRate * 100).toFixed(2).replace('.', ',') : '');
  const [installment, setInstallment] = useState(() => maskMoney(loan?.installmentMinor ? String(loan.installmentMinor) : ''));
  const [left, setLeft] = useState(loan?.installmentsLeft ? String(loan.installmentsLeft) : '');
  const [dueDay, setDueDay] = useState(loan?.dueDay ?? 10);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.');

  const rateValue = rate.trim() ? Number(rate.replace(',', '.')) / 100 : null;
  const rateOk = rateValue === null || (Number.isFinite(rateValue) && rateValue >= 0 && rateValue <= 0.5);
  const leftN = left ? Math.max(1, Math.min(600, Math.round(+left))) : null;
  const termsOk = rateValue !== null || (installment.value > 0 && !!leftN);
  const ok = !!creditor.trim() && balance.value > 0 && rateOk && termsOk;
  const body = () => ({
    creditor: creditor.trim(),
    kind,
    balanceMinor: Math.round(balance.value * 100),
    monthlyRate: rateValue === null ? null : Math.round(rateValue * 1e6) / 1e6,
    installmentMinor: installment.value > 0 ? Math.round(installment.value * 100) : null,
    installmentsLeft: leftN,
    dueDay,
  });
  const save = useMutation({ mutationFn: () => (loan ? api.updateLoan(loan.id, body()) : api.createLoan(body())), onSuccess: onSaved, onError: fail });
  const remove = useMutation({ mutationFn: () => api.deleteLoan(loan!.id), onSuccess: onSaved, onError: fail });
  const busy = save.isPending || remove.isPending;

  return (
    <Sheet
      onClose={onClose}
      label={loan ? 'Atualizar dívida' : 'Nova dívida com juros'}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy) save.mutate();
      }}
    >
      <div className="text-xl font-bold tracking-[-0.02em]">{loan ? `Atualizar “${loan.creditor}”` : 'Nova dívida com juros'}</div>
      <label className="field">
        Com quem é a dívida
        <input value={creditor} onChange={(e) => setCreditor(e.target.value)} placeholder="Ex.: Banco, financeira" maxLength={60} className="input" autoFocus={!loan} />
      </label>
      <label className="field">
        Tipo
        <select value={kind} onChange={(e) => setKind(e.target.value as LoanKind)} className="input">
          {LOAN_KINDS.map((k) => (
            <option key={k} value={k}>
              {LOAN_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Quanto falta pagar hoje
        <input value={balance.text} onChange={(e) => setBalance(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input h-14 text-2xl font-bold" />
      </label>
      <label className="field">
        Juros ao mês (%)
        <input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d,.]/g, '').slice(0, 6))} inputMode="decimal" placeholder="Ex.: 3,5" className="input" aria-invalid={!rateOk} />
        <span className="text-[12px] font-normal text-muted-foreground">Não sabe? Deixe vazio e informe a parcela e quantas faltam: a gente calcula.</span>
      </label>
      <div className="flex gap-2.5">
        <label className="field flex-1">
          Parcela
          <input value={installment.text} onChange={(e) => setInstallment(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input" />
        </label>
        <label className="field w-[110px]">
          Faltam
          <input type="number" min={1} max={600} value={left} onChange={(e) => setLeft(e.target.value)} placeholder="nº" className="input" />
        </label>
        <label className="field w-[90px]">
          Vence dia
          <input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(Math.min(31, Math.max(1, +e.target.value || 1)))} className="input" />
        </label>
      </div>
      {!termsOk && balance.value > 0 && <div className="text-[12.5px] text-muted-foreground">Informe os juros ao mês, ou a parcela e quantas faltam.</div>}
      {error && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}
      <div className="flex gap-2.5">
        {loan ? (
          confirmDelete ? (
            <button type="button" onClick={() => remove.mutate()} disabled={busy} className="btn h-[50px] flex-1 border-transparent bg-danger-soft text-[15px] text-danger-text">
              Confirmar exclusão
            </button>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="btn btn-outline h-[50px] flex-1 text-[15px]">
              Excluir
            </button>
          )
        ) : (
          <button type="button" onClick={onClose} className="btn btn-outline h-[50px] flex-1 text-[15px]">
            Cancelar
          </button>
        )}
        <button type="submit" disabled={!ok || busy} className="btn btn-primary h-[50px] flex-1 text-[15px]" style={{ opacity: ok && !busy ? 1 : 0.5 }}>
          {busy ? 'Salvando…' : loan ? 'Salvar' : 'Adicionar'}
        </button>
      </div>
    </Sheet>
  );
}
