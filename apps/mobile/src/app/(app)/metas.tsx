import { GoalSchema, GoalsPlanSchema, type Goal } from '@pluto/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { z } from 'zod';
import { ApiError, api } from '@/api';
import { Button, Card, CardTitle, ErrorBox, Loading, Muted, Progress, Row, Screen } from '@/components/ui';
import { brl } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useApi } from '@/lib/use-api';

// Metas e o plano da sobra por prioridade (MT-04). Meta nova passa pela entrevista: no app, pelo
// Plutao (a mesma entrevista do site).
const load = async () => {
  const [goals, plan] = await Promise.all([api.request('/goals', {}, z.array(GoalSchema)), api.request('/agent/goals/plan', {}, GoalsPlanSchema)]);
  return { goals: goals.filter((g) => g.status !== 'cancelada'), plan };
};
const STATUS: Record<Goal['status'], string> = { ativa: 'Ativa', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' };
const date = (d: string) => d.split('-').reverse().join('/');

export default function Metas() {
  const t = useTheme();
  const q = useApi(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const d = q.data;

  const setStatus = async (g: Goal, status: 'ativa' | 'pausada' | 'concluida') => {
    setBusy(g.id);
    setError('');
    try {
      await api.request(`/agent/goals/${g.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, GoalsPlanSchema);
      await q.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível alterar a meta.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen refreshing={q.refreshing} onRefresh={q.refresh}>
      {(q.error || error) && <ErrorBox message={q.error ?? error} />}
      {q.loading && <Loading />}
      {d && (
        <>
          <Card>
            <CardTitle>Plano das metas</CardTitle>
            <Muted>Sua sobra no mês vai primeiro para as metas de maior prioridade. A soma dos aportes nunca passa dela.</Muted>
            <Progress value={d.plan.capacityMinor > 0 ? d.plan.allocatedMinor / d.plan.capacityMinor : 0} />
            <Row label="Sobra no mês" value={brl(d.plan.capacityMinor)} />
            <Row label="Em metas" value={brl(d.plan.allocatedMinor)} />
            <Row label="Livre" value={brl(d.plan.freeMinor)} strong />
          </Card>

          <Button label="Criar meta com o Plutão" onPress={() => router.push('/chat')} />

          {!d.goals.length && <Muted style={{ textAlign: 'center' }}>Nenhuma meta ainda. Uma reserva de emergência, um computador, uma viagem…</Muted>}

          {d.goals.map((g) => {
            const done = g.savedMinor >= g.targetMinor;
            const paused = g.status === 'pausada';
            const p = d.plan.goals.find((x) => x.goalId === g.id);
            return (
              <Card key={g.id} style={paused ? { opacity: 0.7 } : undefined}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', flexShrink: 1 }}>{g.name}</Text>
                  <Muted>{STATUS[g.status]}</Muted>
                </View>
                <Text style={{ color: t.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{brl(g.savedMinor)}</Text>
                <Muted>
                  de {brl(g.targetMinor)} até {date(g.deadline)}
                  {g.score !== null ? ` · prioridade ${Math.round(g.score * 100)}/100` : ''}
                </Muted>
                <Progress value={g.savedMinor / g.targetMinor} color={done ? '#7DBF00' : undefined} />
                {p && !done && <Muted style={{ color: p.waiting && !paused ? t.danger : t.muted }}>{p.note}</Muted>}
                {g.monthlyContributionMinor > 0 && !done && <Row label="Aporte planejado" value={`${brl(g.monthlyContributionMinor)}/mês`} />}
                {done && g.status !== 'concluida' ? (
                  <Button label="Concluir meta" kind="outline" onPress={() => void setStatus(g, 'concluida')} busy={busy === g.id} />
                ) : (
                  !done && <Button label={paused ? 'Retomar' : 'Pausar'} kind={paused ? 'primary' : 'outline'} onPress={() => void setStatus(g, paused ? 'ativa' : 'pausada')} busy={busy === g.id} />
                )}
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}
