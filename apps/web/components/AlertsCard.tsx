'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { disablePush, enablePush, pushEndpoint, pushSupported } from '@/lib/push';
import { Icon } from './ui/Icon';

/** Configuracoes > Avisos: canais (push e e-mail), este aparelho e um teste. O sino sempre recebe. */
export function AlertsCard() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['alerts', 'settings'], queryFn: api.alertSettings });
  const [here, setHere] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const supported = pushSupported();

  useEffect(() => {
    void pushEndpoint().then((e) => setHere(!!e));
  }, []);

  const fail = (e: unknown) =>
    setMsg({
      ok: false,
      text:
        e instanceof Error && e.message === 'PERMISSION_DENIED'
          ? 'O navegador bloqueou as notificações. Libere nas configurações do site e tente de novo.'
          : e instanceof ApiRequestError
            ? e.message
            : 'Não conseguimos ativar agora. Tente de novo.',
    });
  const set = (data: Awaited<ReturnType<typeof api.alertSettings>>) => qc.setQueryData(['alerts', 'settings'], data);

  const device = useMutation({
    mutationFn: async (on: boolean) => (on ? enablePush(s.data!.publicKey!) : (await disablePush(), api.alertSettings())),
    onMutate: () => setMsg(null),
    onSuccess: (data, on) => {
      set(data);
      setHere(on);
      setMsg({ ok: true, text: on ? 'Pronto: este aparelho vai receber os avisos.' : 'Este aparelho não recebe mais avisos.' });
    },
    onError: fail,
  });
  const prefs = useMutation({ mutationFn: api.updateAlertSettings, onSuccess: set, onError: fail });
  const test = useMutation({
    mutationFn: api.testAlert,
    onMutate: () => setMsg(null),
    onSuccess: (r) =>
      setMsg(
        r.channels.length
          ? { ok: true, text: `Teste enviado por ${r.channels.map((c) => (c === 'push' ? 'notificação' : 'e-mail')).join(' e ')}.` }
          : { ok: false, text: 'Nenhum canal ativo recebeu o teste. Ative a notificação neste aparelho ou o e-mail.' },
      ),
    onError: fail,
  });

  if (!s.data) return <div className="card h-40 animate-pulse" aria-busy="true" />;
  const d = s.data;

  const toggle = (label: string, hint: string, on: boolean, disabled: boolean, onChange: (v: boolean) => void) => (
    <label className="flex min-h-14 cursor-pointer items-center gap-3 border-t border-border py-2" style={{ opacity: disabled ? 0.6 : 1 }}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-brand" />
    </label>
  );

  return (
    <section data-anim="" className="card flex flex-col" aria-label="Avisos">
      <div className="card-title">Avisos da Pluto</div>
      <div className="mt-1 mb-2 text-[13px] text-muted-foreground">
        Boleto que o saldo não cobre, mês indo para o vermelho, gasto acima do normal e o resumo da semana. No máximo 3 por dia, nada entre 22h e 7h (só
        vencimento do dia) e nunca com valores na tela bloqueada. Tudo também fica no sino.
      </div>
      {toggle(
        'Notificações',
        d.pushAvailable ? `${d.devices} aparelho${d.devices === 1 ? '' : 's'} recebendo` : 'O servidor ainda não tem as chaves de notificação',
        d.push,
        !d.pushAvailable || prefs.isPending,
        (v) => prefs.mutate({ push: v }),
      )}
      {toggle('E-mail', d.emailAvailable ? 'Aviso curto, com link para abrir a Pluto' : 'O envio de e-mail não está configurado', d.email, !d.emailAvailable || prefs.isPending, (v) =>
        prefs.mutate({ email: v }),
      )}
      {d.pushAvailable && d.push && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {!supported ? (
            <span className="text-[13px] text-muted-foreground">Este navegador não recebe notificações. No iPhone, instale a Pluto na tela inicial primeiro.</span>
          ) : (
            <button onClick={() => device.mutate(!here)} disabled={device.isPending || here === null} className={`btn ${here ? 'btn-outline' : 'btn-primary'} h-11`}>
              <Icon icon="bell" size={16} />
              {device.isPending ? 'Aguarde…' : here ? 'Parar neste aparelho' : 'Receber neste aparelho'}
            </button>
          )}
          <button onClick={() => test.mutate()} disabled={test.isPending} className="btn btn-outline h-11">
            <Icon icon="send" size={16} />
            {test.isPending ? 'Enviando…' : 'Enviar teste'}
          </button>
        </div>
      )}
      {msg && (
        <div role={msg.ok ? 'status' : 'alert'} className={`mt-2 flex items-center gap-2 text-[13px] ${msg.ok ? 'text-brand-text' : 'text-danger-text'}`}>
          <Icon icon={msg.ok ? 'circle-check' : 'circle-alert'} size={16} />
          {msg.text}
        </div>
      )}
    </section>
  );
}
