import { GoalSchema, GoalsPlanSchema, type Goal } from '@pluto/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { z } from 'zod';
import { ApiError, api } from '@/api';
import { Icon } from '@/components/Icon';
import { T } from '@/components/T';
import { Btn, Card, CardTitle, Empty, ErrorBox, Loading, Muted, PageHeader, Progress, Row, Screen } from '@/components/ui';
import { MESES, money } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useApiQuery } from '@/lib/use-api';

// Metas (como /metas no site): a primeira em destaque roxo, progresso, situacao no plano e
// pausar/retomar. Meta nova passa pela entrevista: no app, pelo Plutao (etapa D traz a entrevista).
const loadGoals = () => api.request('/goals', {}, z.array(GoalSchema));
const loadPlan = () => api.request('/agent/goals/plan', {}, GoalsPlanSchema);
const PRIORITIES = ['Máxima', 'Alta', 'Média', 'Baixa', 'Quando der'];
const STATUS: Record<Goal['status'], string> = { ativa: 'Ativa', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' };

export default function Metas() {
  const t = useTheme();
  const qc = useQueryClient();
  const goals = useApiQuery(['goals'], loadGoals);
  const plan = useApiQuery(['goals-plan'], loadPlan);
  const [error, setError] = useState('');
  const list = (goals.data ?? []).filter((g) => g.status !== 'cancelada');
  const total = list.reduce((s, g) => s + g.savedMinor, 0);
  const status = useMutation({
    mutationFn: ({ g, to }: { g: Goal; to: 'ativa' | 'pausada' | 'concluida' }) => api.request(`/agent/goals/${g.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: to }) }, GoalsPlanSchema),
    onSuccess: (p) => {
      setError('');
      qc.setQueryData(['goals-plan'], p);
      for (const k of ['goals', 'agent-limit', 'overview-lite']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível alterar a meta.'),
  });
  const refresh = () => void Promise.all([goals.refresh(), plan.refresh()]);

  return (
    <Screen refreshing={goals.refreshing} onRefresh={refresh}>
      <PageHeader title="Metas" subtitle={goals.isLoading ? 'Carregando…' : `${list.length} meta${list.length === 1 ? '' : 's'} · ${money(total)} guardados`} />
      {(goals.error || error) && <ErrorBox message={goals.error ?? error} />}
      {goals.isLoading && <Loading />}
      {goals.data && !list.length && (
        <Empty title="Nenhuma meta ainda" text="Uma reserva de emergência, um computador, uma viagem… Peça ao Plutão: ele faz as perguntas, calcula se cabe no seu mês e propõe o plano." />
      )}

      {list.map((g, i) => {
        const r = Math.min(g.savedMinor / g.targetMinor, 1);
        const done = r >= 1;
        const paused = g.status === 'pausada';
        const feat = i === 0 && g.status === 'ativa';
        const fg = feat ? '#FFFFFF' : t.foreground;
        const sub = feat ? 'rgba(255,255,255,0.85)' : t.mutedForeground;
        const p = plan.data?.goals.find((x) => x.goalId === g.id);
        return (
          <Card key={g.id} style={{ gap: 14, padding: 20, backgroundColor: feat ? '#7D39EB' : t.card, borderColor: feat ? '#7D39EB' : t.border, opacity: paused ? 0.7 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: feat ? 'rgba(255,255,255,0.16)' : t.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon icon={g.icon} size={20} color={fg} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T size={16} weight={600} color={fg} numberOfLines={1}>
                  {g.name}
                </T>
                <T size={12} color={sub}>
                  até {MESES[+g.deadline.slice(5, 7) - 1]} {g.deadline.slice(0, 4)} ·{' '}
                  {g.score !== null ? `prioridade ${Math.round(g.score * 100)}/100` : `prioridade ${PRIORITIES[g.priority - 1]!.toLowerCase()}`}
                  {g.status !== 'ativa' ? ` · ${STATUS[g.status].toLowerCase()}` : ''}
                </T>
              </View>
            </View>
            <View>
              <T size={28} weight={700} color={fg} tabular>
                {money(g.savedMinor)}
              </T>
              <T size={13} color={sub}>
                de {money(g.targetMinor)} · {(r * 100).toFixed(0)}%
              </T>
            </View>
            <View style={{ height: 10, borderRadius: 99, overflow: 'hidden', backgroundColor: feat ? 'rgba(255,255,255,0.2)' : t.muted }}>
              <View style={{ width: `${r * 100}%`, height: '100%', borderRadius: 99, backgroundColor: feat || done ? '#C6FF33' : '#7D39EB' }} />
            </View>
            <T size={13} color={p?.waiting && !paused && !done ? (feat ? '#FFFFFF' : t.dangerText) : sub}>
              {paused ? 'Pausada: não recebe aporte nem entra no limite do mês.' : done ? 'Meta concluída. Parabéns!' : (p?.note ?? (g.monthlyContributionMinor ? `Plano: ${money(g.monthlyContributionMinor)}/mês` : ''))}
            </T>
            {done && g.status !== 'concluida' ? (
              <Btn kind={feat ? 'accent' : 'outline'} label="Concluir meta" onPress={() => status.mutate({ g, to: 'concluida' })} busy={status.isPending} />
            ) : !done ? (
              <Btn kind={paused ? 'primary' : feat ? 'accent' : 'outline'} label={paused ? 'Retomar' : 'Pausar'} onPress={() => status.mutate({ g, to: paused ? 'ativa' : 'pausada' })} busy={status.isPending} />
            ) : null}
          </Card>
        );
      })}

      {plan.data && plan.data.goals.length > 0 && (
        <Card>
          <CardTitle>Plano das metas</CardTitle>
          <Muted>Sua sobra no mês é {money(plan.data.capacityMinor)}. Ela vai primeiro para as metas de maior prioridade; a soma dos aportes nunca passa dela.</Muted>
          <Progress value={plan.data.capacityMinor > 0 ? plan.data.allocatedMinor / plan.data.capacityMinor : 0} />
          <Row label="Em metas" value={money(plan.data.allocatedMinor)} />
          <Row label="Livre" value={money(plan.data.freeMinor)} strong />
        </Card>
      )}
      {plan.error && <Muted>{plan.error}</Muted>}
    </Screen>
  );
}
