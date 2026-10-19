'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { monthLower, money } from '@/lib/queries';
import { ProbabilityBadge, RangeBar, Why } from './Insight';

/**
 * Saldo no fim do mes (Visao geral): primeiro a conclusao ("78% de chance de fechar no azul"),
 * depois a faixa, depois a conta no "por que" (doc. "Revelacao progressiva", RN-M05).
 */
export function ForecastCard() {
  const q = useQuery({ queryKey: ['analytics', 'forecast'], queryFn: api.forecast, staleTime: 5 * 60_000 });
  const f = q.data;

  if (q.isPending)
    return (
      <div className="card flex flex-col gap-3" aria-busy="true">
        <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-6 w-full animate-pulse rounded-full bg-muted" />
      </div>
    );
  if (q.isError || !f)
    return (
      <div className="card flex items-center justify-between gap-3 text-sm">
        Não conseguimos calcular a projeção agora.
        <button onClick={() => q.refetch()} className="btn btn-outline h-10">
          Tentar de novo
        </button>
      </div>
    );

  const k = f.known;
  const committed = k.invoicesMinor + k.billsMinor + k.recurringMinor + k.installmentsMinor;
  const knownLines = [
    k.incomeMinor > 0 && `+ ${money(k.incomeMinor)} de entradas que se repetem todo mês`,
    k.invoicesMinor > 0 && `− ${money(k.invoicesMinor)} de faturas que vencem até o fim do mês`,
    k.billsMinor > 0 && `− ${money(k.billsMinor)} de boletos cadastrados`,
    k.recurringMinor > 0 && `− ${money(k.recurringMinor)} de contas fixas que ainda vão cair`,
    k.installmentsMinor > 0 && `− ${money(k.installmentsMinor)} de parcelas`,
  ].filter(Boolean) as string[];

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="card-title">Fim de {monthLower(f.month)}</span>
        {f.probPositive !== null && <ProbabilityBadge p={f.probPositive} label="de fechar no azul" />}
      </div>

      {f.status === 'ready' && f.range ? (
        <>
          <div className="text-[15px] leading-snug">
            {f.probPositive! >= 0.5 ? 'O mais provável é sobrar ' : 'O mais provável é faltar '}
            <strong className="tabular-nums">{money(Math.abs(f.range.p50))}</strong> no dia {new Date(Date.UTC(+f.month.slice(0, 4), +f.month.slice(5), 0)).getUTCDate()}
            {f.daysLeft ? `, com ${f.daysLeft} dias pela frente.` : '.'}
          </div>
          <RangeBar {...f.range} limit={f.range.p10 < 0 ? 0 : undefined} limitLabel="R$ 0" />
          {f.crossCheck.divergent && (
            <div className="text-xs text-muted-foreground">
              O ritmo deste mês está diferente do seu padrão. Os alertas usam a estimativa mais cuidadosa.
            </div>
          )}
        </>
      ) : f.status === 'learning' ? (
        <div className="text-sm text-muted-foreground">
          Precisamos de mais {f.needWeeks} semana{f.needWeeks > 1 ? 's' : ''} de histórico para prever o fim do mês com confiança.
          {committed > 0 && <> Até lá: já estão comprometidos <strong className="text-foreground">{money(committed)}</strong> até o fim do mês.</>}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          A previsão ainda não acerta mais do que “igual ao mês passado”, então fica desligada.
          {committed > 0 && <> Já estão comprometidos <strong className="text-foreground">{money(committed)}</strong> até o fim do mês.</>}
        </div>
      )}

      <Why>
        <div className="flex flex-col gap-1">
          <span>Saldo em conta hoje: {money(f.balanceMinor)}</span>
          {knownLines.map((l) => (
            <span key={l}>{l}</span>
          ))}
          <span>
            Gasto no débito e Pix este mês: {money(f.variable.spentMinor)}
            {f.variable.remaining && <>; até o fim, entre {money(f.variable.remaining.p10)} e {money(f.variable.remaining.p90)}</>}.
          </span>
          <span>
            Como calculamos: sorteamos 10.000 vezes semanas inteiras dos seus últimos 90 dias e vemos como o mês fecharia. Compras no cartão entram pela
            fatura.
          </span>
          {f.backtest.n > 0 && f.backtest.coverage !== null && (
            <span>
              Testado em {f.backtest.n} pontos dos meses anteriores: a faixa acertou {Math.round(f.backtest.coverage * 100)}% das vezes e errou em média{' '}
              {money(f.backtest.maeModelMinor ?? 0)}, contra {money(f.backtest.maeBaselineMinor ?? 0)} de “igual ao mês passado”.
            </span>
          )}
        </div>
      </Why>
    </div>
  );
}
