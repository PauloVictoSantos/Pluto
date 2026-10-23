import { DashboardSummarySchema, FinancialHealthSchema, MeSchema, SpendingLimitSchema } from '@pluto/shared';
import { View } from 'react-native';
import { api } from '@/api';
import { T } from '@/components/T';
import { Big, Card, CardTitle, ErrorBox, Loading, Muted, Notice, Progress, Row, Screen } from '@/components/ui';
import { money, pct } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useApiQuery } from '@/lib/use-api';

// Visao geral (provisoria): saldo, limite do mes e saude financeira. A versao completa do site (7
// blocos, velocimetro, analises) chega na etapa B. Tudo calculado pela API.
const load = async () => {
  const [me, summary, limit, health] = await Promise.all([
    api.request('/me', {}, MeSchema),
    api.request('/dashboard/summary', {}, DashboardSummarySchema),
    api.request('/agent/limit', {}, SpendingLimitSchema),
    api.request('/analytics/health', {}, FinancialHealthSchema),
  ]);
  return { me, summary, limit, health };
};
const LIMIT_TONE = { ok: '#7D39EB', atencao: '#F59E0B', estourado: '#EF4444', 'sem-renda': '#A1A1AA' } as const;

export default function Overview() {
  const t = useTheme();
  const q = useApiQuery(['overview-lite'], load);
  const d = q.data;
  return (
    <Screen refreshing={q.refreshing} onRefresh={() => void q.refresh()}>
      {q.error && <ErrorBox message={q.error} />}
      {q.isLoading && <Loading />}
      {d && (
        <>
          <T size={26} weight={700} accessibilityRole="header">
            Olá, {d.me.name.split(' ')[0]}
          </T>

          <Card hero style={{ backgroundColor: t.brand, borderColor: t.brand }}>
            <T size={15} weight={500} color="#FFFFFF">
              Saldo nas contas
            </T>
            <T size={34} weight={700} color="#FFFFFF" tabular>
              {money(d.summary.balanceMinor)}
            </T>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 10, gap: 2 }}>
                <T size={12} color="rgba(255,255,255,0.85)">
                  Entradas do mês
                </T>
                <T size={15} weight={700} color="#FFFFFF" tabular>
                  {money(d.summary.current.incomeMinor)}
                </T>
              </View>
              <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 10, gap: 2 }}>
                <T size={12} color="rgba(255,255,255,0.85)">
                  Saídas do mês
                </T>
                <T size={15} weight={700} color="#FFFFFF" tabular>
                  {money(d.summary.current.expensesMinor)}
                </T>
              </View>
            </View>
          </Card>

          <Card hero>
            <CardTitle>Limite de gasto do mês</CardTitle>
            {d.limit.status === 'sem-renda' ? (
              <Muted>Informe sua renda em Ajustes › Perfil financeiro para o Plutão calcular seu limite.</Muted>
            ) : (
              <>
                <Big color={d.limit.remainingMinor < 0 ? t.dangerText : undefined}>{money(Math.abs(d.limit.remainingMinor))}</Big>
                <Muted>{d.limit.remainingMinor < 0 ? 'acima do limite' : `disponíveis · ${money(d.limit.spentMinor)} de ${money(d.limit.limitMinor)} usados`}</Muted>
                <Progress value={d.limit.usedPct} color={LIMIT_TONE[d.limit.status]} />
                {d.limit.remainingMinor > 0 && (
                  <T size={14}>
                    Até o fim do mês: <T weight={700}>{money(d.limit.weekMinor)}</T> por semana · <T weight={700}>{money(d.limit.dayMinor)}</T> por dia
                  </T>
                )}
                {d.limit.status === 'estourado' && <ErrorBox message="O limite acabou. Daqui em diante, cada gasto sai das metas ou da margem de segurança." />}
              </>
            )}
          </Card>

          <Card hero>
            <CardTitle>Saúde financeira</CardTitle>
            {d.health.score === null ? (
              <Muted>Sem nota ainda: o Plutão precisa saber sua renda.</Muted>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Big>{d.health.score}</Big>
                  <Muted>de 100 · {d.health.band?.label}</Muted>
                </View>
                <Progress value={d.health.score / 100} color={d.health.score < 40 ? '#EF4444' : d.health.score < 60 ? '#F59E0B' : '#7DBF00'} />
                {d.health.containment && <Notice>Modo de contenção: com a nota abaixo de 40, o Plutão só aprova gastos essenciais.</Notice>}
              </>
            )}
            {d.health.indicators.map((i) => (
              <Row
                key={i.key}
                label={`${i.healthy === false ? '⚠︎ ' : ''}${i.label}`}
                value={i.value === null ? '—' : i.unit === 'pct' ? pct(i.value) : i.unit === 'months' ? `${i.value.toFixed(1).replace('.', ',')} meses` : money(i.value)}
              />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
