'use client';

import { boletoBarcode, formatBoletoLine, isValidCpf, type Charge, type ChargeDestination, type Goal, type Installment, type InstallmentStatus } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { PlutoMascot } from '@/components/brand/PlutoMascot';
import { useShell } from '@/components/shell/ShellContext';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { ApiRequestError, api } from '@/lib/api';
import { barcodeBars, chargeMessage } from '@/lib/boleto';
import { fmtDateTimeIn } from '@/lib/datetime';
import { addMonths, fmtDay, fmtDayFull, maskDoc, maskMoney, maskPhone } from '@/lib/format';
import { play, useEnter } from '@/lib/motion';
import { money, useGoals, useTz } from '@/lib/queries';
import { useApp } from '@/lib/store';

// Cobranca por boleto (Stripe). Cada parcela vira um boleto registrado; o destino diz para onde o
// dinheiro vai quando for pago: meta (soma sozinho), investimento (fica separado) ou so cobranca.

const QUICK = [1, 2, 3, 6, 10, 12];
const DESTINATIONS: { id: ChargeDestination; label: string }[] = [
  { id: 'GOAL', label: 'Para uma meta' },
  { id: 'INVESTMENT', label: 'Para investir' },
  { id: 'CHARGE', label: 'Só cobrança' },
];
const STATUS: Record<InstallmentStatus, { label: string; bg: string; fg: string; border: string }> = {
  SCHEDULED: { label: 'Agendado', bg: 'transparent', fg: 'var(--muted-foreground)', border: 'var(--border)' },
  OPEN: { label: 'A receber', bg: 'var(--brand-soft)', fg: 'var(--brand-text)', border: 'transparent' },
  PAID: { label: 'Pago', bg: '#C6FF33', fg: '#000', border: 'transparent' },
  EXPIRED: { label: 'Vencido', bg: 'var(--danger-soft)', fg: 'var(--danger-text)', border: 'transparent' },
  CANCELED: { label: 'Cancelada', bg: 'var(--muted)', fg: 'var(--muted-foreground)', border: 'transparent' },
  FAILED: { label: 'Recusado', bg: 'var(--danger-soft)', fg: 'var(--danger-text)', border: 'transparent' },
};
type Step = 'form' | 'loading' | 'done';

const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const digits = (s: string) => s.replace(/\D/g, '');
const maskCep = (s: string) => digits(s).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

/** Resumo da cobranca na lista: pago, x/n pagas, a receber... */
function chargeStatus(c: Charge) {
  const st = c.installments.map((i) => i.status), n = st.length, paid = st.filter((s) => s === 'PAID').length;
  if (paid === n) return STATUS.PAID;
  if (paid > 0) return { ...STATUS.OPEN, label: `${paid}/${n} pagas` };
  if (st.every((s) => s === 'CANCELED')) return STATUS.CANCELED;
  if (st.some((s) => s === 'OPEN')) return STATUS.OPEN;
  if (st.some((s) => s === 'FAILED')) return STATUS.FAILED;
  if (st.some((s) => s === 'EXPIRED')) return STATUS.EXPIRED;
  return STATUS.SCHEDULED;
}

/** Parcela ainda em aberto (sem pagamento nem cancelamento): pode ser encerrada. */
const closable = (i: Installment) => i.status === 'OPEN' || i.status === 'SCHEDULED' || i.status === 'EXPIRED' || i.status === 'FAILED';

const allCanceled = (c: Charge) => c.installments.every((i) => i.status === 'CANCELED');
const canceledCount = (c: Charge) => c.installments.filter((i) => i.status === 'CANCELED').length;

const destinationText = (c: Pick<Charge, 'destination' | 'goalName'>) =>
  c.destination === 'GOAL' ? `Meta ${c.goalName ?? '(removida)'}` : c.destination === 'INVESTMENT' ? 'Para investir' : 'Só cobrança';

