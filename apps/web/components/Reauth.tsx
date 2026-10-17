'use client';

import { useCallback, useRef, useState, type FormEvent } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { Icon } from './ui/Icon';
import { Sheet } from './ui/Sheet';

/**
 * Acoes sensiveis (secao 6.2) respondem REAUTH_REQUIRED se o login tem mais de 10 minutos.
 * `run` pede senha + codigo, renova a autenticacao e repete a acao uma vez.
 */
export function useReauth() {
  const [open, setOpen] = useState(false);
  const waiter = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiRequestError && e.code === 'REAUTH_REQUIRED')) throw e;
      await new Promise<void>((resolve, reject) => {
        waiter.current = { resolve, reject };
        setOpen(true);
      });
      return fn();
    }
  }, []);

  const close = (ok: boolean) => {
    setOpen(false);
    if (ok) waiter.current?.resolve();
    else waiter.current?.reject(new ApiRequestError(401, 'REAUTH_CANCELLED', 'Confirmação cancelada'));
    waiter.current = null;
  };

  const sheet = open ? <ReauthSheet onDone={() => close(true)} onCancel={() => close(false)} /> : null;
  return { run, sheet };
}

function ReauthSheet({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || code.length < 6) return setError('Informe a senha e o código do autenticador.');
    setBusy(true);
    setError('');
    try {
      await api.reauth(password, code);
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Não foi possível confirmar.');
      setCode('');
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onCancel} onSubmit={submit} label="Confirmar identidade" width={420} top="18vh" gap={14}>
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text">
          <Icon icon="lock" size={20} />
        </span>
        <div>
          <div className="text-xl font-bold tracking-[-0.02em]">Confirme que é você</div>
          <div className="mt-0.5 text-sm text-muted-foreground">Esta ação mexe com dados sensíveis.</div>
        </div>
      </div>
      <label className="field">
        Senha
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" autoFocus />
      </label>
      <label className="field">
        Código do autenticador
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.slice(0, 12))}
          autoComplete="one-time-code"
          inputMode="numeric"
          placeholder="000000"
          className="input text-center text-xl font-bold tracking-[0.3em]"
        />
      </label>
      {error && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          {error}
        </div>
      )}
      <div className="flex gap-2.5">
        <button type="button" onClick={onCancel} className="btn btn-outline h-[50px] flex-1 text-[15px]">
          Cancelar
        </button>
        <button type="submit" disabled={busy} className="btn btn-primary h-[50px] flex-1 text-[15px]" style={{ opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Confirmando…' : 'Confirmar'}
        </button>
      </div>
    </Sheet>
  );
}
