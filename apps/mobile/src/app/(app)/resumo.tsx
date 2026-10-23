import { DashboardSummarySchema, FinancialHealthSchema, MeSchema, SpendingLimitSchema } from '@pluto/shared';
import { Text, View } from 'react-native';
import { api } from '@/api';
import { useSession } from '@/auth/session';
import { Big, Button, Card, CardTitle, ErrorBox, Loading, Muted, Notice, Progress, Row, Screen } from '@/components/ui';
import { brl, pct } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useApi } from '@/lib/use-api';

// Resumo do mes: saldo, limite de gasto do Plutao e saude financeira. Tudo calculado pela API;
// o app so mostra (guia mobile, secao 1).
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

export default function Resumo() {
  const t = useTheme();
  const { signOut } = useSession();
  const q = useApi(load);
  const d = q.data;

  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      {q.error && <ErrorBox message={q.error} />}
      {q.loading && <Loading />}
      {d && (
        <>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>Olá, {d.me.name.split(' ')[0]}!</Text>

          <Card>
            <Muted>Saldo nas contas</Muted>
            <Big>{brl(d.summary.balanceMinor)}</Big>
            <Row label="Entradas do mês" value={brl(d.summary.current.incomeMinor)} />
            <Row label="Saídas do mês" value={brl(d.summary.current.expensesMinor)} />
          </Card>

          <Card>
            <CardTitle>Limite de gasto do mês</CardTitle>
            {d.limit.status === 'sem-renda' ? (
              <Muted>Informe sua renda em Configurações › Perfil financeiro (no site) para o Plutão calcular seu limite.</Muted>
            ) : (
              <>
                <Big color={d.limit.remainingMinor < 0 ? t.danger : undefined}>{brl(Math.abs(d.limit.remainingMinor))}</Big>
                <Muted>{d.limit.remainingMinor < 0 ? 'acima do limite' : `disponíveis · ${brl(d.limit.spentMinor)} de ${brl(d.limit.limitMinor)} usados`}</Muted>
                <Progress value={d.limit.usedPct} color={LIMIT_TONE[d.limit.status]} />
                {d.limit.remainingMinor > 0 && (
                  <Text style={{ color: t.text, fontSize: 14 }}>
                    Até o fim do mês: <Text style={{ fontWeight: '700' }}>{brl(d.limit.weekMinor)}</Text> por semana ·{' '}
                    <Text style={{ fontWeight: '700' }}>{brl(d.limit.dayMinor)}</Text> por dia
                  </Text>
                )}
                {d.limit.plannedMinor > 0 && <Muted>{brl(d.limit.plannedMinor)} reservados para compras planejadas.</Muted>}
                {d.limit.status === 'estourado' && <ErrorBox message="O limite acabou. Daqui em diante, cada gasto sai das metas ou da margem de segurança." />}
              </>
            )}
          </Card>

          <Card>
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
                value={i.value === null ? '—' : i.unit === 'pct' ? pct(i.value) : i.unit === 'months' ? `${i.value.toFixed(1).replace('.', ',')} meses` : brl(i.value)}
              />
            ))}
          </Card>

          <Button label="Sair da conta" kind="outline" onPress={() => void signOut()} />
        </>
      )}
    </Screen>
  );
}