export default function BoletoPage() {
  const { mode, nav } = useShell();
  const isMobile = mode === 'mobile';
  const theme = useApp((s) => s.theme);
  const userName = useApp((s) => s.user?.name) ?? '';
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['charges', 'status'], queryFn: api.chargesStatus });
  const charges = useQuery({ queryKey: ['charges'], queryFn: api.charges });
  const goals = useGoals();

  const [destination, setDestination] = useState<ChargeDestination>('CHARGE');
  const [goalId, setGoalId] = useState<string | null>(null);
  const [goalPace, setGoalPace] = useState(true);
  const [valor, setValor] = useState({ text: '', value: 0 });
  const [parcelas, setParcelas] = useState(1);
  const [venc, setVenc] = useState(() => plusDays(todayYmd(), 7));
  const [nome, setNome] = useState('');
  const [doc, setDoc] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [desc, setDesc] = useState('');
  const [cep, setCep] = useState('');
  const [rua, setRua] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [result, setResult] = useState<Charge | null>(null);
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeErr, setCloseErr] = useState('');
  const [sendErr, setSendErr] = useState('');
  const tz = useTz();

  const root = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const prevSel = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEnter(root);

  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (step !== 'done') return;
    play(resultRef.current, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 280 });
    if (window.innerWidth < 760) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step, result?.id]);
  useEffect(() => {
    if (sel !== prevSel.current) play(paperRef.current, [{ opacity: 0.4, transform: `translateX(${sel > prevSel.current ? 12 : -12}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 200 });
    prevSel.current = sel;
  }, [sel]);

  const goal: Goal | undefined = goals.data?.find((g) => g.id === goalId);
  const pace = destination === 'GOAL' && goal && goal.monthlyContributionMinor > 0 && goalPace ? goal.monthlyContributionMinor : 0;
  // Meta com aporte definido: a parcela e o aporte mensal planejado e o total acompanha as parcelas.
  const totalMinor = pace ? pace * parcelas : Math.round(valor.value * 100);
  const n = parcelas, per = Math.floor(totalMinor / n);
  const dates = Array.from({ length: n }, (_, i) => addMonths(venc || todayYmd(), i));
  const vencText = n === 1 ? fmtDayFull(dates[0]!) : n <= 3 ? dates.map(fmtDay).join(', ') : `${fmtDay(dates[0]!)} a ${fmtDayFull(dates[n - 1]!)}`;
  const later = dates.filter((d) => d > plusDays(todayYmd(), 60)).length;
  const taxOk = (() => {
    const d = digits(doc);
    return d.length === 11 ? isValidCpf(d) : d.length === 14;
  })();
  const err = !totalMinor
    ? 'Informe o valor que você quer receber.'
    : per < 500
      ? 'Cada parcela precisa ter pelo menos R$ 5,00.'
      : destination === 'GOAL' && !goal
        ? 'Escolha a meta que vai receber o dinheiro.'
        : !venc || venc < todayYmd()
          ? 'Escolha um vencimento a partir de hoje.'
          : nome.trim().length < 3
            ? 'Informe o nome completo de quem vai pagar.'
            : !taxOk
              ? 'Informe um CPF ou CNPJ válido de quem vai pagar.'
              : !/^\S+@\S+\.\S+$/.test(email)
                ? 'Informe o e-mail de quem vai pagar.'
                : digits(cep).length !== 8 || rua.trim().length < 3 || cidade.trim().length < 2 || !/^[A-Za-z]{2}$/.test(uf)
                  ? 'Preencha o endereço de quem vai pagar (o banco exige).'
                  : '';
  const word = n > 1 ? `${n} boletos` : 'boleto';

  const create = useMutation({
    mutationFn: () =>
      api.createCharge({
        destination,
        goalId: destination === 'GOAL' ? goalId : null,
        description: desc.trim(),
        payer: { name: nome.trim(), taxId: doc, email: email.trim(), phone: phone || null, address: { postalCode: cep, line1: rua.trim(), city: cidade.trim(), state: uf } },
        totalMinor,
        installments: n,
        firstDueDate: venc,
      }),
    onSuccess: (c) => {
      setResult(c);
      setSel(0);
      setStep('done');
      void qc.invalidateQueries({ queryKey: ['charges'] });
    },
    onError: (e) => {
      setServerErr(e instanceof ApiRequestError ? e.message : 'Não foi possível gerar o boleto.');
      setStep('form');
    },
  });
  const refresh = useMutation({
    mutationFn: api.refreshCharges,
    onSuccess: (list) => {
      qc.setQueryData(['charges'], list);
      if (result) setResult(list.find((c) => c.id === result.id) ?? result);
      void qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
  const afterChange = (c: Charge) => {
    setResult(c);
    setConfirmCancel(false);
    setClosing(false);
    setCloseErr('');
    setSendErr('');
    void qc.invalidateQueries({ queryKey: ['charges'] });
    void qc.invalidateQueries({ queryKey: ['goals'] });
  };
  const cancel = useMutation({ mutationFn: (id: string) => api.cancelCharge(id), onSuccess: afterChange });
  // Encerrar so a parcela aberta: cancelar (nao vai ser paga) ou "recebi por fora" (conta como paga).
  const sendMail = useMutation({
    mutationFn: ({ id, n }: { id: string; n: number }) => api.sendCharge(id, n),
    onMutate: () => setSendErr(''),
    onSuccess: (c) => {
      setResult(c);
      void qc.invalidateQueries({ queryKey: ['charges'] });
    },
    onError: (e) => setSendErr(e instanceof ApiRequestError ? e.message : 'Não foi possível enviar o e-mail.'),
  });
  const closeOne = useMutation({
    mutationFn: ({ id, n, outcome }: { id: string; n: number; outcome: 'CANCEL' | 'RECEIVED' }) => api.closeInstallment(id, n, outcome),
    onSuccess: afterChange,
    onError: (e) => {
      setCloseErr(e instanceof ApiRequestError ? e.message : 'Não foi possível encerrar o boleto.');
      // Pode ter sido pago no banco enquanto isso: atualiza a lista.
      void refresh.mutate();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setServerErr('');
    if (err || create.isPending) return;
    setStep('loading');
    create.mutate();
  };

  const inst: Installment | undefined = result?.installments[sel];
  const copy = () => {
    if (!inst?.number) return;
    navigator.clipboard?.writeText(digits(inst.number)).catch(() => {});
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  };
  const reset = () => {
    setStep('form');
    setResult(null);
    setValor({ text: '', value: 0 });
    setParcelas(1);
    setNome('');
    setDoc('');
    setPhone('');
    setEmail('');
    setDesc('');
    setCep('');
    setRua('');
    setCidade('');
    setUf('');
    setTried(false);
    setConfirmCancel(false);
    setClosing(false);
  };
  const open = (c: Charge) => {
    setResult(c);
    setSel(Math.max(0, c.installments.findIndex((i) => i.status === 'OPEN')));
    setConfirmCancel(false);
    setClosing(false);
    setCloseErr('');
    setSendErr('');
    setStep('done');
  };

  // Mensagem da parcela que esta na tela (WhatsApp, compartilhar, mailto).
  const msg = result && inst ? chargeMessage(result, inst) : '';
  const phoneDigits = digits(result?.payerPhone ?? '');
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const cancellable = !!result?.installments.some((i) => i.status === 'OPEN' || i.status === 'SCHEDULED');
  const chip = (on: boolean) => ({
    background: on ? 'var(--primary)' : 'var(--card)',
    color: on ? 'var(--primary-foreground)' : 'var(--foreground)',
    borderColor: on ? 'var(--primary)' : 'var(--border)',
  });

  if (status.data && !status.data.enabled) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="page-title">Gerar boleto</h1>
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <PlutoLogo size={76} />
          <div className="text-[17px] font-semibold">Cobrança por boleto não configurada</div>
          <div className="max-w-[460px] text-sm leading-normal text-pretty text-muted-foreground">
            Coloque a chave do Stripe em <code>STRIPE_SECRET_KEY</code> no <code>apps/api/.env</code> (ou no Render) e reinicie a API. Comece pela chave de teste.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="page-title">Gerar boleto</h1>
          {status.data?.testMode && <span className="badge border-border bg-accent px-2.5 py-1 text-xs text-black">Modo teste · nada é cobrado</span>}
        </div>
        <p className="m-0 text-sm text-pretty text-muted-foreground">
          Diga quanto quer receber, em quantas parcelas e para onde vai o dinheiro. A Pluto gera os boletos e você envia por WhatsApp ou e-mail.
        </p>
      </div>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,5fr) minmax(0,6fr)' : 'minmax(0,1fr)' }}>
        <div className="flex min-w-0 flex-col gap-4">
          {(!isMobile || step === 'form') && (
            <form data-anim="" onSubmit={submit} className="card flex flex-col gap-5" noValidate>
              <div className="flex flex-col gap-2.5">
                <span className="text-sm font-semibold">Para onde vai o dinheiro?</span>
                <Segmented items={DESTINATIONS} value={destination} onChange={setDestination} height={40} className="self-start" itemClassName="px-3.5 text-[13px] font-semibold" />
                {destination === 'GOAL' &&
                  (goals.data?.length ? (
                    <div className="flex flex-col gap-2">
                      {goals.data.map((g) => {
                        const on = g.id === goalId;
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => {
                              setGoalId(g.id);
                              setGoalPace(true);
                            }}
                            aria-pressed={on}
                            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-[14px] border px-3.5 py-2.5 text-left text-foreground"
                            style={{ borderColor: on ? 'var(--primary)' : 'var(--border)', background: on ? 'var(--brand-soft)' : 'var(--card)' }}
                          >
                            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                              <Icon icon="target" size={16} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-semibold">{g.name}</span>
                              <span className="block text-xs text-muted-foreground tabular-nums">
                                {money(g.savedMinor)} de {money(g.targetMinor)}
                                {g.monthlyContributionMinor > 0 ? ` · aporte ${money(g.monthlyContributionMinor)}/mês` : ''}
                              </span>
                            </span>
                            {on && <Icon icon="check" size={18} />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[13px] text-muted-foreground">
                      Você ainda não tem metas.{' '}
                      <button type="button" onClick={() => nav('goals')} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-brand-text">
                        Criar uma meta
                      </button>
                    </div>
                  ))}
                {destination === 'INVESTMENT' && (
                  <div className="text-[13px] text-pretty text-muted-foreground">O valor recebido fica marcado como “para investir”. A Pluto não faz aplicações por você.</div>
                )}
              </div>

              {destination === 'GOAL' && goal && goal.monthlyContributionMinor > 0 && (
                <label className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-border p-3">
                  <input type="checkbox" checked={goalPace} onChange={(e) => setGoalPace(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-brand" />
                  <span className="text-sm leading-snug">
                    Parcela igual ao aporte da meta: <b className="tabular-nums">{money(goal.monthlyContributionMinor)}</b>
                    <span className="mt-0.5 block text-xs text-muted-foreground">O total acompanha o número de parcelas. Desmarque para digitar outro valor.</span>
                  </span>
                </label>
              )}

              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Quanto você quer receber?</span>
                <input
                  value={pace ? money(totalMinor) : valor.text}
                  onChange={(e) => setValor(maskMoney(e.target.value))}
                  readOnly={!!pace}
                  inputMode="numeric"
                  placeholder="R$ 0,00"
                  aria-label="Valor total"
                  className="input h-16 w-full rounded-[14px] px-4 text-[32px] font-bold tracking-[-0.03em] tabular-nums"
                  style={{ opacity: pace ? 0.75 : 1 }}
                />
              </label>

              <div className="flex flex-col gap-2.5">
                <span className="text-sm font-semibold">Em quantas parcelas?</span>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 rounded-full border border-border p-1">
                    <button type="button" onClick={() => setParcelas(Math.max(1, n - 1))} aria-label="Menos parcelas" className="grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-muted text-foreground">
                      <Icon icon="minus" size={18} />
                    </button>
                    <span className="min-w-[52px] text-center text-xl font-bold tabular-nums" aria-live="polite">
                      {n}x
                    </span>
                    <button type="button" onClick={() => setParcelas(Math.min(12, n + 1))} aria-label="Mais parcelas" className="grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-primary text-primary-foreground">
                      <Icon icon="plus" size={18} />
                    </button>
                  </div>
                  <span className="text-[15px] text-muted-foreground tabular-nums">{totalMinor ? `${n}x de ${money(per)}` : 'Até 12x'}</span>
                </div>
                <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
                  {QUICK.map((q) => (
                    <button key={q} type="button" onClick={() => setParcelas(q)} className="btn h-9 shrink-0 px-3.5 text-[13px]" style={chip(q === n)}>
                      {q === 1 ? 'À vista' : q + 'x'}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Vencimento da 1ª parcela</span>
                <input type="date" value={venc} min={todayYmd()} onChange={(e) => setVenc(e.target.value)} className="input w-full" style={{ colorScheme: theme }} />
              </label>

              <div className="flex flex-col gap-3 border-t border-border pt-[18px]">
                <span className="text-sm font-semibold">Quem vai pagar</span>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
                  <label className="field">
                    Nome completo *
                    <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" placeholder="Ex.: Carla Mendes" className="input" />
                  </label>
                  <label className="field">
                    CPF ou CNPJ *
                    <input value={doc} onChange={(e) => setDoc(maskDoc(e.target.value))} inputMode="numeric" placeholder="000.000.000-00" className="input" />
                  </label>
                  <label className="field">
                    WhatsApp
                    <input value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} inputMode="tel" placeholder="(11) 99999-9999" className="input" />
                  </label>
                  <label className="field">
                    E-mail *
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" placeholder="nome@email.com" className="input" />
                  </label>
                  <label className="field">
                    CEP *
                    <input value={cep} onChange={(e) => setCep(maskCep(e.target.value))} inputMode="numeric" placeholder="00000-000" className="input" />
                  </label>
                  <label className="field">
                    Rua e número *
                    <input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Ex.: Av. Brasil, 100" className="input" />
                  </label>
                  <label className="field">
                    Cidade *
                    <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex.: Manaus" className="input" />
                  </label>
                  <label className="field">
                    UF *
                    <input value={uf} onChange={(e) => setUf(e.target.value.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase())} placeholder="AM" className="input uppercase" />
                  </label>
                </div>
                <label className="field">
                  Descrição (aparece no boleto)
                  <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={120} placeholder="Ex.: Aulas de inglês · novembro" className="input" />
                </label>
              </div>

              <div className="flex flex-col gap-2 rounded-[14px] bg-muted px-4 py-3.5 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Você vai receber</span>
                  <strong className="tabular-nums">{money(totalMinor)}</strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Boletos</span>
                  <strong className="tabular-nums">{n === 1 ? `1 de ${money(totalMinor)}` : `${n} de ${money(per)}`}</strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Vencimentos</span>
                  <strong className="text-right">{vencText}</strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Destino</span>
                  <strong className="text-right">{destinationText({ destination, goalName: goal?.name ?? null })}</strong>
                </div>
                <div className="text-xs text-muted-foreground">
                  {later > 0 && `${later} parcela${later > 1 ? 's vencem' : ' vence'} daqui a mais de 60 dias: o boleto sai automaticamente 60 dias antes. `}
                  O Stripe desconta a taxa dele de cada boleto pago.
                </div>
              </div>

              {((tried && err) || serverErr) && (
                <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
                  <Icon icon="circle-alert" size={16} />
                  {err || serverErr}
                </div>
              )}
              <button type="submit" disabled={create.isPending} className="btn btn-primary h-[54px] gap-2.5 text-base" style={{ opacity: err ? 0.55 : 1 }}>
                <Icon icon="barcode" size={18} />
                {create.isPending ? 'Gerando…' : `Gerar ${word}`}
              </button>
            </form>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {!isMobile && step === 'form' && (
            <div data-anim="" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
              <PlutoLogo size={76} />
              <div className="text-[17px] font-semibold">Seu boleto aparece aqui</div>
              <div className="max-w-[320px] text-sm text-pretty text-muted-foreground">Preencha o valor e quem vai pagar. Eu cuido do código de barras.</div>
            </div>
          )}

          {step === 'loading' && (
            <div className="card flex flex-col items-center gap-3.5 px-6 py-12 text-center">
              <div className="h-[180px] w-[220px]">
                <PlutoMascot scene="yarn" talk={false} />
              </div>
              <div className="text-[17px] font-semibold">Gerando {word}…</div>
              <div className="text-sm text-muted-foreground">Registrando no banco. Leva só alguns segundos.</div>
            </div>
          )}

          {step === 'done' && result && inst && (
            <div ref={resultRef} className="card flex flex-col gap-[18px]">
              <div className="flex items-center gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-black">
                  <Icon icon={result.installments.every((i) => i.status === 'PAID') ? 'circle-check' : 'check'} size={22} />
                </span>
                <div className="min-w-0">
                  <div className="text-[19px] font-bold tracking-[-0.02em]">{result.installments.length > 1 ? `${result.installments.length} boletos` : 'Boleto'} · {chargeStatus(result).label}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    Para {result.payerName} · total {money(result.totalMinor)} · {destinationText(result)}
                    {result.paidMinor > 0 && ` · recebido ${money(result.paidMinor)}`}
                  </div>
                </div>
              </div>

              {result.installments.length > 1 && (
                <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
                  {result.installments.map((x, i) => (
                    <button
                      key={x.n}
                      onClick={() => {
                        setSel(i);
                        setCopied(false);
                        setClosing(false);
                        setCloseErr('');
    setSendErr('');
                      }}
                      className="btn h-[38px] shrink-0 px-3.5 text-[13px]"
                      style={chip(i === sel)}
                    >
                      <span style={{ textDecoration: x.status === 'CANCELED' ? 'line-through' : undefined }}>
                        {x.n}/{result.installments.length} · {fmtDay(x.dueDate)}
                      </span>
                      {x.status === 'CANCELED' && ' · Cancelada'}
                    </button>
                  ))}
                </div>
              )}

              <div ref={paperRef} className="flex flex-col gap-3.5 rounded-2xl border border-[#E4E4E7] bg-white p-[18px] text-black">
                <div className="flex items-center justify-between gap-2 border-b-2 border-black pb-2.5">
                  <span className="text-[15px] font-extrabold tracking-[-0.01em]">Boleto · Stripe</span>
                  <span className="rounded-full px-[9px] py-[3px] text-xs font-bold" style={{ background: STATUS[inst.status].bg === 'transparent' ? '#F4F4F5' : '#C6FF33' }}>
                    Parcela {inst.n}/{result.installments.length} · {inst.paidVia === 'MANUAL' ? 'Recebido por fora' : STATUS[inst.status].label}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                  {[
                    ['Beneficiário', userName],
                    ['Pagador', result.payerName],
                    ['Vencimento', fmtDayFull(inst.dueDate)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[11px] tracking-[0.06em] text-[#6B6B73] uppercase">{k}</div>
                      <div className="mt-0.5 font-semibold [overflow-wrap:anywhere]">{v}</div>
                    </div>
                  ))}
                  <div>
                    <div className="text-[11px] tracking-[0.06em] text-[#6B6B73] uppercase">Valor</div>
                    <div className="mt-0.5 text-xl font-extrabold tracking-[-0.03em] tabular-nums" style={{ textDecoration: inst.status === 'CANCELED' ? 'line-through' : undefined }}>
                      {money(inst.amountMinor)}
                    </div>
                  </div>
                </div>
                {inst.number && inst.status !== 'CANCELED' ? (
                  <>
                    <div className="flex items-center gap-2 rounded-xl bg-[#F4F4F5] py-2.5 pr-2.5 pl-3.5">
                      <span className="min-w-0 flex-1 font-mono text-[13px] leading-normal [overflow-wrap:anywhere]">{formatBoletoLine(inst.number)}</span>
                      <button onClick={copy} aria-label="Copiar linha digitável" className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-black text-white">
                        <Icon icon={copied ? 'check' : 'copy'} size={16} />
                      </button>
                    </div>
                    {boletoBarcode(inst.number) && (
                      <div className="flex h-[58px]" aria-hidden="true">
                        {barcodeBars(boletoBarcode(inst.number)!).map((x, i) => (
                          <div key={i} style={{ flex: x.w, background: x.c }} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-xl bg-[#F4F4F5] px-3.5 py-3 text-[13px] leading-normal text-[#3F3F46]">
                    {inst.status === 'SCHEDULED'
                      ? `Este boleto sai em ${fmtDayFull(inst.issueOn!)}: o banco só aceita boletos com até 60 dias até o vencimento. A Pluto emite sozinha.`
                      : inst.status === 'FAILED'
                        ? (inst.error ?? 'O Stripe recusou este boleto.')
                        : inst.status === 'CANCELED'
                          ? 'Boleto encerrado: não pode mais ser pago.'
                          : 'Boleto sem linha digitável.'}
                  </div>
                )}
              </div>

              {/* Enviar so existe para boleto valendo; cancelado nao pode ser enviado. */}
              {inst.status === 'OPEN' && (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2.5">
                    <a
                      href={inst.pdfUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={!inst.pdfUrl}
                      className="btn btn-primary h-[50px]"
                      style={{ opacity: inst.pdfUrl ? 1 : 0.5, pointerEvents: inst.pdfUrl ? 'auto' : 'none' }}
                    >
                      <Icon icon="download" size={17} />
                      Baixar PDF
                    </a>
                    <a href={`https://wa.me/${phoneDigits ? '55' + phoneDigits : ''}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="btn btn-accent h-[50px]">
                      <Icon icon="message-circle" size={17} />
                      WhatsApp
                    </a>
                    {status.data?.emailEnabled ? (
                      <button onClick={() => sendMail.mutate({ id: result.id, n: inst.n })} disabled={sendMail.isPending} className="btn btn-outline h-[50px]">
                        <Icon icon={inst.sentAt ? 'check' : 'mail'} size={17} />
                        {sendMail.isPending ? 'Enviando…' : inst.sentAt ? 'Reenviar e-mail' : 'Enviar e-mail'}
                      </button>
                    ) : (
                      <a href={`mailto:${result.payerEmail}?subject=${encodeURIComponent('Boleto · ' + userName)}&body=${encodeURIComponent(msg)}`} className="btn btn-outline h-[50px]">
                        <Icon icon="mail" size={17} />
                        E-mail
                      </a>
                    )}
                    <button onClick={() => (canShare ? navigator.share({ title: 'Boleto', text: msg }).catch(() => {}) : copy())} className="btn btn-outline h-[50px]">
                      <Icon icon={canShare ? 'share-2' : copied ? 'check' : 'copy'} size={17} />
                      {canShare ? 'Compartilhar' : copied ? 'Copiado' : 'Copiar código'}
                    </button>
                  </div>
                  {sendErr ? (
                    <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
                      <Icon icon="circle-alert" size={16} />
                      {sendErr}
                    </div>
                  ) : (
                    inst.sentAt && (
                      <div role="status" className="flex items-center gap-2 text-[13px] text-brand-text">
                        <Icon icon="circle-check" size={16} />
                        Enviado para {result.payerEmail} em {fmtDateTimeIn(inst.sentAt, tz)}
                      </div>
                    )
                  )}
                </div>
              )}
              {inst.status === 'CANCELED' && (
                <div className="flex items-start gap-2.5 rounded-[14px] bg-danger-soft px-3.5 py-3 text-[13px] leading-normal text-danger-text">
                  <Icon icon="circle-alert" size={16} />
                  <span>
                    <b>Boleto cancelado.</b>{' '}
                    {inst.cancelNotifiedAt
                      ? `Avisamos ${result.payerName.split(' ')[0]} por e-mail (${result.payerEmail}) para não pagar.`
                      : `Avise ${result.payerName.split(' ')[0]} para não pagar.`}
                  </span>
                </div>
              )}

              {closable(inst) &&
                (closing ? (
                  <div className="flex flex-col gap-2.5 rounded-[14px] border border-border p-3.5">
                    <div className="text-[15px] font-semibold">
                      Encerrar o boleto {result.installments.length > 1 ? `da parcela ${inst.n}/${result.installments.length}` : ''} de {money(inst.amountMinor)}
                    </div>
                    <div className="text-[13px] text-muted-foreground">O boleto deixa de valer: se a pessoa tentar pagar, o banco recusa.</div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
                      <button
                        onClick={() => closeOne.mutate({ id: result.id, n: inst.n, outcome: 'RECEIVED' })}
                        disabled={closeOne.isPending}
                        className="btn btn-outline h-auto min-h-[56px] flex-col items-start gap-0.5 py-2.5 text-left whitespace-normal"
                      >
                        <span className="text-[15px]">Já recebi por fora</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          Pix, dinheiro… Conta como pago{result.destination === 'GOAL' ? ' e entra na meta' : ''}.
                        </span>
                      </button>
                      <button
                        onClick={() => closeOne.mutate({ id: result.id, n: inst.n, outcome: 'CANCEL' })}
                        disabled={closeOne.isPending}
                        className="btn btn-outline h-auto min-h-[56px] flex-col items-start gap-0.5 py-2.5 text-left whitespace-normal"
                      >
                        <span className="text-[15px] text-danger-text">Cancelar boleto</span>
                        <span className="text-xs font-normal text-muted-foreground">Não vai ser pago.</span>
                      </button>
                    </div>
                    {closeErr && (
                      <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
                        <Icon icon="circle-alert" size={16} />
                        {closeErr}
                      </div>
                    )}
                    <button onClick={() => setClosing(false)} className="h-10 cursor-pointer self-start border-0 bg-transparent p-0 text-sm font-semibold text-brand-text">
                      Voltar
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setClosing(true)} className="btn btn-outline h-[46px] gap-2">
                    <Icon icon="x" size={16} />
                    Encerrar este boleto
                  </button>
                ))}

              <div className="flex flex-wrap items-center justify-center gap-2">
                <button onClick={reset} className="h-[46px] cursor-pointer rounded-full border-0 bg-transparent px-3 text-sm font-semibold text-brand-text">
                  Gerar novo boleto
                </button>
                {cancellable &&
                  result.installments.length > 1 &&
                  (confirmCancel ? (
                    <button onClick={() => cancel.mutate(result.id)} disabled={cancel.isPending} className="btn btn-outline h-[42px] text-[13px] text-danger-text">
                      {cancel.isPending ? 'Encerrando…' : 'Confirmar: cancelar todas as parcelas em aberto'}
                    </button>
                  ) : (
                    <button onClick={() => setConfirmCancel(true)} className="h-[46px] cursor-pointer rounded-full border-0 bg-transparent px-3 text-sm font-semibold text-muted-foreground">
                      Encerrar cobrança inteira
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div data-anim="" className="card flex flex-col gap-1.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="card-title">Boletos emitidos</div>
              <button onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-label="Atualizar situação dos boletos" className="icon-btn">
                <Icon icon="refresh-cw" size={16} />
              </button>
            </div>
            {charges.isPending && <div className="py-3 text-sm text-muted-foreground">Carregando…</div>}
            {!charges.isPending && !charges.data?.length && <div className="border-t border-border py-4 text-sm text-muted-foreground">Nenhum boleto ainda.</div>}
            {(charges.data ?? []).map((c) => {
              const st = chargeStatus(c), next = c.installments.find((i) => i.status === 'OPEN' || i.status === 'SCHEDULED');
              return (
                <button
                  key={c.id}
                  onClick={() => open(c)}
                  className="flex min-h-16 w-full cursor-pointer items-center gap-3 border-0 border-t border-solid border-border bg-transparent p-0 text-left text-foreground"
                >
                  <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-muted">
                    <Icon icon={c.destination === 'GOAL' ? 'target' : c.destination === 'INVESTMENT' ? 'trending-up' : 'barcode'} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold" style={{ textDecoration: allCanceled(c) ? 'line-through' : undefined }}>
                      {c.payerName}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {c.description || 'Sem descrição'} · {destinationText(c)}
                      {c.installments.length > 1 ? ` · ${c.installments.length}x` : ''}
                      {next ? ` · vence ${fmtDay(next.dueDate)}` : ''}
                      {!allCanceled(c) && canceledCount(c) > 0 ? ` · ${canceledCount(c)} cancelada${canceledCount(c) > 1 ? 's' : ''}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[15px] font-semibold tabular-nums" style={{ textDecoration: allCanceled(c) ? 'line-through' : undefined, opacity: allCanceled(c) ? 0.6 : 1 }}>
                      {money(c.totalMinor)}
                    </span>
                    <span className="badge" style={{ background: st.bg, color: st.fg, borderColor: st.border }}>
                      {st.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
