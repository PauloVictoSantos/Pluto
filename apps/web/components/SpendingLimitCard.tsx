'use client';

import type { SpendingLimit } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { maskMoney } from '@/lib/format';
import { ROUTES } from '@/lib/nav';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';

const TONE: Record<SpendingLimit['status'], { bar: string; text: string }> = {
  ok: { bar: '#7D39EB', text: 'var(--muted-foreground)' },
  atencao: { bar: '#F59E0B', text: 'var(--foreground)' },
  estourado: { bar: '#EF4444', text: 'var(--danger-text)' },
  'sem-renda': { bar: 'var(--muted-foreground)', text: 'var(--muted-foreground)' },
};

/**
 * Limite de gasto variavel do mes gerenciado pelo Plutao (doc. Pluton 3.3): o servidor calcula
 * renda - fixos - parcelas - aportes - margem e recalcula a cada mudanca; aqui so se mostra.
 */
export function SpendingLimitCard() {
  const qc = useQueryClient();
  // Renda, fixos, dividas e metas mudam em outras telas: busca de novo sempre que o card aparece.
  const q = useQuery({ queryKey: ['agent-limit'], queryFn: api.spendingLimit, refetchOnMount: 'always' });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState({ text: '', value: 0 });
  const [error, setError] = useState('');
  const override = useMutation({
    mutationFn: (amountMinor: number | null) => api.overrideLimit(amountMinor),
    onSuccess: (data) => {
      qc.setQueryData(['agent-limit'], data);
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      setEditing(false);
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.'),
  });
  const l = q.data;
  if (!l) return <div data-anim="" className="h-44 animate-pulse rounded-2xl bg-muted" />;
  const tone = TONE[l.status];
  const b = l.breakdown;

  if (l.status === 'sem-renda')
    return (
      <section data-anim="" className="card flex flex-col gap-2" aria-label="Limite de gasto do mês">
        <div className="card-title">Limite de gasto do mês</div>
        <div className="text-[13px] text-muted-foreground">
          O Plutão calcula quanto você pode gastar no mês a partir da sua renda, dos gastos fixos, das dívidas e das metas. Para começar, informe sua renda.
        </div>
        <a href={ROUTES.settings} className="btn btn-primary h-10 self-start px-4 text-[14px]">
          Informar renda
        </a>
      </section>
    );

  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Limite de gasto do mês">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="card-title">Limite de gasto do mês</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {l.overrideMinor !== null ? `Definido por você · o plano calculou ${money(l.computedMinor)}` : 'Calculado pelo Plutão e atualizado a cada mudança no seu plano'}
          </div>
        </div>
        <button onClick={() => (setEditing(!editing), setError(''), setValue(maskMoney(String(l.limitMinor))))} className="btn btn-outline h-9 px-3 text-[13px]">
          {editing ? 'Fechar' : 'Ajustar'}
        </button>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-[clamp(26px,6vw,34px)] font-bold tracking-[-0.04em] tabular-nums" style={{ color: l.remainingMinor < 0 ? 'var(--danger-text)' : undefined }}>
            {money(Math.abs(l.remainingMinor))}
          </span>
          <span className="ml-1.5 text-[13px] text-muted-foreground">{l.remainingMinor < 0 ? 'acima do limite' : 'disponíveis'}</span>
        </div>
        <span className="text-[13px] tabular-nums" style={{ color: tone.text }}>
          {money(l.spentMinor)} de {money(l.limitMinor)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(l.usedPct, 1) * 100)}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(l.usedPct, 1) * 100}%`, background: tone.bar }} />
      </div>
      {l.remainingMinor > 0 && (
        <div className="text-[13px]">
          Para chegar ao fim do mês: <strong className="tabular-nums">{money(l.weekMinor)}</strong> por semana · <strong className="tabular-nums">{money(l.dayMinor)}</strong> por dia
        </div>
      )}
      {l.status === 'estourado' && <div className="text-[13px] text-danger-text">O limite acabou. Daqui em diante, cada gasto sai das metas ou da margem de segurança.</div>}
      {b.deficitMinor > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-[13px] text-danger-text">
          <Icon icon="circle-alert" size={16} />
          Fixos, parcelas e metas passam da renda em {money(b.deficitMinor)}. O plano precisa de ajuste: reduzir aportes, renegociar dívidas ou cortar fixos.
        </div>
      )}
      {l.typicalMinor !== null && l.typicalMinor > l.limitMinor && b.deficitMinor === 0 && (
        <div className="text-[12.5px] text-muted-foreground">
          Seu gasto variável costuma chegar a {money(l.typicalMinor)} por mês, acima deste limite. Vale olhar onde dá para segurar.
        </div>
      )}

      <details className="text-[13px]">
        <summary className="cursor-pointer font-semibold">Como o limite é calculado</summary>
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
          <span>Renda líquida</span>
          <span className="text-right">{money(b.incomeMinor)}</span>
          <span>− Gastos fixos e parcelas</span>
          <span className="text-right">{money(b.fixedMinor)}</span>
          <span>− Aportes das metas</span>
          <span className="text-right">{money(b.goalsMinor)}</span>
          <span>− Margem de segurança</span>
          <span className="text-right">{money(b.marginMinor)}</span>
          <span className="border-t border-border pt-1 font-semibold">= Limite calculado</span>
          <span className="border-t border-border pt-1 text-right font-semibold">{money(l.computedMinor)}</span>
        </div>
      </details>

      {editing && (
        <form
          className="flex flex-col gap-2 rounded-xl bg-muted p-3"
          onSubmit={(e) => {
            e.preventDefault();
            override.mutate(Math.round(value.value * 100));
          }}
        >
          <label className="text-[13px] font-semibold" htmlFor="limit-override">
            Definir o limite deste mês
          </label>
          <div className="flex gap-2">
            <input id="limit-override" value={value.text} onChange={(e) => setValue(maskMoney(e.target.value))} inputMode="numeric" className="input flex-1" />
            <button type="submit" disabled={override.isPending} className="btn btn-primary h-11 px-4 text-[14px]">
              Salvar
            </button>
          </div>
          <div className="text-[12px] text-muted-foreground">Vale só para este mês e gera um aviso. No mês que vem, o Plutão volta a calcular.</div>
          {l.overrideMinor !== null && (
            <button type="button" onClick={() => override.mutate(null)} disabled={override.isPending} className="self-start text-[13px] font-semibold text-brand-text underline">
              Voltar ao limite calculado ({money(l.computedMinor)})
            </button>
          )}
          {error && <div className="text-[13px] text-danger-text">{error}</div>}
        </form>
      )}
    </section>
  );
}
