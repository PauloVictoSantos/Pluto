'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { fmtDateTimeIn } from '@/lib/datetime';
import { useTz } from '@/lib/queries';
import { logout } from '@/lib/store';
import { useReauth } from './Reauth';
import { Icon } from './ui/Icon';
import { Sheet } from './ui/Sheet';

/** Baixa o arquivo no aparelho (o conteudo vem pronto da API). */
function download(f: { filename: string; mime: string; content: string }) {
  const url = URL.createObjectURL(new Blob([f.content], { type: f.mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: f.filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Privacidade e dados (LGPD, doc. Pluton 8.5): consentimento para o Plutao usar IA, exportacao
 * completa, contestacoes registradas e exclusao real da conta.
 */
export function PrivacyCard() {
  const qc = useQueryClient();
  const tz = useTz();
  const { run, sheet } = useReauth();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const contested = useQuery({ queryKey: ['contestations'], queryFn: api.contestations });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState('');
  const fail = (e: unknown) => {
    if (e instanceof ApiRequestError && e.code === 'REAUTH_CANCELLED') return;
    setMsg({ ok: false, text: e instanceof ApiRequestError ? e.message : 'Não foi possível concluir. Tente de novo.' });
  };
  const consentAt = me.data?.settings.aiConsentAt ?? null;

  const consent = useMutation({
    mutationFn: (accept: boolean) => api.setAiConsent(accept),
    onSuccess: (_d, accept) => {
      for (const k of ['me', 'agent-chat']) void qc.invalidateQueries({ queryKey: [k] });
      setMsg({ ok: true, text: accept ? 'Uso de IA autorizado. O Plutão já pode conversar.' : 'Autorização retirada. A conversa com o Plutão foi apagada.' });
    },
    onError: fail,
  });
  const exp = useMutation({
    mutationFn: (format: 'json' | 'csv') => run(() => api.exportMyData(format)),
    onSuccess: (f) => (download(f), setMsg({ ok: true, text: `Arquivo ${f.filename} baixado.` })),
    onError: fail,
  });
  const del = useMutation({ mutationFn: () => run(() => api.deleteAccount()), onSuccess: () => void logout(), onError: fail });

  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Privacidade e dados">
      <div className="card-title">Privacidade e dados</div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="text-[14px] font-semibold">Uso de IA pelo Plutão</div>
        <div className="text-[13px] text-muted-foreground">
          Para conversar, o Plutão envia ao provedor de IA (Google Gemini) só números agregados do seu plano, como renda, limite e metas. Extratos completos, nome, CPF,
          e-mail, telefone e números de conta nunca são enviados. Você pode retirar a autorização quando quiser; a conversa é apagada.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px]">{consentAt ? `Autorizado em ${fmtDateTimeIn(new Date(consentAt), tz)}` : 'Não autorizado'}</span>
          <button onClick={() => consent.mutate(!consentAt)} disabled={consent.isPending || !me.data} className={`btn h-9 px-3 text-[13px] ${consentAt ? 'btn-outline' : 'btn-primary'}`}>
            {consentAt ? 'Retirar autorização' : 'Autorizar uso de IA'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="text-[14px] font-semibold">Seus dados</div>
        <div className="text-[13px] text-muted-foreground">Baixe tudo o que a Pluto guarda sobre você. Por segurança, pedimos sua senha se o login for antigo.</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => exp.mutate('json')} disabled={exp.isPending} className="btn btn-outline h-9 px-3 text-[13px]">
            <Icon icon="download" size={14} />
            Tudo (JSON)
          </button>
          <button onClick={() => exp.mutate('csv')} disabled={exp.isPending} className="btn btn-outline h-9 px-3 text-[13px]">
            <Icon icon="download" size={14} />
            Transações (CSV)
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <div className="text-[14px] font-semibold">Contestações</div>
        <div className="text-[13px] text-muted-foreground">Vereditos do Plutão que você contestou ficam registrados para revisão.</div>
        {contested.data?.length ? (
          contested.data.map((c) => (
            <div key={c.createdAt} className="rounded-xl bg-muted p-2.5 text-[12.5px]">
              <div className="font-semibold">{c.subject}</div>
              <div>{c.text}</div>
              <div className="mt-0.5 text-muted-foreground">{fmtDateTimeIn(new Date(c.createdAt), tz)}</div>
            </div>
          ))
        ) : (
          <div className="text-[12.5px] text-muted-foreground">Nenhuma contestação.</div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="text-[14px] font-semibold text-danger-text">Excluir minha conta</div>
        <div className="text-[13px] text-muted-foreground">Apaga de verdade todos os seus dados, inclusive a conversa com o Plutão e o histórico. Não dá para desfazer.</div>
        <button onClick={() => (setDeleting(true), setWord(''))} className="btn h-9 self-start border-transparent bg-danger-soft px-3 text-[13px] text-danger-text">
          Excluir conta
        </button>
      </div>

      {msg && (
        <div role="status" className={`flex items-center gap-2 text-[13px] ${msg.ok ? 'text-brand-text' : 'text-danger-text'}`}>
          <Icon icon={msg.ok ? 'circle-check' : 'circle-alert'} size={16} />
          {msg.text}
        </div>
      )}

      {deleting && (
        <Sheet onClose={() => setDeleting(false)} role="alertdialog" label="Excluir conta" width={420} top="22vh">
          <div className="text-xl font-bold tracking-[-0.02em]">Excluir sua conta?</div>
          <div className="text-sm text-muted-foreground">
            Todos os seus dados saem da Pluto agora: contas conectadas, transações, metas, dívidas, conversa com o Plutão e histórico. Conexões feitas pelo Pluggy Connect são
            removidas; as do Meu Pluggy você revoga em meu.pluggy.ai.
          </div>
          <label className="field">
            Digite EXCLUIR para confirmar
            <input value={word} onChange={(e) => setWord(e.target.value)} autoCapitalize="characters" className="input" autoFocus />
          </label>
          <div className="flex gap-2.5">
            <button onClick={() => setDeleting(false)} className="btn btn-outline h-12 flex-1">
              Cancelar
            </button>
            <button onClick={() => del.mutate()} disabled={word !== 'EXCLUIR' || del.isPending} className="btn h-12 flex-1 border-transparent bg-danger-soft text-danger-text">
              {del.isPending ? 'Excluindo…' : 'Excluir tudo'}
            </button>
          </div>
        </Sheet>
      )}
      {sheet}
    </section>
  );
}
