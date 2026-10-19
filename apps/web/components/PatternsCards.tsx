'use client';

import { categoryOf, type Patterns } from '@pluto/shared';
import { MESES_LONGOS } from '@/lib/format';
import { money } from '@/lib/queries';
import { useApp } from '@/lib/store';
import { Why } from './Insight';
import { Icon } from './ui/Icon';

// Cartoes de padroes de gasto (aba Relatorios). Todo grafico tem frase-conclusao acima e tabela
// equivalente para leitor de tela (doc. "Visualizacao de dados", WCAG 1.1.1).

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const BANDS = ['0h', '4h', '8h', '12h', '16h', '20h'];
const monthName = (ym: string) => MESES_LONGOS[+ym.slice(5) - 1]!.toLowerCase();

/** Mapa dia x faixa horaria em uma cor, do claro ao escuro; so as celulas significativas tem rotulo. */
export function HeatmapCard({ p }: { p: Patterns }) {
  const hidden = useApp((s) => s.hideValues);
  const max = Math.max(1, ...p.cells.map((c) => c.expectedMinor));
  const cell = (dow: number, band: number) => p.cells.find((c) => c.dow === dow && c.band === band)!;
  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-labelledby="heat-title">
      <div>
        <div id="heat-title" className="card-title">
          Quando você gasta
        </div>
        <div className="mt-1 text-sm">
          {p.status === 'learning'
            ? `Precisamos de mais ${p.needWeeks} semana${p.needWeeks > 1 ? 's' : ''} para mostrar seus horários de gasto.`
            : (p.conclusion ?? 'Nenhum dia e horário se destaca de verdade: seus gastos estão espalhados pela semana.')}
        </div>
      </div>
      {p.status === 'ready' && (
        <>
          <div className="grid gap-1" style={{ gridTemplateColumns: '36px repeat(6, minmax(0, 1fr))' }} aria-hidden>
            <span />
            {BANDS.map((b) => (
              <span key={b} className="text-center text-[11px] text-muted-foreground">
                {b}
              </span>
            ))}
            {DAYS.map((d, dow) => (
              <div key={d} className="contents">
                <span className="self-center text-xs text-muted-foreground">{d}</span>
                {BANDS.map((_, band) => {
                  const c = cell(dow, band);
                  return (
                    <span
                      key={band}
                      className="grid h-8 place-items-center rounded-md text-[11px] font-semibold"
                      style={{
                        background: c.count ? `color-mix(in srgb, var(--brand) ${Math.round(12 + (c.expectedMinor / max) * 88)}%, transparent)` : 'var(--muted)',
                        color: c.expectedMinor / max > 0.55 ? '#fff' : 'var(--foreground)',
                        outline: c.peak ? '2px solid var(--foreground)' : undefined,
                      }}
                    >
                      {c.peak ? `${String(c.ratePerWeek).replace('.', ',')}x` : ''}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Mais escuro = mais gasto esperado por semana. Com borda: pico real (compras por semana).</span>
          </div>
          <table className="sr-only">
            <caption>Gasto por dia da semana e faixa horária, últimas {p.weeks} semanas</caption>
            <thead>
              <tr>
                <th>Dia</th>
                {BANDS.map((b, i) => (
                  <th key={b}>
                    {b} a {i < 5 ? BANDS[i + 1] : '24h'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS_LONG.map((d, dow) => (
                <tr key={d}>
                  <th>{d}</th>
                  {BANDS.map((b, band) => {
                    const c = cell(dow, band);
                    return (
                      <td key={b}>
                        {c.count} compras{hidden ? '' : `, ${money(c.expectedMinor)} por semana`}
                        {c.peak ? ', pico' : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <Why>
            Cada quadrado é um dia da semana numa faixa de 4 horas, nas últimas {p.weeks} semanas. Gasto esperado = compras por semana × valor típico (mediana).
            Só chamamos de pico quando o número de compras é alto demais para ser acaso (teste de Poisson, p &lt; 0,05, corrigido para as 42 células).
            {p.untimedShare > 0 && ` ${Math.round(p.untimedShare * 100)}% das compras vieram sem horário real do banco e ficaram fora do mapa.`}
          </Why>
        </>
      )}
    </section>
  );
}

/** Participacao por categoria em barras horizontais ordenadas: ate 5 + "outras" em cinza. */
export function CategoryBarsCard({ p }: { p: Patterns }) {
  if (!p.categories.length) return null;
  const top = p.categories[0]!;
  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-labelledby="bars-title">
      <div>
        <div id="bars-title" className="card-title">
          Para onde foi o dinheiro
        </div>
        <div className="mt-1 text-sm">
          {top.categoryKey === 'outras' ? 'Seus gastos estão bem divididos.' : `${categoryOf(top.categoryKey).label} levou ${Math.round(top.share * 100)}% dos gastos nas últimas ${p.weeks} semanas.`}
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {p.categories.map((c) => {
          const def = c.categoryKey === 'outras' ? null : categoryOf(c.categoryKey);
          return (
            <li key={c.categoryKey} className="flex flex-col gap-1">
              <div className="flex justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon icon={def?.icon ?? 'layout-grid'} size={14} />
                  {def?.label ?? 'Outras'}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round(c.share * 100)}% · {money(c.totalMinor)}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  data-grow=""
                  className="h-full origin-left rounded-full"
                  style={{ width: `${Math.max(2, c.share * 100)}%`, background: def?.color ?? '#A1A1AA' }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Mudancas de habito (CUSUM), explicacao da variacao e proximo mes por categoria (Holt). */
export function HabitsCard({ p }: { p: Patterns }) {
  const v = p.variation;
  const trend = p.trend.filter((t) => t.nextMonthMinor !== null);
  if (!p.shifts.length && !v && !trend.length) return null;
  return (
    <section data-anim="" className="card flex flex-col gap-3" aria-label="Como seus hábitos mudaram">
      <div className="card-title">Como seus hábitos mudaram</div>

      {v && (
        <div className="text-sm leading-snug">
          {v.totalDeltaMinor === 0 ? (
            `Você gastou o mesmo em ${monthName(v.month)} e ${monthName(v.prevMonth)}.`
          ) : (
            <>
              Em {monthName(v.month)} você gastou{' '}
              <strong>
                {v.totalDeltaMinor > 0 ? '↑ ' : '↓ '}
                {money(Math.abs(v.totalDeltaMinor))} {v.totalDeltaMinor > 0 ? 'a mais' : 'a menos'}
              </strong>{' '}
              que em {monthName(v.prevMonth)}
              {v.drivers.length > 0 && (
                <>
                  , principalmente em{' '}
                  {v.drivers.map((d, i) => (
                    <span key={d.categoryKey}>
                      {i > 0 && (i === v.drivers.length - 1 ? ' e ' : ', ')}
                      {categoryOf(d.categoryKey).label.toLowerCase()} ({d.deltaMinor > 0 ? '+' : '−'}
                      {money(Math.abs(d.deltaMinor))})
                    </span>
                  ))}
                </>
              )}
              .
            </>
          )}
        </div>
      )}

      {p.shifts.map((s) => {
        const up = s.baselineWeeklyMinor > 0 ? Math.round((s.recentWeeklyMinor / s.baselineWeeklyMinor - 1) * 100) : null;
        return (
          <div key={s.categoryKey} className="flex items-start gap-3 border-t border-border pt-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
              <Icon icon={categoryOf(s.categoryKey).icon} size={16} />
            </span>
            <div className="min-w-0 flex-1 text-sm leading-snug">
              <b>{categoryOf(s.categoryKey).label}</b> subiu de patamar{' '}
              {s.weeksAgo === 0 ? 'esta semana' : `há ${s.weeksAgo} semana${s.weeksAgo > 1 ? 's' : ''}`}: de {money(s.baselineWeeklyMinor)} para{' '}
              {money(s.recentWeeklyMinor)} por semana{up !== null ? ` (↑ ${up}%)` : ''}.
            </div>
          </div>
        );
      })}

      {trend.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <div className="text-[13px] font-semibold">Próximo mês, se o ritmo continuar</div>
          {trend.map((t) => (
            <div key={t.categoryKey} className="flex justify-between gap-2 text-sm">
              <span>{categoryOf(t.categoryKey).label}</span>
              <span className="text-muted-foreground tabular-nums">
                {money(t.lastMonthMinor)} → <strong className="text-foreground">{money(t.nextMonthMinor!)}</strong>
              </span>
            </div>
          ))}
        </div>
      )}

      <Why>
        <div className="flex flex-col gap-1">
          <span>
            Mudança de patamar: comparamos cada semana com o seu normal (mediana) e só avisamos quando o excesso acumulado passa de 5 desvios. Uma semana
            cara isolada não dispara.
          </span>
          <span>
            Próximo mês: suavização exponencial (nível + tendência) dos totais mensais. Só aparece para as categorias em que ela erra menos do que “igual ao mês
            passado”.
          </span>
          {p.seasonalityNeedMonths > 0 && <span>Diferenças por época do ano só aparecem com 24 meses de histórico (faltam {p.seasonalityNeedMonths}).</span>}
        </div>
      </Why>
    </section>
  );
}

/** Estado da categorizacao aprendida (RN-I04: desligada enquanto nao acerta o bastante). */
export function CategorizerNote({ p }: { p: Patterns }) {
  const c = p.categorizer;
  return (
    <div data-anim="" className="card flex items-start gap-3 text-sm leading-snug">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text">
        <Icon icon="sparkles" size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Categorização aprendida {c.enabled ? 'ligada' : 'em treino'}</div>
        <div className="mt-0.5 text-muted-foreground">
          {c.enabled
            ? `Aprendeu com ${c.examples} correções suas e acerta ${Math.round((c.f1 ?? 0) * 100)}% nas que separamos para teste. Aplicou ${c.applied} e sugere ${c.suggested} para você confirmar.`
            : c.examples < 20
              ? `Corrija a categoria de mais ${20 - c.examples} transações para a Pluto começar a aprender.`
              : `Com ${c.examples} correções, ainda acerta ${Math.round((c.f1 ?? 0) * 100)}% (precisa de 85% para ligar).`}
        </div>
      </div>
    </div>
  );
}
