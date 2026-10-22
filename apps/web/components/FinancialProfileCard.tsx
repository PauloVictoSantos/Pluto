'use client';

import { YEAR_OBJECTIVES, YEAR_OBJECTIVE_LABEL, type FinancialProfile, type YearObjective } from '@pluto/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { maskMoney } from '@/lib/format';
import { money } from '@/lib/queries';
import { Icon } from './ui/Icon';

const pctText = (rate: number) => (rate * 100).toFixed(2).replace('.', ',');

/**
 * Perfil financeiro (Configuracoes): o que o Plutao usa nos calculos. A renda vem sugerida pela
 * mediana das entradas dos ultimos meses; a margem de seguranca e a parte que ele nunca compromete.
 */
export function FinancialProfileCard() {
  const q = useQuery({ queryKey: ['agent-profile'], queryFn: api.financialProfile });
  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Perfil financeiro">
      <div>
        <div className="card-title">Perfil financeiro</div>
        <div className="mt-1 text-[13px] text-muted-foreground">O Plutão usa estes dados para calcular quanto você pode comprometer por mês. A renda fica criptografada.</div>
      </div>
      {q.data ? <ProfileForm key={q.data.updatedAt ?? 'novo'} p={q.data} /> : <div className="h-40 animate-pulse rounded-xl bg-muted" />}
    </section>
  );
}

function ProfileForm({ p }: { p: FinancialProfile }) {
  const qc = useQueryClient();
  const [income, setIncome] = useState(() => maskMoney(p.netIncomeMinor === null ? '' : String(p.netIncomeMinor)));
  const [margin, setMargin] = useState(p.safetyMarginPct);
  const [objective, setObjective] = useState<YearObjective | ''>(p.yearObjective ?? '');
  const [rate, setRate] = useState(pctText(p.referenceRateMonthly));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rateValue = Number(rate.replace(',', '.')) / 100;
  const rateOk = rate.trim() !== '' && Number.isFinite(rateValue) && rateValue >= 0 && rateValue <= 0.05;
  const save = useMutation({
    mutationFn: () =>
      api.updateFinancialProfile({
        netIncomeMinor: income.text ? Math.round(income.value * 100) : null,
        safetyMarginPct: margin,
        yearObjective: objective || null,
        referenceRateMonthly: Math.round(rateValue * 1e6) / 1e6,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['agent-profile'], data);
      setMsg({ ok: true, text: 'Perfil financeiro salvo.' });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof ApiRequestError ? e.message : 'Não conseguimos salvar. Tente de novo.' }),
  });
  const incomeMinor = income.text ? Math.round(income.value * 100) : p.suggestedIncomeMinor;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (rateOk) save.mutate();
      }}
    >
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Renda líquida mensal
        <input value={income.text} onChange={(e) => setIncome(maskMoney(e.target.value))} inputMode="numeric" placeholder="R$ 0,00" className="input" />
        {p.suggestedIncomeMinor !== null && (
          <span className="flex flex-wrap items-center gap-2 text-[12px] font-normal text-muted-foreground">
            Pelas suas entradas dos últimos meses: {money(p.suggestedIncomeMinor)}
            {Math.round(income.value * 100) !== p.suggestedIncomeMinor && (
              <button type="button" onClick={() => setIncome(maskMoney(String(p.suggestedIncomeMinor)))} className="font-semibold text-brand-text underline">
                usar este valor
              </button>
            )}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        <span className="flex justify-between">
          Margem de segurança <span className="tabular-nums">{margin}%</span>
        </span>
        <input type="range" min={0} max={15} step={1} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="accent-[var(--brand)]" />
        <span className="text-[12px] font-normal text-muted-foreground">
          Parte da renda que o Plutão nunca compromete{incomeMinor ? `: ${money(Math.round((incomeMinor * margin) / 100))} por mês` : ''}.
        </span>
      </label>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Objetivo do ano
        <select value={objective} onChange={(e) => setObjective(e.target.value as YearObjective | '')} className="input">
          <option value="">Ainda não defini</option>
          {YEAR_OBJECTIVES.map((o) => (
            <option key={o} value={o}>
              {YEAR_OBJECTIVE_LABEL[o]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Rendimento do dinheiro guardado (% ao mês)
        <input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d,.]/g, '').slice(0, 5))} inputMode="decimal" className="input" aria-invalid={!rateOk} />
        <span className={`text-[12px] font-normal ${rateOk ? 'text-muted-foreground' : 'text-danger-text'}`}>
          {rateOk ? 'Usado para comparar à vista com desconto e parcelado sem juros.' : 'Use um valor entre 0 e 5% ao mês.'}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={save.isPending || !rateOk} className="btn btn-primary h-10 px-4 text-[14px]">
          {save.isPending ? 'Salvando…' : 'Salvar perfil'}
        </button>
        {msg && (
          <span role="status" className={`flex items-center gap-1.5 text-[13px] ${msg.ok ? 'text-brand-text' : 'text-danger-text'}`}>
            {msg.ok && <Icon icon="circle-check" size={16} />}
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
