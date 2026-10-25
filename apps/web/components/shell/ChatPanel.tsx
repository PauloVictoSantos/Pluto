'use client';

import type { AgentChatState } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { api } from '@/lib/api';
import { PAUSED_TEXT, WORKING_TEXT, deliver } from '@/lib/chat-delivery';
import { EASE_DRAWER, play } from '@/lib/motion';
import { PlutoLogo } from '../brand/PlutoLogo';
import { PlutoMascot } from '../brand/PlutoMascot';
import { Icon } from '../ui/Icon';

// Chat com o Plutao (doc. Pluton 7): o agente le o plano, calcula e propoe. Nada e gravado sem um
// "sim" explicito; enquanto ha acao pendente, aparecem os botoes Sim / Nao.
// Interface (doc. Melhorias, passo 4): campo que cresce ate 5 linhas com contador, perguntas com
// opcoes em lista de escolha, sugestoes que rolam (arrastar e setas) e nenhuma mensagem de erro.

const SUGGESTIONS = ['Como está meu mês?', 'Posso comprar um celular de R$ 2.000?', 'Quero criar uma meta', 'Quais dívidas quito primeiro?', 'Cadastrar um gasto fixo'];
const GREETING = 'Sou o Plutão. Cuido dos seus gastos fixos, metas e do limite do mês. Me diga o que quer comprar ou planejar e eu calculo se cabe.';
export const MAX_CHARS = 1000;
const MAX_LINES = 5;

interface Outgoing {
  text: string;
  clientId: string;
}

/** Gaveta lateral do chat. Fica montada para manter o historico entre aberturas. */
export function ChatPanel({ open, onClose, fullWidth }: { open: boolean; onClose: () => void; fullWidth: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['agent-chat'], queryFn: api.agentChat, enabled: open });
  const [input, setInput] = useState('');
  const [sent, setSent] = useState<Outgoing | null>(null);
  const [busy, setBusy] = useState(false);
  /** Aviso neutro no lugar de erro: reenviando, pausado ou resposta da regra de negocio. */
  const [notice, setNotice] = useState<{ text: string; resend?: boolean } | null>(null);
  const generation = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const apply = (s: AgentChatState) => {
    qc.setQueryData(['agent-chat'], s);
    // Escritas pelo chat mudam fixos, metas e o limite nas telas.
    for (const k of ['fixed-expenses', 'goals', 'goals-plan', 'goal-drafts', 'agent-limit', 'loans', 'analytics']) void qc.invalidateQueries({ queryKey: [k] });
  };

  const transmit = async (out: Outgoing) => {
    const gen = ++generation.current;
    setSent(out);
    setBusy(true);
    setNotice(null);
    const r = await deliver(() => api.sendAgentMessage(out.text, out.clientId), {
      onRetrying: () => setNotice({ text: WORKING_TEXT }),
      cancelled: () => gen !== generation.current,
    });
    if (r.kind === 'cancelled') return;
    setBusy(false);
    if (r.kind === 'ok') {
      apply(r.value);
      setSent(null);
      setNotice(null);
    } else if (r.kind === 'notice') {
      // Nao foi aceita (limite do dia, IA desligada): o texto volta para o campo.
      setSent(null);
      setInput((cur) => cur || out.text);
      setNotice({ text: r.text });
    } else setNotice({ text: PAUSED_TEXT, resend: true });
  };

  const reset = useMutation({
    mutationFn: api.resetAgentChat,
    onMutate: () => {
      generation.current++;
      setBusy(false);
      setSent(null);
      setNotice(null);
    },
    onSuccess: apply,
  });
  const consent = useMutation({
    mutationFn: () => api.setAiConsent(true),
    onSuccess: () => {
      for (const k of ['agent-chat', 'me']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const thinking = busy;
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
  }, [s, sent, open, thinking, notice]);

  const ask = (text: string) => {
    const t = text.trim().slice(0, MAX_CHARS);
    if (!t || thinking) return;
    setInput('');
    void transmit({ text: t, clientId: crypto.randomUUID() });
  };

  if (!open) return null;
  const messages = [{ role: 'plutao' as const, text: GREETING }, ...(s?.messages ?? []), ...(sent ? [{ role: 'user' as const, text: sent.text }] : [])];
  const last = s?.messages.at(-1);
  // Pergunta com escolha: so a ultima fala do Plutao, sem acao pendente nem mensagem a caminho.
  const choices = !sent && !thinking && !s?.pending && last?.role === 'plutao' && last.options?.length ? last.options : null;
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-55 bg-overlay" />
      <aside
        ref={panel}
        role="dialog"
        aria-label="Chat com o Plutão"
        // 100dvh e fundo solido: com o teclado do celular aberto, nada da tela de tras aparece.
        className="fixed top-0 right-0 z-56 flex h-dvh max-w-full flex-col border-l border-border bg-card text-foreground"
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
            <button onClick={() => reset.mutate()} disabled={reset.isPending} className="btn btn-outline h-9 px-3 text-[12.5px]">
              Nova conversa
            </button>
          )}
          <button onClick={onClose} aria-label="Fechar" className="icon-btn size-11">
            <Icon icon="x" size={18} />
          </button>
        </div>
        <div ref={list} className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain bg-card p-4" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} data-msg="" className="flex" style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div
                className="max-w-[84%] px-3.5 py-[11px] text-[15px] leading-normal break-words whitespace-pre-line text-pretty"
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
          {choices && <ChoiceGroup key={`${s?.messages.length}`} question={last!.text} options={choices} onConfirm={ask} />}
          {thinking && (
            <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
              <PlutoLogo size={26} />
              <span className="inline-flex gap-1" aria-label="Plutão está pensando">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 rounded-full bg-brand" style={{ animation: `plutoDot 1s ${i * 0.15}s infinite` }} />
                ))}
              </span>
              {notice && <span>{notice.text}</span>}
            </div>
          )}
          {!thinking && notice && (
            <div data-msg="" className="flex flex-col items-start gap-2">
              <div className="max-w-[84%] rounded-[18px_18px_18px_4px] bg-muted px-3.5 py-[11px] text-[15px] leading-normal">{notice.text}</div>
              {notice.resend && sent && (
                <button onClick={() => void transmit(sent)} className="btn btn-outline h-9 px-3 text-[13px]">
                  <Icon icon="refresh-cw" size={15} />
                  Reenviar
                </button>
              )}
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
        <div className="flex flex-col gap-2.5 border-t border-border bg-card px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          {!s?.messages.length && s?.consent && <SuggestionStrip items={SUGGESTIONS} onPick={ask} />}
          <Composer value={input} onChange={setInput} onSend={() => ask(input)} disabled={thinking || !s?.consent} placeholder={s?.pending ? 'Responda sim ou não…' : 'Fale com o Plutão…'} />
        </div>
      </aside>
    </>
  );
}

