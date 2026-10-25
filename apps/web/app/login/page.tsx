'use client';

import { formatCpf, isValidCpf, normalizeCpf } from '@pluto/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PlutoMark } from '@/components/brand/PlutoMark';
import { PlutoMascot, type Mood } from '@/components/brand/PlutoMascot';
import { Icon } from '@/components/ui/Icon';
import { ApiRequestError, api } from '@/lib/api';
import { play } from '@/lib/motion';
import { loginWithPasskey, passkeyCancelled, passkeySupported } from '@/lib/passkey';
import { completeLogin, consumeLoginMsg, useApp, type LoginMsg } from '@/lib/store';
import { useHydrated, useMode } from '@/lib/viewport';

// Secao 6.2: CPF + senha + codigo do autenticador (TOTP) ou codigo de recuperacao; ou passkey (biometria).
export default function LoginPage() {
  const router = useRouter();
  const isMobile = useMode() === 'mobile';
  const hydrated = useApp((s) => s.hydrated);
  const session = useApp((s) => s.session);

  const [step, setStep] = useState<'password' | 'code'>('password');
  const [cpf, setCpf] = useState('');
  // Depois da hidratacao: no servidor nao ha WebAuthn.
  const canPasskey = useHydrated() && passkeySupported();
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwFocus, setPwFocus] = useState(false);
  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState<LoginMsg | null>(null);
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<Mood>('');
  const [jumpKey, setJumpKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!hydrated) return;
    if (session) router.replace('/');
    const m = consumeLoginMsg();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (m) setMsg(m);
  }, [hydrated, session, router]);

  useEffect(() => {
    const el = formRef.current;
    Array.from(el?.children ?? []).forEach((c, i) => play(c, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 300, delay: i * 50 }));
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const fail = (text: string) => {
    setMsg({ kind: 'error', text });
    setMood('no');
    timers.current.push(setTimeout(() => setMood(''), 1600));
  };
  const errorText = (e: unknown) => (e instanceof ApiRequestError ? e.message : 'Não foi possível falar com o servidor. A API está rodando?');

  const enterApp = async () => {
    setMood('happy');
    setJumpKey((k) => k + 1);
    await completeLogin();
    router.replace('/');
  };

  const submitPasskey = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await loginWithPasskey(remember);
      await enterApp();
    } catch (e) {
      if (!passkeyCancelled(e)) fail(errorText(e));
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    if (!isValidCpf(cpf)) return fail('Informe um CPF válido.');
    if (!pw) return fail('Informe sua senha.');
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.login(normalizeCpf(cpf), pw);
      setMfaToken(r.mfaToken);
      setPw('');
      setStep('code');
      setMood('think');
    } catch (e) {
      fail(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (code.replace(/\s/g, '').length < 6) return fail('Digite o código de 6 dígitos do seu app autenticador.');
    setBusy(true);
    setMsg(null);
    try {
      await api.verifyMfa(mfaToken, code, remember);
      await enterApp();
    } catch (e) {
      setCode('');
      if (e instanceof ApiRequestError && e.code === 'MFA_EXPIRED') {
        setStep('password');
        setMood('');
      }
      fail(errorText(e));
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    void (step === 'password' ? submitPassword() : submitCode());
  };

  const err = msg?.kind === 'error';
  const title = step === 'code' ? 'Confirme que é você' : msg?.kind === 'info' ? 'Volte logo!' : 'Que bom te ver';

  return (
    <div className="grid min-h-screen" style={{ gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1fr)' }}>
      <div
        className="flex flex-col gap-3 overflow-hidden bg-brand text-white"
        style={{ padding: isMobile ? '16px 16px 8px' : '32px 40px 40px', borderRadius: isMobile ? '0 0 28px 28px' : 0 }}
      >
        <div className="flex items-center gap-2">
          <span className="grid size-10 place-items-center rounded-xl bg-white">
            <PlutoMark size={28} />
          </span>
          <span className="text-[22px] font-extrabold tracking-[-0.04em]">pluto</span>
        </div>
        <div className="mx-auto w-full max-w-[480px] flex-1" style={{ minHeight: isMobile ? 230 : 360 }}>
          <PlutoMascot scene="wave" cover={step === 'password' && pwFocus && !showPw && !busy} mood={mood} jumpKey={jumpKey} />
        </div>
        {!isMobile && (
          <div className="flex max-w-[440px] flex-col gap-2">
            <div className="text-[34px] leading-[1.1] font-bold tracking-[-0.04em] text-balance">Seu dinheiro organizado por uma gata muito curiosa.</div>
            <div className="text-[15px] text-pretty opacity-90">Contas, cartões e investimentos num lugar só. Toque na Pluto para dar um oi.</div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center" style={{ padding: isMobile ? '24px 20px 40px' : 40 }}>
        <form ref={formRef} key={step} onSubmit={submit} className="flex w-full max-w-[400px] flex-col gap-4" noValidate>
          <div>
            <h1 className="m-0 text-[clamp(26px,6vw,32px)] font-bold tracking-[-0.035em]">{title}</h1>
            <p className="mt-1.5 mb-0 text-[15px] text-muted-foreground">
              {step === 'code' ? 'Digite o código do seu app autenticador.' : 'Entre com seu CPF e senha.'}
            </p>
          </div>

          {step === 'password' ? (
            <>
              <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                CPF
                <input
                  value={cpf}
                  onChange={(e) => setCpf(formatCpf(e.target.value))}
                  autoComplete="username"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  className="input h-[52px] rounded-[14px] px-4 tabular-nums"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                Senha
                <span className="flex h-[52px] items-center rounded-[14px] border border-border bg-background pr-1.5 pl-4 focus-within:border-brand">
                  <input
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    onFocus={() => setPwFocus(true)}
                    onBlur={() => setPwFocus(false)}
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Sua senha"
                    className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-foreground outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    aria-label={showPw ? 'Esconder senha' : 'Mostrar senha'}
                    className="grid size-[42px] cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted-foreground"
                  >
                    <Icon icon={showPw ? 'eye-off' : 'eye'} size={18} />
                  </button>
                </span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={remember} onChange={() => setRemember(!remember)} className="m-0 size-[18px] accent-brand" />
                Lembrar de mim neste dispositivo
              </label>
            </>
          ) : (
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Código
              <input
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value.slice(0, 12))}
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="000000"
                className="input h-14 rounded-[14px] px-4 text-center text-2xl font-bold tracking-[0.3em]"
              />
              <span className="font-normal text-muted-foreground">Sem o celular? Use um dos códigos de recuperação (xxxx-xxxx).</span>
            </label>
          )}

          {msg && (
            <div
              role={err ? 'alert' : 'status'}
              className="flex items-start gap-2 rounded-xl px-3.5 py-3 text-[13px] leading-[1.45]"
              style={{ background: err ? 'var(--danger-soft)' : 'var(--brand-soft)', color: err ? 'var(--danger-text)' : 'var(--brand-text)' }}
            >
              <Icon icon={err ? 'circle-alert' : 'circle-check'} size={16} />
              {msg.text}
            </div>
          )}

          <button type="submit" className="btn btn-primary h-[54px] text-base" style={{ opacity: busy ? 0.7 : 1 }} disabled={busy}>
            {busy ? (step === 'code' ? 'Confirmando…' : 'Entrando…') : step === 'code' ? 'Confirmar' : 'Entrar'}
          </button>

          {step === 'code' && (
            <button
              type="button"
              onClick={() => {
                setStep('password');
                setCode('');
                setMsg(null);
                setMood('');
              }}
              className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-brand-text"
            >
              Voltar
            </button>
          )}

          {/* Passkey: digital, Face ID ou Windows Hello. Cadastre em Configuracoes depois de entrar. */}
          {canPasskey && step === 'password' && (
            <>
              <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                ou
                <span className="h-px flex-1 bg-border" />
              </div>
              <button type="button" onClick={submitPasskey} disabled={busy} className="btn btn-outline h-[52px] gap-2.5 text-[15px]">
                <Icon icon="fingerprint" size={20} />
                Entrar com biometria
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
