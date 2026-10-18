'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { fmtDateTimeIn } from '@/lib/datetime';
import { passkeyCancelled, passkeySupported, registerPasskey } from '@/lib/passkey';
import { useTz } from '@/lib/queries';
import { useHydrated } from '@/lib/viewport';
import { useReauth } from './Reauth';
import { Icon } from './ui/Icon';

/** Biometria (passkeys): cadastrar este aparelho, ver e remover os cadastrados. */
export function PasskeysCard() {
  const qc = useQueryClient();
  const tz = useTz();
  const supported = useHydrated() && passkeySupported();
  const { run, sheet } = useReauth();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const list = useQuery({ queryKey: ['passkeys'], queryFn: api.passkeys });

  const onError = (e: unknown) => {
    if (passkeyCancelled(e) || (e instanceof ApiRequestError && e.code === 'REAUTH_CANCELLED')) return;
    setMsg({ kind: 'error', text: e instanceof ApiRequestError ? e.message : 'Não foi possível concluir. Tente de novo.' });
  };
  // Cadastrar ou remover muda como se entra na conta: pede senha + codigo se o login for antigo.
  const add = useMutation({
    mutationFn: () => run(() => registerPasskey()),
    onSuccess: () => {
      setMsg({ kind: 'ok', text: 'Biometria cadastrada. Na próxima vez, toque em "Entrar com biometria".' });
      return qc.invalidateQueries({ queryKey: ['passkeys'] });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => run(() => api.removePasskey(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['passkeys'] }),
    onError,
  });
  const items = list.data ?? [];

  return (
    <div data-anim="" className="card flex flex-col">
      <div className="card-title">Biometria</div>
      <div className="mt-1 mb-2 text-[13px] text-muted-foreground">
        Entre com a digital, o Face ID ou o Windows Hello, sem digitar senha nem código. A chave fica só no seu aparelho.
      </div>

      {items.map((p) => (
        <div key={p.id} className="flex min-h-14 items-center gap-3 border-t border-border py-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
            <Icon icon="fingerprint" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{p.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {p.lastUsedAt ? `Usada em ${fmtDateTimeIn(p.lastUsedAt, tz)}` : `Cadastrada em ${fmtDateTimeIn(p.createdAt, tz)}`}
            </div>
          </div>
          <button onClick={() => remove.mutate(p.id)} disabled={remove.isPending} aria-label={`Remover ${p.name}`} className="icon-btn">
            <Icon icon="x" size={16} />
          </button>
        </div>
      ))}
      {!list.isPending && items.length === 0 && <div className="border-t border-border py-3 text-sm text-muted-foreground">Nenhum aparelho cadastrado.</div>}

      {msg && (
        <div role={msg.kind === 'error' ? 'alert' : 'status'} className="mt-1 flex items-center gap-2 text-[13px]" style={{ color: msg.kind === 'error' ? 'var(--danger-text)' : 'var(--brand-text)' }}>
          <Icon icon={msg.kind === 'error' ? 'circle-alert' : 'circle-check'} size={16} />
          {msg.text}
        </div>
      )}

      {supported ? (
        <button
          onClick={() => {
            setMsg(null);
            add.mutate();
          }}
          disabled={add.isPending}
          className="btn btn-outline mt-2 gap-2 self-start"
        >
          <Icon icon="fingerprint" size={17} />
          {add.isPending ? 'Aguardando a biometria…' : 'Cadastrar biometria deste aparelho'}
        </button>
      ) : (
        <div className="mt-2 text-[13px] text-muted-foreground">Este navegador não oferece biometria.</div>
      )}
      {sheet}
    </div>
  );
}
