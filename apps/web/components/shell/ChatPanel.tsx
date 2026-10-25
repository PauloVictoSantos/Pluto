'use client';

import type { AgentChatState } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { EASE_DRAWER, play } from '@/lib/motion';
import { PlutoLogo } from '../brand/PlutoLogo';
import { PlutoMascot } from '../brand/PlutoMascot';
import { Icon } from '../ui/Icon';

// Chat com o Plutao (doc. Pluton 7): o agente le o plano, calcula e propoe. Nada e gravado sem um
// "sim" explicito; enquanto ha acao pendente, aparecem os botoes Sim / Nao.

const SUGGESTIONS = ['Como está meu mês?', 'Posso comprar um celular de R$ 2.000?', 'Quero criar uma meta', 'Quais dívidas quito primeiro?', 'Cadastrar um gasto fixo'];
const GREETING = 'Sou o Plutão. Cuido dos seus gastos fixos, metas e do limite do mês. Me diga o que quer comprar ou planejar e eu calculo se cabe.';

/** Gaveta lateral do chat. Fica montada para manter o historico entre aberturas. */
export function ChatPanel({ open, onClose, fullWidth }: { open: boolean; onClose: () => void; fullWidth: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['agent-chat'], queryFn: api.agentChat, enabled: open });
  const [input, setInput] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const apply = (s: AgentChatState) => {
    qc.setQueryData(['agent-chat'], s);
    setSent(null);
    setError('');
    // Escritas pelo chat mudam fixos, metas e o limite nas telas.
    for (const k of ['fixed-expenses', 'goals', 'goals-plan', 'goal-drafts', 'agent-limit', 'loans', 'analytics']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const send = useMutation({
    // Id por mensagem: as novas tentativas automaticas reenviam a mesma, sem duplicar.
    mutationFn: (text: string) => api.sendAgentMessage(text, crypto.randomUUID()),
    onSuccess: apply,
    onError: (e) => {
      setSent(null);
      setError(e instanceof ApiRequestError ? e.message : 'O Plutão não respondeu agora. Tente de novo.');
    },
  });
  const reset = useMutation({ mutationFn: api.resetAgentChat, onSuccess: apply });
  const consent = useMutation({
    mutationFn: () => api.setAiConsent(true),
    onSuccess: () => {
      for (const k of ['agent-chat', 'me']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const thinking = send.isPending;
  const s = q.data;

  useEffect(() => {
    if (open) play(panel.current, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 500, easing: EASE_DRAWER });
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const msgs = el.querySelectorAll('[data-msg]'), last = msgs[msgs.length - 1];
    // Feedback de que a mensagem chegou.
    play(last, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 200 });
  }, [s, sent, open, thinking]);

  const ask = (text: string) => {
    const t = text.trim();
    if (!t || thinking) return;
    setSent(t);
    setInput('');
    send.mutate(t);
  };

  if (!open) return null;
  const messages = [{ role: 'plutao' as const, text: GREETING }, ...(s?.messages ?? []), ...(sent ? [{ role: 'user' as const, text: sent }] : [])];
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-55 bg-overlay" />
      <aside
        ref={panel}
        role="dialog"
        aria-label="Chat com o Plutão"
        className="fixed inset-y-0 right-0 z-56 flex max-w-full flex-col border-l border-border bg-card text-foreground"
        style={{ width: fullWidth ? '100%' : 420 }}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <span className="size-[60px] shrink-0 overflow-hidden rounded-2xl bg-brand-soft">
            <PlutoMascot mood={thinking ? 'think' : ''} talk={false} />
          </span>
          <div className="flex-1">
            <div className="text-base font-bold">Plutão</div>
            <div className="text-xs text-muted-foreground">Seu agente financeiro</div>
          </div>
          {!!s?.messages.length && (
            <button onClick={() => reset.mutate()} disabled={reset.isPending || thinking} className="btn btn-outline h-9 px-3 text-[12.5px]">
              Nova conversa
            </button>
          )}
          <button onClick={onClose} aria-label="Fechar" className="icon-btn size-11">
            <Icon icon="x" size={18} />
          </button>
        </div>
        <div ref={list} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} data-msg="" className="flex" style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div
                className="max-w-[84%] px-3.5 py-[11px] text-[15px] leading-normal whitespace-pre-line text-pretty"
                style={
                  m.role === 'user'
                    ? { background: 'var(--primary)', color: 'var(--primary-foreground)', borderRadius: '18px 18px 4px 18px' }
                    : { background: 'var(--muted)', color: 'var(--foreground)', borderRadius: '18px 18px 18px 4px' }
                }
              >
                {m.text}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
              <PlutoLogo size={26} />
              <span className="inline-flex gap-1" aria-label="Plutão está pensando">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 rounded-full bg-brand" style={{ animation: `plutoDot 1s ${i * 0.15}s infinite` }} />
                ))}
              </span>
            </div>
          )}
          {s?.pending && !thinking && (
            <div className="flex flex-col gap-2 rounded-2xl border border-brand bg-brand-soft p-3" role="group" aria-label="Confirmar ação">
              <div className="text-[13px] font-semibold">Confirma esta ação?</div>
              <div className="text-[13px]">{s.pending.summary}</div>
              <div className="flex gap-2">
                <button onClick={() => ask('não')} className="btn btn-outline h-10 flex-1 bg-card text-[14px]">
                  Não
                </button>
                <button onClick={() => ask('sim')} className="btn btn-primary h-10 flex-1 text-[14px]">
                  Sim, pode gravar
                </button>
              </div>
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
              <Icon icon="circle-alert" size={16} />
              {error}
            </div>
          )}
          {s && !s.consent && (
            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted p-3 text-[13px]" role="group" aria-label="Autorizar uso de IA">
              <div className="font-semibold">Antes de começar</div>
              <div>
                Para conversar, o Plutão envia ao provedor de IA (Google Gemini) só números agregados do seu plano. Extratos completos, nome, CPF, e-mail, telefone e números de
                conta nunca são enviados. Você pode retirar a autorização em Configurações › Privacidade e dados.
              </div>
              <button onClick={() => consent.mutate()} disabled={consent.isPending} className="btn btn-primary h-10 text-[14px]">
                Autorizo o uso de IA
              </button>
            </div>
          )}
          {s && s.consent && !s.available && !s.pending && (
            <div className="text-[13px] text-muted-foreground">O Plutão precisa da IA ligada. Ative a opção de IA em Configurações.</div>
          )}
        </div>
        <div className="flex flex-col gap-2.5 border-t border-border px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          {!s?.messages.length && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              {s?.consent && SUGGESTIONS.map((t) => (
                <button key={t} onClick={() => ask(t)} className="btn btn-outline h-9 shrink-0 px-3 text-[13px] font-normal">
                  {t}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={s?.pending ? 'Responda sim ou não…' : 'Fale com o Plutão…'}
              aria-label="Mensagem para o Plutão"
              maxLength={1000}
              className="input h-12 flex-1 rounded-full px-4"
            />
            <button type="submit" aria-label="Enviar" disabled={thinking || !s?.consent} className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-brand text-white">
              <Icon icon="send-horizontal" size={18} />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
