'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PlutoLogo } from '@/components/brand/PlutoLogo';
import { PlutoMascot, type Mood } from '@/components/brand/PlutoMascot';
import { Icon } from '@/components/ui/Icon';
import { animate, reducedMotion, stagger } from '@/lib/motion';
import { consumeLoginMsg, login, useApp, type LoginMsg } from '@/lib/store';
import { useMode } from '@/lib/viewport';

// MOCK: aceita qualquer credencial. A autenticacao real (senha + TOTP, secao 6.2) entra com o modulo auth da API.
export default function LoginPage() {
  const router = useRouter();
  const isMobile = useMode() === 'mobile';
  const hydrated = useApp((s) => s.hydrated);
  const session = useApp((s) => s.session);

  const [loginId, setLoginId] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwFocus, setPwFocus] = useState(false);
  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState<LoginMsg | null>(null);
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<Mood>('');
  const [jumpKey, setJumpKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
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
    if (el && !reducedMotion()) animate(Array.from(el.children), { opacity: [0, 1], y: [14, 0] }, { delay: stagger(0.05), duration: 0.45 });
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  const fail = (text: string) => {
    setMsg({ kind: 'error', text });
    setMood('no');
    later(() => setMood(''), 1600);
  };

  const doLogin = () => {
    setBusy(true);
    setMsg(null);
    setMood('happy');
    setJumpKey((k) => k + 1);
    later(() => {
      login(remember);
      router.replace('/');
    }, 900);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!loginId.trim()) return fail('Informe seu CPF ou e-mail.');
    if (pw.length < 4) return fail('A senha precisa ter pelo menos 4 caracteres.');
    doLogin();
  };

  const err = msg?.kind === 'error';

  return (
    <div className="grid min-h-screen" style={{ gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1fr)' }}>
      <div
        className="flex flex-col gap-3 overflow-hidden bg-brand text-white"
        style={{ padding: isMobile ? '16px 16px 8px' : '32px 40px 40px', borderRadius: isMobile ? '0 0 28px 28px' : 0 }}
      >
        <div className="flex items-center gap-2">
          <span className="grid size-10 place-items-center rounded-xl bg-white">
            <PlutoLogo size={32} />
          </span>
          <span className="text-[22px] font-extrabold tracking-[-0.04em]">pluto</span>
        </div>
        <div className="mx-auto w-full max-w-[480px] flex-1" style={{ minHeight: isMobile ? 230 : 360 }}>
          <PlutoMascot scene="wave" cover={pwFocus && !showPw && !busy} mood={mood} jumpKey={jumpKey} />
        </div>
        {!isMobile && (
          <div className="flex max-w-[440px] flex-col gap-2">
            <div className="text-[34px] leading-[1.1] font-bold tracking-[-0.04em] text-balance">Seu dinheiro organizado por uma gata muito curiosa.</div>
            <div className="text-[15px] text-pretty opacity-90">
              Contas, cartões, boletos e investimentos num lugar só. Toque na Pluto para dar um oi.
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center" style={{ padding: isMobile ? '24px 20px 40px' : 40 }}>
        <form ref={formRef} onSubmit={submit} className="flex w-full max-w-[400px] flex-col gap-4" noValidate>
          <div>
            <h1 className="m-0 text-[clamp(26px,6vw,32px)] font-bold tracking-[-0.035em]">{msg?.kind === 'info' ? 'Volte logo!' : 'Que bom te ver'}</h1>
            <p className="mt-1.5 mb-0 text-[15px] text-muted-foreground">Entre com seu CPF ou e-mail.</p>
          </div>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            CPF ou e-mail
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
              inputMode="email"
              placeholder="000.000.000-00 ou nome@email.com"
              className="input h-[52px] rounded-[14px] px-4"
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
          <div className="flex items-center justify-between gap-2 text-sm">
            <label className="flex min-h-11 cursor-pointer items-center gap-2">
              <input type="checkbox" checked={remember} onChange={() => setRemember(!remember)} className="m-0 size-[18px] accent-brand" />
              Lembrar de mim
            </label>
            <button
              type="button"
              onClick={() =>
                setMsg({
                  kind: 'info',
                  text: loginId.trim()
                    ? `Enviamos um link para redefinir a senha de ${loginId.trim()}.`
                    : 'Digite seu CPF ou e-mail acima e toque em “Esqueci a senha” de novo.',
                })
              }
              className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-brand-text"
            >
              Esqueci a senha
            </button>
          </div>
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
          <button type="submit" className="btn btn-primary h-[54px] text-base" style={{ opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
          <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            ou
            <span className="h-px flex-1 bg-border" />
          </div>
          <button type="button" onClick={() => !busy && doLogin()} className="btn btn-outline h-[52px] gap-2.5 text-[15px]">
            <Icon icon="smartphone" size={18} />
            Entrar com biometria
          </button>
          <div className="text-center text-sm text-muted-foreground">
            Não tem conta?{' '}
            <button
              type="button"
              onClick={() =>
                setMsg({ kind: 'info', text: 'O cadastro abre no próximo passo. Por enquanto, entre com qualquer e-mail e senha para testar.' })
              }
              className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-brand-text"
            >
              Criar conta grátis
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
