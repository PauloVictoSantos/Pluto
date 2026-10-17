'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CategoryRulesCard } from '@/components/CategoryRulesCard';
import { ConnectionsCard } from '@/components/ConnectionsCard';
import { useReauth } from '@/components/Reauth';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Sheet } from '@/components/ui/Sheet';
import { ApiRequestError, api } from '@/lib/api';
import { initials, maskPhone } from '@/lib/format';
import { useEnter } from '@/lib/motion';
import { setTheme, setUser, useApp, type Theme } from '@/lib/store';

// Preferencias de notificacao ainda locais: entram na API com o modulo de notificacoes (secao 5.6).
const TOGGLES: [string, string, string, boolean][] = [
  ['bills', 'Contas a vencer', 'Aviso 3 dias antes e no dia do vencimento', true],
  ['limit', 'Gastos acima do limite', 'Quando uma categoria passar do orçamento', true],
  ['weekly', 'Resumo semanal da Pluto', 'Toda segunda, às 8h', true],
  ['hide', 'Esconder valores ao abrir', 'Mostra R$ •••• até você tocar no olho', false],
  ['bio', 'Entrar com biometria', 'Face ID ou digital (no app)', true],
];
const THEMES: { id: Theme; label: ReactNode }[] = [
  { id: 'light', label: <><Icon icon="sun" size={16} />Claro</> },
  { id: 'dark', label: <><Icon icon="moon" size={16} />Escuro</> },
];

export default function ConfiguracoesPage() {
  const user = useApp((s) => s.user)!;
  const theme = useApp((s) => s.theme);
  const { run, sheet } = useReauth();
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(TOGGLES.map((t) => [t[0], t[3]])));
  const [draft, setDraft] = useState<{ name: string; email: string; phone: string } | null>(null);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEnter(root);

  const err = !draft
    ? ''
    : !draft.name.trim()
      ? 'Informe seu nome.'
      : !/^\S+@\S+\.\S+$/.test(draft.email)
        ? 'Informe um e-mail válido.'
        : '';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (err) return setTried(true);
    setSaving(true);
    setServerErr('');
    try {
      // Trocar o e-mail de login pede confirmacao de identidade (secao 6.2).
      const me = await run(() => api.updateMe({ name: draft.name.trim(), email: draft.email, phone: draft.phone || null }));
      setUser(me);
      setDraft(null);
      setSaved(true);
    } catch (e2) {
      if (!(e2 instanceof ApiRequestError && e2.code === 'REAUTH_CANCELLED')) setServerErr(e2 instanceof ApiRequestError ? e2.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
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
          {user.phone && <div className="mt-0.5 text-[13px] text-muted-foreground">{user.phone}</div>}
        </div>
        <button
          onClick={() => {
            setDraft({ name: user.name, email: user.email, phone: user.phone ?? '' });
            setTried(false);
            setSaved(false);
            setServerErr('');
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

      <ConnectionsCard />
      <CategoryRulesCard />

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
            E-mail de login
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
          {((tried && err) || serverErr) && (
            <div role="alert" className="flex items-center gap-2 text-[13px] text-danger-text">
              <Icon icon="circle-alert" size={16} />
              {err || serverErr}
            </div>
          )}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setDraft(null)} className="btn btn-outline h-[50px] flex-1 text-[15px]">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary h-[50px] flex-1 text-[15px]" style={{ opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </Sheet>
      )}
      {sheet}
    </div>
  );
}
