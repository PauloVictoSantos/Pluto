'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { askPluto } from '@/lib/assistant';
import { ymdIn } from '@/lib/datetime';
import { useTz } from '@/lib/queries';
import { EASE_DRAWER, play } from '@/lib/motion';
import { PlutoLogo } from '../brand/PlutoLogo';
import { PlutoMascot } from '../brand/PlutoMascot';
import { Icon } from '../ui/Icon';

const SUGGESTIONS = ['Onde eu mais gastei?', 'Como estou comparado ao mês passado?', 'Quais faturas vencem?', 'Qual meu saldo?', 'Quanto sobrou este mês?'];

interface Msg {
  role: 'pluto' | 'user';
  text: string;
}

/** Gaveta lateral do chat. Fica montada para manter o historico entre aberturas. */
export function ChatPanel({ open, onClose, fullWidth }: { open: boolean; onClose: () => void; fullWidth: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'pluto', text: 'Oi! Pergunte sobre seu saldo, gastos do mês, categorias, faturas, orçamento e metas. Eu respondo com base nos dados do seu Open Finance.' },
  ]);
  const tz = useTz();
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);

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
  }, [messages, open]);

  useEffect(() => {
    if (thinking && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [thinking]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || thinking) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setThinking(true);
    // Historico sem a saudacao inicial.
    const answer = await askPluto(q, ymdIn(new Date(), tz), messages.slice(1));
    setMessages((m) => [...m, { role: 'pluto', text: answer }]);
    setThinking(false);
  };

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-55 bg-overlay" />
      <aside
        ref={panel}
        role="dialog"
        aria-label="Chat com a Pluto"
        className="fixed inset-y-0 right-0 z-56 flex max-w-full flex-col border-l border-border bg-card text-foreground"
        style={{ width: fullWidth ? '100%' : 420 }}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <span className="size-[60px] shrink-0 overflow-hidden rounded-2xl bg-brand-soft">
            <PlutoMascot mood={thinking ? 'think' : ''} talk={false} />
          </span>
          <div className="flex-1">
            <div className="text-base font-bold">Pluto</div>
            <div className="text-xs text-muted-foreground">Sua assistente financeira</div>
          </div>
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
              <span className="inline-flex gap-1" aria-label="Pluto está digitando">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 rounded-full bg-brand" style={{ animation: `plutoDot 1s ${i * 0.15}s infinite` }} />
                ))}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2.5 border-t border-border px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} className="btn btn-outline h-9 shrink-0 px-3 text-[13px] font-normal">
                {s}
              </button>
            ))}
          </div>
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
              placeholder="Pergunte algo à Pluto…"
              aria-label="Mensagem para a Pluto"
              className="input h-12 flex-1 rounded-full px-4"
            />
            <button type="submit" aria-label="Enviar" className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-brand text-white">
              <Icon icon="send-horizontal" size={18} />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
