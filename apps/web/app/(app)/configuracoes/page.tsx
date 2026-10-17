'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Sheet } from '@/components/ui/Sheet';
import { initials, maskPhone } from '@/lib/format';
import { vm } from '@/lib/mock/vm';
import { useEnter } from '@/lib/motion';
import { setTheme, setUser, useApp, type Theme } from '@/lib/store';

const TOGGLES: [string, string, string, boolean][] = [
  ['bills', 'Contas a vencer', 'Aviso 3 dias antes e no dia do vencimento', true],
  ['limit', 'Gastos acima do limite', 'Quando uma categoria passar do orçamento', true],
  ['weekly', 'Resumo semanal da Pluto', 'Toda segunda, às 8h', true],
  ['hide', 'Esconder valores ao abrir', 'Mostra R$ •••• até você tocar no olho', false],
  ['bio', 'Entrar com biometria', 'Face ID ou digital', true],
];
const THEMES: { id: Theme; label: ReactNode }[] = [
  { id: 'light', label: <><Icon icon="sun" size={16} />Claro</> },
  { id: 'dark', label: <><Icon icon="moon" size={16} />Escuro</> },
];

export default function ConfiguracoesPage() {
  const user = useApp((s) => s.user);
  const theme = useApp((s) => s.theme);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(TOGGLES.map((t) => [t[0], t[3]])));
  const [draft, setDraft] = useState<{ name: string; email: string; phone: string } | null>(null);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const err = !draft
    ? ''
    : !draft.name.trim()
      ? 'Informe seu nome.'
      : !/^\S+@\S+\.\S+$/.test(draft.email)
        ? 'Informe um e-mail válido.'
        : '';

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (err) return setTried(true);
    setUser({ name: draft.name.trim(), email: draft.email, phone: draft.phone });
    setDraft(null);
    setSaved(true);
  };

  return (
    <div ref={root} className="flex max-w-[820px] flex-col gap-4">
      <h1 data-anim="" className="page-title">
        Configurações
      </h1>

      <div data-anim="" className="card flex flex-wrap items-center gap-4">
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-accent text-[22px] font-bold text-black">{initials(user.name)}</span>
        <div className="min-w-[200px] flex-1">
          <div className="text-lg font-bold">{user.name}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{user.email}</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            CPF {user.cpf} · {user.phone}
          </div>
        </div>
        <button
          onClick={() => {
            setDraft({ name: user.name, email: user.email, phone: user.phone });
            setTried(false);
            setSaved(false);
          }}
          className="btn btn-outline shrink-0"
        >
          <Icon icon="user" size={16} />
          Editar perfil
        </button>
        {saved && (
          <div role="status" className="flex basis-full items-center gap-2 text-[13px] text-brand-text">
            <Icon icon="circle-check" size={16} />
            Perfil atualizado.
          </div>
        )}
      </div>

      <div data-anim="" className="card flex flex-col gap-3.5">
        <div className="card-title">Aparência</div>
        <Segmented items={THEMES} value={theme} onChange={setTheme} height={40} className="self-start" itemClassName="px-[18px] text-sm font-semibold" />
      </div>

      <div data-anim="" className="card flex flex-col">
        <div className="card-title mb-2">Notificações e privacidade</div>
        {TOGGLES.map(([id, label, desc]) => {
          const v = on[id]!;
          return (
            <div key={id} className="flex min-h-16 items-center gap-3.5 border-t border-border">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
              </div>
              <button
                role="switch"
                aria-checked={v}
                aria-label={label}
                onClick={() => setOn((p) => ({ ...p, [id]: !p[id] }))}
                className="flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-0 p-[3px] transition-colors"
                style={{ background: v ? '#7D39EB' : 'var(--border)' }}
              >
                <span
                  className="size-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform duration-[250ms]"
                  style={{ transform: `translateX(${v ? 20 : 0}px)` }}
                />
              </button>
            </div>
          );
        })}
      </div>

      <div data-anim="" className="card flex flex-col">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="card-title">Contas conectadas</span>
          <span className="rounded-full border border-border px-[9px] py-[3px] text-xs text-muted-foreground">Open Finance</span>
        </div>
        {vm.banks().map((b) => (
          <div key={b.id} className="flex min-h-16 items-center gap-3 border-t border-border">
            <span className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: b.color }}>
              {b.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{b.name}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-[7px] rounded-full" style={{ background: b.dot }} />
                {b.status} · {b.updated}
              </div>
            </div>
            <button aria-label={`Sincronizar ${b.name}`} className="icon-btn">
              <Icon icon="refresh-cw" size={16} />
            </button>
          </div>
        ))}
      </div>

      {draft && (
        <Sheet onClose={() => setDraft(null)} onSubmit={save} label="Editar perfil" width={440} top="14vh" gap={14}>
          <div className="flex items-center gap-3">
            <span className="grid size-[52px] shrink-0 place-items-center rounded-full bg-accent text-lg font-bold text-black">{initials(draft.name)}</span>
            <div className="text-xl font-bold tracking-[-0.02em]">Editar perfil</div>
          </div>
          <label className="field">
            Nome completo
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoComplete="name" className="input" />
          </label>
          <label className="field">
            E-mail
            <input
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value.trim() })}
              type="email"
              inputMode="email"
              autoComplete="email"
              className="input"
            />
          </label>
          <label className="field">
            Celular
            <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: maskPhone(e.target.value) })} inputMode="tel" autoComplete="tel" className="input" />
          </label>
          <div className="text-xs text-muted-foreground">O CPF não pode ser alterado pelo app.</div>
          {tried && err && (
            <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
              <Icon icon="circle-alert" size={16} />
              {err}
            </div>
          )}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setDraft(null)} className="btn btn-outline h-[50px] flex-1 text-[15px]">
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary h-[50px] flex-1 text-[15px]">
              Salvar
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
