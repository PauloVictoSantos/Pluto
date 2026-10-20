'use client';

import { CATEGORIES, categoryOf, installmentAmount, type Commitment, type DebtSource } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { MESES, maskMoney } from '@/lib/format';
import { money } from '@/lib/queries';
import { CreditCard, cardTheme } from './CreditCard';
import { Icon } from './ui/Icon';
import { Sheet, useSheetClose } from './ui/Sheet';

// Dividas manuais em Contas a pagar: compras parceladas e mensalidades numa forma de pagamento que o
// Open Finance nao ve (ex.: o cartao de um parente, pago a ele por boleto todo mes).

const METHODS = [
  { id: 'third_party_card' as const, label: 'Cartão de outra pessoa' },
  { id: 'boleto' as const, label: 'Boleto' },
  { id: 'pix' as const, label: 'Pix' },
];
const BRANDS = ['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard', 'Outra'];
const SPEND = CATEGORIES.filter((c) => c.group === 'essential' || c.group === 'lifestyle');
const monthLabel = (ym: string) => `${MESES[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const nextMonth = (ym: string) => {
  const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 1));
  return d.toISOString().slice(0, 7);
};

type Dialog = { kind: 'source'; source?: DebtSource } | { kind: 'item'; sourceId: string } | null;

export function DebtsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['debts'], queryFn: api.debts });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');
  const done = (list: DebtSource[]) => {
    qc.setQueryData(['debts'], list);
    // O boleto do mes, a projecao e os avisos dependem das dividas.
    for (const k of ['bills', 'analytics']) void qc.invalidateQueries({ queryKey: [k] });
    setDialog(null);
    setError('');
  };
  const fail = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar. Tente de novo.');
  const end = useMutation({ mutationFn: (c: Commitment) => api.updateCommitment(c.id, { active: false }), onSuccess: done, onError: fail });
  const remove = useMutation({ mutationFn: (c: Commitment) => api.deleteCommitment(c.id), onSuccess: done, onError: fail });

  const list = q.data ?? [];
  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Dívidas e cartões de outras pessoas">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="card-title">Dívidas fora do banco</div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            Compras no cartão de outra pessoa, carnês e mensalidades que você paga por boleto ou Pix. Todo mês vira um boleto aqui em Contas a pagar.
          </div>
        </div>
        <button onClick={() => setDialog({ kind: 'source' })} className="btn btn-outline h-11">
          <Icon icon="plus" size={16} />
          Forma de pagamento
        </button>
      </div>

      {q.isPending && <div className="h-24 animate-pulse rounded-xl bg-muted" />}
      {q.isSuccess && !list.length && (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Ex.: “Cartão da Melry” (Itaú Azul Platinum final 5586) com a compra na Casas Bahia em 12 vezes e a mensalidade da faculdade.
        </div>
      )}

      {list.map((s) => (
        <div key={s.id} className="flex flex-col gap-3 rounded-2xl border border-border p-3">
          <div className="flex flex-wrap items-center gap-3">
            {s.method === 'third_party_card' ? (
              <div className="w-[220px] shrink-0">
                <CreditCard
                  card={{ name: s.cardProduct ?? s.name, last4: s.last4, institution: s.bank ?? '', brand: s.brand, bg: cardTheme(s.bank ?? '', s.cardProduct ?? s.name), border: 'transparent', holder: s.holder }}
                />
              </div>
            ) : (
              <span className="grid size-11 place-items-center rounded-full bg-muted">
                <Icon icon={s.method === 'pix' ? 'send' : 'barcode'} size={18} />
              </span>
            )}
            <div className="min-w-[160px] flex-1">
              <div className="text-base font-semibold">{s.name}</div>
              <div className="text-xs text-muted-foreground">
                {METHODS.find((m) => m.id === s.method)!.label} · paga todo dia {s.dueDay}
              </div>
              <div className="mt-2 text-sm">
                Este mês: <strong className="tabular-nums">{money(s.monthTotalMinor)}</strong>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => setDialog({ kind: 'item', sourceId: s.id })} className="btn btn-primary h-10 px-3 text-[13px]">
                  <Icon icon="plus" size={14} />
                  Compra ou mensalidade
                </button>
                <button onClick={() => setDialog({ kind: 'source', source: s })} className="btn btn-outline h-10 px-3 text-[13px]">
                  Editar
                </button>
              </div>
            </div>
          </div>

          {s.items.map((c) => {
            const cat = categoryOf(c.categoryKey);
            const progress = c.kind === 'installments' && c.current?.n ? c.current.n / (c.installments ?? 1) : null;
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 border-t border-border pt-3" style={{ opacity: c.active ? 1 : 0.55 }}>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                  <Icon icon={cat.icon} size={16} />
                </span>
                <div className="min-w-[150px] flex-1">
                  <div className="text-[15px] font-semibold">{c.merchant}</div>
                  <div className="text-xs text-muted-foreground">
                    {cat.label} ·{' '}
                    {!c.active
                      ? 'encerrada'
                      : c.kind === 'monthly'
                        ? `mensalidade${c.lastMonth ? ` até ${monthLabel(c.lastMonth)}` : ''}`
                        : c.current?.n
                          ? `parcela ${c.current.n} de ${c.installments} · faltam ${money(c.remainingMinor ?? 0)}`
                          : `${c.installments}x · começa em ${monthLabel(c.firstMonth)}`}
                  </div>
                  {progress !== null && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={c.current!.n!} aria-valuemin={0} aria-valuemax={c.installments!}>
                      <div className="h-full rounded-full bg-brand" style={{ width: `${progress * 100}%` }} />
                    </div>
                  )}
                  {c.notes && <div className="mt-1 text-xs text-muted-foreground">{c.notes}</div>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[15px] font-semibold tabular-nums">{money(c.current?.amountMinor ?? c.monthlyMinor ?? 0)}</span>
                  {c.active && (
                    <span className="flex gap-1">
                      <button onClick={() => end.mutate(c)} className="h-9 cursor-pointer rounded-full border-0 bg-transparent px-2 text-xs font-semibold text-muted-foreground">
                        Encerrar
                      </button>
                      <button onClick={() => remove.mutate(c)} aria-label={`Apagar ${c.merchant}`} className="icon-btn size-9 border-0">
                        <Icon icon="trash-2" size={14} />
                      </button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {error && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}
      {dialog?.kind === 'source' && <SourceSheet source={dialog.source} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'item' && <ItemSheet sourceId={dialog.sourceId} onClose={() => setDialog(null)} onDone={done} />}
    </section>
  );
}

function Actions({ busy, ok, label }: { busy: boolean; ok: boolean; label: string }) {
  const close = useSheetClose();
  return (
    <div className="flex gap-2.5">
      <button type="button" onClick={close} className="btn btn-outline h-[50px] flex-1">
        Cancelar
      </button>
      <button type="submit" disabled={!ok || busy} className="btn btn-primary h-[50px] flex-1" style={{ opacity: ok && !busy ? 1 : 0.5 }}>
        {busy ? 'Salvando…' : label}
      </button>
    </div>
  );
}

function Err({ text }: { text: string }) {
  return text ? (
    <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
      <Icon icon="circle-alert" size={16} />
      {text}
    </div>
  ) : null;
}

/** Forma de pagamento: cartao de outra pessoa (titular, banco, cartao, bandeira, final), boleto ou Pix. */
function SourceSheet({ source, onClose, onDone }: { source?: DebtSource; onClose: () => void; onDone: (l: DebtSource[]) => void }) {
  const [f, setF] = useState({
    name: source?.name ?? '',
    method: source?.method ?? ('third_party_card' as DebtSource['method']),
    holder: source?.holder ?? '',
    bank: source?.bank ?? '',
    cardProduct: source?.cardProduct ?? '',
    brand: source?.brand ?? '',
    last4: source?.last4 ?? '',
    dueDay: String(source?.dueDay ?? 10),
    notes: source?.notes ?? '',
  });
  const [error, setError] = useState('');
  const card = f.method === 'third_party_card';
  const ok = !!f.name.trim() && +f.dueDay >= 1 && +f.dueDay <= 31 && (!f.last4 || /^\d{4}$/.test(f.last4));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, dueDay: +f.dueDay, ...(card ? {} : { holder: '', bank: '', cardProduct: '', brand: '', last4: '' }) };
      const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '' || source));
      return source ? api.updateDebtSource(source.id, clean) : api.createDebtSource(clean);
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar.'),
  });
  const field = (k: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => (
    <label className="field">
      {label}
      <input value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} className="input" {...extra} />
    </label>
  );
  return (
    <Sheet onClose={onClose} label="Forma de pagamento" width={480} top="6vh" onSubmit={(e) => (e.preventDefault(), ok && save.mutate())}>
      <div className="text-xl font-bold tracking-[-0.02em]">{source ? 'Editar forma de pagamento' : 'Nova forma de pagamento'}</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Como você paga">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={f.method === m.id}
            onClick={() => setF((x) => ({ ...x, method: m.id }))}
            className="h-11 cursor-pointer rounded-full border px-3.5 text-[13px] font-semibold"
            style={{ background: f.method === m.id ? 'var(--brand-soft)' : 'var(--card)', borderColor: f.method === m.id ? 'var(--brand)' : 'var(--border)', color: 'var(--foreground)' }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {field('name', 'Nome', { placeholder: card ? 'Ex.: Cartão da Melry' : 'Ex.: Carnê da loja', maxLength: 60, autoFocus: true })}
      {card && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {field('holder', 'Titular', { placeholder: 'Ex.: Melry', maxLength: 60 })}
            {field('bank', 'Banco', { placeholder: 'Ex.: Itaú', maxLength: 40 })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {field('cardProduct', 'Nome do cartão', { placeholder: 'Ex.: Azul Platinum', maxLength: 40 })}
            <label className="field">
              Bandeira
              <select value={f.brand} onChange={(e) => setF((x) => ({ ...x, brand: e.target.value }))} className="input">
                <option value="">—</option>
                {BRANDS.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
          </div>
          {field('last4', 'Final do cartão (4 dígitos)', { inputMode: 'numeric', maxLength: 4, placeholder: '5586' })}
        </>
      )}
      {field('dueDay', 'Dia em que você paga (vencimento do boleto)', { inputMode: 'numeric', maxLength: 2 })}
      {field('notes', 'Observações', { maxLength: 200, placeholder: 'Ex.: ela manda o boleto pelo WhatsApp' })}
      <Err text={error} />
      <Actions busy={save.isPending} ok={ok} label={source ? 'Salvar' : 'Criar'} />
    </Sheet>
  );
}

/** Compra: onde, data de aprovacao, categoria, valor, parcelas ou mensalidade e observacoes. */
function ItemSheet({ sourceId, onClose, onDone }: { sourceId: string; onClose: () => void; onDone: (l: DebtSource[]) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<'installments' | 'monthly'>('installments');
  const [merchant, setMerchant] = useState('');
  const [approvedAt, setApprovedAt] = useState(today);
  const [categoryKey, setCategoryKey] = useState('compras');
  const [amount, setAmount] = useState({ text: '', value: 0 });
  const [installments, setInstallments] = useState('12');
  const [firstMonth, setFirstMonth] = useState(nextMonth(thisMonth()));
  const [lastMonth, setLastMonth] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const n = Math.max(1, Math.min(120, +installments || 1));
  const minor = Math.round(amount.value * 100);
  const ok = !!merchant.trim() && minor > 0 && !!firstMonth && (kind === 'monthly' || n >= 1);

  const save = useMutation({
    mutationFn: () =>
      api.createCommitment({
        sourceId,
        merchant: merchant.trim(),
        categoryKey,
        approvedAt,
        kind,
        firstMonth,
        ...(kind === 'installments' ? { totalMinor: minor, installments: n } : { monthlyMinor: minor, ...(lastMonth ? { lastMonth } : {}) }),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar.'),
  });

  return (
    <Sheet onClose={onClose} label="Compra ou mensalidade" width={480} top="6vh" onSubmit={(e) => (e.preventDefault(), ok && save.mutate())}>
      <div className="text-xl font-bold tracking-[-0.02em]">Compra ou mensalidade</div>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Tipo">
        {[
          { id: 'installments' as const, label: 'Parcelada' },
          { id: 'monthly' as const, label: 'Mensalidade' },
        ].map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            onClick={() => setKind(k.id)}
            className="h-11 cursor-pointer rounded-full border px-4 text-[13px] font-semibold"
            style={{ background: kind === k.id ? 'var(--brand-soft)' : 'var(--card)', borderColor: kind === k.id ? 'var(--brand)' : 'var(--border)', color: 'var(--foreground)' }}
          >
            {k.label}
          </button>
        ))}
      </div>
      <label className="field">
        Onde
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder={kind === 'monthly' ? 'Ex.: Faculdade' : 'Ex.: Casas Bahia'} maxLength={60} className="input" autoFocus />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="field">
          Data da aprovação
          <input type="date" value={approvedAt} max={today} onChange={(e) => setApprovedAt(e.target.value)} className="input" />
        </label>
        <label className="field">
          Categoria
          <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className="input">
            {SPEND.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind === 'installments' ? (
        <>
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <label className="field">
              Valor total da compra
              <input value={amount.text} onChange={(e) => setAmount(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input" />
            </label>
            <label className="field">
              Parcelas
              <input value={installments} onChange={(e) => setInstallments(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className="input text-center" />
            </label>
          </div>
          {minor > 0 && (
            <div className="-mt-1 text-[13px] text-muted-foreground">
              {n}x de {money(installmentAmount(minor, n, 2 <= n ? 2 : 1))}
              {installmentAmount(minor, n, 1) !== installmentAmount(minor, n, n) ? ` (a 1ª de ${money(installmentAmount(minor, n, 1))})` : ''}
            </div>
          )}
          <label className="field">
            Mês da 1ª parcela
            <input type="month" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)} className="input" />
          </label>
          <div className="-mt-1 text-xs text-muted-foreground">Se já pagou algumas, coloque o mês da primeira: a Pluto conta em qual parcela você está.</div>
        </>
      ) : (
        <>
          <label className="field">
            Valor por mês
            <input value={amount.text} onChange={(e) => setAmount(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="field">
              Desde
              <input type="month" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)} className="input" />
            </label>
            <label className="field">
              Até (opcional)
              <input type="month" value={lastMonth} min={firstMonth} onChange={(e) => setLastMonth(e.target.value)} className="input" />
            </label>
          </div>
        </>
      )}
      <label className="field">
        Observações
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: geladeira" maxLength={200} className="input" />
      </label>
      <Err text={error} />
      <Actions busy={save.isPending} ok={ok} label="Adicionar" />
    </Sheet>
  );
}
