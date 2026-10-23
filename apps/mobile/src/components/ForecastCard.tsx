import { View } from 'react-native';
import { monthLower } from '@/lib/dates';
import { money } from '@/lib/format';
import { useForecast } from '@/lib/queries';
import { ProbabilityBadge, RangeBar, Why, WhyLine } from './charts';
import { T } from './T';
import { Btn, Card, CardTitle, Loading } from './ui';

/**
 * Saldo no fim do mes (como no site): primeiro a conclusao ("78% de chance de fechar no azul"),
 * depois a faixa, depois a conta no "por que".
 */
export function ForecastCard() {
  const q = useForecast();
  const f = q.data;
  if (q.isLoading)
    return (
      <Card>
        <Loading />
      </Card>
    );
  if (q.error || !f)
    return (
      <Card>
        <T size={14}>Não conseguimos calcular a projeção agora.</T>
        <Btn small kind="outline" label="Tentar de novo" onPress={() => void q.refetch()} />
      </Card>
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
  const lastDay = new Date(Date.UTC(+f.month.slice(0, 4), +f.month.slice(5), 0)).getUTCDate();

  return (
    <Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <CardTitle>Fim de {monthLower(f.month)}</CardTitle>
        {f.probPositive !== null && <ProbabilityBadge p={f.probPositive} label="de fechar no azul" />}
      </View>
      {f.status === 'ready' && f.range ? (
        <>
          <T size={15} style={{ lineHeight: 21 }}>
            {f.probPositive! >= 0.5 ? 'O mais provável é sobrar ' : 'O mais provável é faltar '}
            <T size={15} weight={700} tabular>
              {money(Math.abs(f.range.p50))}
            </T>{' '}
            no dia {lastDay}
            {f.daysLeft ? `, com ${f.daysLeft} dias pela frente.` : '.'}
          </T>
          <RangeBar {...f.range} limit={f.range.p10 < 0 ? 0 : undefined} limitLabel="R$ 0" />
          {f.crossCheck.divergent && (
            <T size={12} tone="muted">
              O ritmo deste mês está diferente do seu padrão. Os alertas usam a estimativa mais cuidadosa.
            </T>
          )}
        </>
      ) : (
        <T size={14} tone="muted" style={{ lineHeight: 20 }}>
          {f.status === 'learning'
            ? `Precisamos de mais ${f.needWeeks} semana${f.needWeeks > 1 ? 's' : ''} de histórico para prever o fim do mês com confiança.`
            : 'A previsão ainda não acerta mais do que “igual ao mês passado”, então fica desligada.'}
          {committed > 0 ? ` Já estão comprometidos ${money(committed)} até o fim do mês.` : ''}
        </T>
      )}
      <Why>
        <WhyLine>Saldo em conta hoje: {money(f.balanceMinor)}</WhyLine>
        {knownLines.map((l) => (
          <WhyLine key={l}>{l}</WhyLine>
        ))}
        <WhyLine>
          Gasto no débito e Pix este mês: {money(f.variable.spentMinor)}
          {f.variable.remaining ? `; até o fim, entre ${money(f.variable.remaining.p10)} e ${money(f.variable.remaining.p90)}` : ''}.
        </WhyLine>
        <WhyLine>Como calculamos: sorteamos 10.000 vezes semanas inteiras dos seus últimos 90 dias e vemos como o mês fecharia. Compras no cartão entram pela fatura.</WhyLine>
        {f.backtest.n > 0 && f.backtest.coverage !== null && (
          <WhyLine>
            Testado em {f.backtest.n} pontos dos meses anteriores: a faixa acertou {Math.round(f.backtest.coverage * 100)}% das vezes e errou em média {money(f.backtest.maeModelMinor ?? 0)}, contra{' '}
            {money(f.backtest.maeBaselineMinor ?? 0)} de “igual ao mês passado”.
          </WhyLine>
        )}
      </Why>
    </Card>
  );
}