/** Area de texto que cresce ate 5 linhas (depois rola por dentro), com limite e contador. */
function Composer({ value, onChange, onSend, disabled, placeholder }: { value: string; onChange: (v: string) => void; onSend: () => void; disabled: boolean; placeholder: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const counterId = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES)}px`;
  }, [value]);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia; Shift+Enter quebra a linha.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!disabled) onSend();
    }
  };
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!disabled) onSend();
      }}
      className="flex items-end gap-2"
    >
      <div className="input flex min-w-0 flex-1 flex-col rounded-3xl px-4 py-2.5 focus-within:border-[var(--ring)]" style={{ height: 'auto' }}>
        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Mensagem para o Plutão"
          aria-describedby={counterId}
          maxLength={MAX_CHARS}
          className="w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-[16px] focus-visible:outline-none leading-[22px] break-words text-foreground outline-none"
        />
        <span id={counterId} className="self-end text-[11px] text-muted-foreground tabular-nums" aria-live="polite">
          {value.length}/{MAX_CHARS}
        </span>
      </div>
      <button type="submit" aria-label="Enviar" disabled={disabled || !value.trim()} className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-brand text-white disabled:opacity-50">
        <Icon icon="send-horizontal" size={18} />
      </button>
    </form>
  );
}

/** Pergunta do Plutao com respostas conhecidas: uma escolha (radio) e o botao Confirmar. */
function ChoiceGroup({ question, options, onConfirm }: { question: string; options: string[]; onConfirm: (v: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const name = useId();
  return (
    <form
      data-msg=""
      onSubmit={(e) => {
        e.preventDefault();
        if (picked) onConfirm(picked);
      }}
      className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3"
    >
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" role="radiogroup" aria-label={question}>
        {options.map((o) => (
          <label
            key={o}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-[14px] transition-colors"
            style={{ borderColor: picked === o ? 'var(--brand)' : 'var(--border)', background: picked === o ? 'var(--brand-soft)' : 'transparent' }}
          >
            <input type="radio" name={name} value={o} checked={picked === o} onChange={() => setPicked(o)} className="size-4 accent-[var(--brand)]" />
            <span className="min-w-0 break-words">{o}</span>
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={!picked} className="btn btn-primary h-10 text-[14px] disabled:opacity-50">
        Confirmar
      </button>
    </form>
  );
}

/** Sugestoes em linha: rolam com o dedo, arrastando com o mouse ou pelas setas ‹ ›. */
function SuggestionStrip({ items, onPick }: { items: string[]; onPick: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);

  const update = () => {
    const el = ref.current;
    if (el) setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const by = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse' || !ref.current) return;
    drag.current = { x: e.clientX, scroll: ref.current.scrollLeft, moved: false };
    // O encaixe (snap) brigaria com o arraste: volta ao soltar.
    ref.current.style.scrollSnapType = 'none';
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current, el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    el.scrollLeft = d.scroll - dx;
  };
  const endDrag = () => {
    if (!drag.current) return;
    if (ref.current) ref.current.style.scrollSnapType = '';
    setTimeout(() => (drag.current = null), 0);
  };

  const arrow = (dir: 1 | -1) => (
    <button
      type="button"
      onClick={() => by(dir)}
      aria-label={dir < 0 ? 'Ver sugestões anteriores' : 'Ver mais sugestões'}
      className={`absolute top-1/2 z-1 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-border bg-card shadow-sm ${dir < 0 ? 'left-0' : 'right-0'}`}
    >
      <Icon icon={dir < 0 ? 'chevron-left' : 'chevron-right'} size={16} />
    </button>
  );

  return (
    <div className="relative">
      {edges.left && arrow(-1)}
      <div
        ref={ref}
        onScroll={update}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto select-none"
        style={{ scrollPaddingInline: 36 }}
      >
        {items.map((t) => (
          <button
            key={t}
            type="button"
            // Um arraste com o mouse nao conta como clique.
            onClick={() => !drag.current?.moved && onPick(t)}
            className="btn btn-outline h-9 shrink-0 snap-start px-3 text-[13px] font-normal"
          >
            {t}
          </button>
        ))}
      </div>
      {edges.right && arrow(1)}
    </div>
  );
}
