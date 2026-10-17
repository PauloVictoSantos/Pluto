'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { PlutoMascot } from '@/components/brand/PlutoMascot';
import { useShell } from '@/components/shell/ShellContext';
import { Icon } from '@/components/ui/Icon';
import { addMonths, fmt, fmtDay, fmtDayFull, maskDoc, maskMoney, maskPhone } from '@/lib/format';
import { barcodeBars, boletoMessage, downloadBoleto, emitBoleto, type Boleto } from '@/lib/mock/boleto';
import { MOCK, TODAY } from '@/lib/mock/data';
import { COB_STATUS } from '@/lib/mock/vm';
import { animate, reducedMotion, useEnter } from '@/lib/motion';
import { useApp } from '@/lib/store';

const QUICK = [1, 2, 3, 6, 10, 12];
type Step = 'form' | 'loading' | 'done';

export default function BoletoPage() {
  const { mode } = useShell();
  const isMobile = mode === 'mobile';
  const theme = useApp((s) => s.theme);
  const userName = useApp((s) => s.user.name);

  const [valor, setValor] = useState({ text: '', value: 0 });
  const [parcelas, setParcelas] = useState(1);
  const [venc, setVenc] = useState('2026-10-30');
  const [nome, setNome] = useState('');
  const [doc, setDoc] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [desc, setDesc] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [result, setResult] = useState<Boleto[]>([]);
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState(false);
  const [tried, setTried] = useState(false);
  const [issued, setIssued] = useState<Boleto[]>([]);

  const root = useRef<HTMLDivElement>(null);
  const bobRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const prevSel = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEnter(root);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useEffect(() => {
    if (reducedMotion()) return;
    if (step === 'loading' && bobRef.current) {
      const a = animate(bobRef.current, { y: [0, -8, 0] }, { duration: 1.2, repeat: Infinity, ease: 'easeInOut' });
      return () => a.stop();
    }
    if (step === 'done' && resultRef.current) {
      animate(resultRef.current, { opacity: [0, 1], y: [20, 0] }, { type: 'spring', stiffness: 300, damping: 28 });
      const ck = resultRef.current.querySelector('[data-pop]');
      if (ck) animate(ck, { scale: [0, 1.15, 1] }, { duration: 0.5, delay: 0.15 });
      if (window.innerWidth < 760) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [step]);

  useEffect(() => {
    if (sel !== prevSel.current && paperRef.current && !reducedMotion())
      animate(paperRef.current, { opacity: [0.3, 1], x: [sel > prevSel.current ? 16 : -16, 0] }, { duration: 0.3 });
    prevSel.current = sel;
  }, [sel]);

  const n = parcelas, per = valor.value / n;
  const dates = Array.from({ length: n }, (_, i) => addMonths(venc || TODAY, i));
  const vencText = n === 1 ? fmtDayFull(dates[0]!) : n <= 3 ? dates.map(fmtDay).join(', ') : `${fmtDay(dates[0]!)} a ${fmtDayFull(dates[n - 1]!)}`;
  const err = !valor.value
    ? 'Informe o valor que você quer receber.'
    : per < 5
      ? 'Cada parcela precisa ter pelo menos R$ 5,00.'
      : !nome.trim()
        ? 'Informe o nome de quem vai pagar.'
        : !venc
          ? 'Escolha a data de vencimento.'
          : '';
  const word = n > 1 ? `${n} boletos` : 'boleto';
  const b = result[sel], c = b?.cobranca;
  const msg = result.length ? boletoMessage(result) : '', digits = phone.replace(/\D/g, '');
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (err) return;
    setStep('loading');
    const r = await emitBoleto({
      valorTotal: valor.value,
      parcelas: n,
      primeiroVencimento: venc,
      descricao: desc.trim(),
      pagador: { nome: nome.trim(), cpfCnpj: doc, email, telefone: phone },
    });
    setResult(r);
    setSel(0);
    setIssued((p) => [...r, ...p]);
    setStep('done');
  };

  const copy = () => {
    if (!b) return;
    navigator.clipboard?.writeText(b.boleto.linhaDigitavel.replace(/\D/g, '')).catch(() => {});
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  };
  const reset = () => {
    setStep('form');
    setResult([]);
    setValor({ text: '', value: 0 });
    setParcelas(1);
    setNome('');
    setDoc('');
    setPhone('');
    setEmail('');
    setDesc('');
    setTried(false);
  };

  const history = [...issued, ...MOCK.cobranca].map((x, i) => {
    const cc = x.cobranca, st = COB_STATUS[cc.situacao]!;
    return {
      key: cc.codigoSolicitacao + i,
      nome: cc.pagador.nome,
      sub: `${cc.mensagem || 'Sem descrição'}${cc.parcela ? ' · ' + cc.parcela : ''} · vence ${fmtDay(cc.dataVencimento)}`,
      valor: fmt(cc.valorNominal),
      st,
    };
  });
  const chip = (on: boolean) => ({
    background: on ? 'var(--primary)' : 'var(--card)',
    color: on ? 'var(--primary-foreground)' : 'var(--foreground)',
    borderColor: on ? 'var(--primary)' : 'var(--border)',
  });

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div data-anim="" className="flex flex-col gap-1">
        <h1 className="page-title">Gerar boleto</h1>
        <p className="m-0 text-sm text-pretty text-muted-foreground">
          Diga quanto quer receber e em quantas parcelas. A Pluto gera os boletos e você envia por WhatsApp ou e-mail.
        </p>
      </div>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: mode === 'desktop' ? 'minmax(0,5fr) minmax(0,6fr)' : 'minmax(0,1fr)' }}>
        <div className="flex min-w-0 flex-col gap-4">
          {(!isMobile || step === 'form') && (
            <form data-anim="" onSubmit={submit} className="card flex flex-col gap-5" noValidate>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Quanto você quer receber?</span>
                <input
                  value={valor.text}
                  onChange={(e) => setValor(maskMoney(e.target.value))}
                  inputMode="numeric"
                  placeholder="R$ 0,00"
                  aria-label="Valor total"
                  className="input h-16 w-full rounded-[14px] px-4 text-[32px] font-bold tracking-[-0.03em] tabular-nums"
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
                  <span className="text-[15px] text-muted-foreground">{valor.value ? `${n}x de ${fmt(per)}` : 'Até 12x'}</span>
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
                <input type="date" value={venc} min="2026-10-17" onChange={(e) => setVenc(e.target.value)} className="input w-full" style={{ colorScheme: theme }} />
              </label>

              <div className="flex flex-col gap-3 border-t border-border pt-[18px]">
                <span className="text-sm font-semibold">Quem vai pagar</span>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
                  <label className="field">
                    Nome completo *
                    <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" placeholder="Ex.: Carla Mendes" className="input" />
                  </label>
                  <label className="field">
                    CPF ou CNPJ
                    <input value={doc} onChange={(e) => setDoc(maskDoc(e.target.value))} inputMode="numeric" placeholder="000.000.000-00" className="input" />
                  </label>
                  <label className="field">
                    WhatsApp
                    <input value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} inputMode="tel" placeholder="(11) 99999-9999" className="input" />
                  </label>
                  <label className="field">
                    E-mail
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" placeholder="nome@email.com" className="input" />
                  </label>
                </div>
                <label className="field">
                  Descrição (aparece no boleto)
                  <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: Aulas de inglês · novembro" className="input" />
                </label>
              </div>

              <div className="flex flex-col gap-2 rounded-[14px] bg-muted px-4 py-3.5 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Você vai receber</span>
                  <strong className="tabular-nums">{fmt(valor.value)}</strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Boletos</span>
                  <strong className="tabular-nums">{n === 1 ? `1 de ${fmt(valor.value)}` : `${n} de ${fmt(per)}`}</strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Vencimentos</span>
                  <strong className="text-right">{vencText}</strong>
                </div>
              </div>

              {tried && err && (
                <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
                  <Icon icon="circle-alert" size={16} />
                  {err}
                </div>
              )}
              <button type="submit" className="btn btn-primary h-[54px] gap-2.5 text-base" style={{ opacity: err ? 0.55 : 1 }}>
                <Icon icon="barcode" size={18} />
                {step === 'loading' ? 'Gerando…' : `Gerar ${word}`}
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
              <div ref={bobRef} className="h-[180px] w-[220px]">
                <PlutoMascot scene="yarn" talk={false} />
              </div>
              <div className="text-[17px] font-semibold">Gerando {word}…</div>
              <div className="text-sm text-muted-foreground">Registrando no banco. Leva só alguns segundos.</div>
            </div>
          )}

          {step === 'done' && b && c && (
            <div ref={resultRef} className="card flex flex-col gap-[18px]">
              <div className="flex items-center gap-3">
                <span data-pop="" className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-black">
                  <Icon icon="check" size={22} />
                </span>
                <div className="min-w-0">
                  <div className="text-[19px] font-bold tracking-[-0.02em]">{result.length > 1 ? `${result.length} boletos gerados` : 'Boleto gerado'}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    Para {c.pagador.nome} · total {fmt(result.reduce((t, x) => t + x.cobranca.valorNominal, 0))}
                  </div>
                </div>
              </div>

              {result.length > 1 && (
                <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
                  {result.map((x, i) => (
                    <button
                      key={x.cobranca.seuNumero}
                      onClick={() => {
                        setSel(i);
                        setCopied(false);
                      }}
                      className="btn h-[38px] shrink-0 px-3.5 text-[13px]"
                      style={chip(i === sel)}
                    >
                      {x.cobranca.parcela} · {fmtDay(x.cobranca.dataVencimento)}
                    </button>
                  ))}
                </div>
              )}

              <div ref={paperRef} className="flex flex-col gap-3.5 rounded-2xl border border-[#E4E4E7] bg-white p-[18px] text-black">
                <div className="flex items-center justify-between gap-2 border-b-2 border-black pb-2.5">
                  <span className="text-[15px] font-extrabold tracking-[-0.01em]">Pluto Pagamentos | 077-9</span>
                  <span className="rounded-full bg-accent px-[9px] py-[3px] text-xs font-bold">Parcela {c.parcela}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                  {[
                    ['Beneficiário', userName],
                    ['Pagador', c.pagador.nome],
                    ['Vencimento', fmtDayFull(c.dataVencimento)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[11px] tracking-[0.06em] text-[#6B6B73] uppercase">{k}</div>
                      <div className="mt-0.5 font-semibold [overflow-wrap:anywhere]">{v}</div>
                    </div>
                  ))}
                  <div>
                    <div className="text-[11px] tracking-[0.06em] text-[#6B6B73] uppercase">Valor</div>
                    <div className="mt-0.5 text-xl font-extrabold tracking-[-0.03em] tabular-nums">{fmt(c.valorNominal)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-[#F4F4F5] py-2.5 pr-2.5 pl-3.5">
                  <span className="min-w-0 flex-1 font-mono text-[13px] leading-normal [overflow-wrap:anywhere]">{b.boleto.linhaDigitavel}</span>
                  <button onClick={copy} aria-label="Copiar linha digitável" className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-black text-white">
                    <Icon icon={copied ? 'check' : 'copy'} size={16} />
                  </button>
                </div>
                <div className="flex h-[58px]" aria-hidden="true">
                  {barcodeBars(b.boleto.codigoBarras).map((x, i) => (
                    <div key={i} style={{ flex: x.w, background: x.c }} />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button onClick={() => downloadBoleto(result)} className="btn btn-primary h-[50px]">
                  <Icon icon="download" size={17} />
                  Baixar PDF
                </button>
                <a href={`https://wa.me/${digits ? '55' + digits : ''}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="btn btn-accent h-[50px]">
                  <Icon icon="message-circle" size={17} />
                  WhatsApp
                </a>
                <a href={`mailto:${email}?subject=${encodeURIComponent('Boleto · ' + userName)}&body=${encodeURIComponent(msg)}`} className="btn btn-outline h-[50px]">
                  <Icon icon="mail" size={17} />
                  E-mail
                </a>
                <button onClick={() => (canShare ? navigator.share({ title: 'Boleto', text: msg }).catch(() => {}) : copy())} className="btn btn-outline h-[50px]">
                  <Icon icon={canShare ? 'share-2' : copied ? 'check' : 'copy'} size={17} />
                  {canShare ? 'Compartilhar' : copied ? 'Copiado' : 'Copiar código'}
                </button>
              </div>
              <button onClick={reset} className="h-[46px] cursor-pointer rounded-full border-0 bg-transparent text-sm font-semibold text-brand-text">
                Gerar novo boleto
              </button>
            </div>
          )}

          <div data-anim="" className="card flex flex-col gap-1.5">
            <div className="card-title mb-1.5">Boletos emitidos</div>
            {history.map((h) => (
              <div key={h.key} className="flex min-h-16 items-center gap-3 border-t border-border">
                <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-muted">
                  <Icon icon="barcode" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{h.nome}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{h.sub}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[15px] font-semibold tabular-nums">{h.valor}</span>
                  <span className="badge" style={{ background: h.st.bg, color: h.st.fg, borderColor: h.st.border }}>
                    {h.st.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
