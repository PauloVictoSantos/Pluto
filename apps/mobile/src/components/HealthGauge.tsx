import type { HealthIndicatorDTO } from '@pluto/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { money } from '@/lib/format';
import { useHealth } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { T } from './T';
import { Btn } from './ui';

// Saude financeira 0-100 (doc. Pluton 5.2) no desenho do site: arco em 4 faixas com espacos, marcador,
// nota grande, pilula de variacao, botao preto e os cards dos indicadores.

const MIN = 0, MAX = 100;
const VB_W = 400, VB_H = 236, CX = 200, CY = 206, R = 150;
const STROKE = Math.round(R * 0.14);
const SEGMENTS = [
  { from: 0, to: 40, label: 'Contenção', paint: 'url(#hgwarm)' },
  { from: 40, to: 60, label: 'Atenção', paint: '#F6D23E' },
  { from: 60, to: 80, label: 'Boa', paint: '#C6F432' },
  { from: 80, to: 100, label: 'Excelente', paint: '#6FD94A' },
] as const;
const TICKS = [0, 40, 60, 80, 100];
const tOf = (v: number) => (Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN);
const pt = (t: number, r = R): [number, number] => [CX + r * Math.cos(Math.PI * (1 - t)), CY - r * Math.sin(Math.PI * (1 - t))];
const GAP_T = (STROKE + 7) / R / Math.PI;
const arc = (t0: number, t1: number) => {
  const [x0, y0] = pt(t0), [x1, y1] = pt(t1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
};
const segT = (i: number) => {
  const s = SEGMENTS[i]!;
  return [tOf(s.from) + (i > 0 ? GAP_T / 2 : 0), tOf(s.to) - (i < SEGMENTS.length - 1 ? GAP_T / 2 : 0)] as const;
};
const valueText = (i: HealthIndicatorDTO) =>
  i.value === null ? '—' : i.unit === 'pct' ? `${Math.round(i.value * 100)}%` : i.unit === 'months' ? `${i.value.toFixed(1).replace('.', ',')} m` : money(i.value);
const TONE: Record<string, { bg: string; fg: string }> = { high: { bg: '#C6F432', fg: '#111' }, mid: { bg: '#DDF59A', fg: '#111' }, low: { bg: '#F97316', fg: '#fff' } };
/** Mola leve: passa um pouco do alvo e volta. */
const spring = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

export function HealthGauge({ firstName }: { firstName: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const q = useHealth();
  const h = q.data;
  const [shown, setShown] = useState(MIN);
  const [open, setOpen] = useState<string | null>(null);
  const from = useRef(MIN);

  // Marcador e numero sobem juntos ate a nota (entrada e recalculo).
  useEffect(() => {
    if (!h || h.score === null) return;
    const target = h.score, start = from.current;
    let raf = 0;
    const t0 = Date.now();
    const step = () => {
      const x = Math.min(1, (Date.now() - t0) / 900);
      setShown(Math.round(start + (target - start) * spring(x)));
      if (x < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [h]);

  const delta = h && h.score !== null && h.prevScore !== null ? h.score - h.prevScore : null;
  const [mx, my] = pt(tOf(h?.score === null || !h ? MIN : shown));
  const cards = h
    ? [
        ...h.indicators.map((i) => ({
          title: i.label,
          value: valueText(i),
          impact: i.healthy === null ? 'Sem dado' : i.healthy ? 'Saudável' : 'Fora da faixa',
          tone: i.healthy === null ? 'mid' : i.healthy ? 'high' : 'low',
          desc: `${i.desc}. Ideal: ${i.target}.`,
          why: `${i.why} Pesa ${Math.round(i.weight * 100)}% da nota${i.points !== null ? `; este indicador está com ${i.points} de 100` : ''}.`,
        })),
        { title: 'Pagamentos em dia', value: h.onTime.pct === null ? '—' : `${Math.round(h.onTime.pct * 100)}%`, impact: 'Sinal extra', tone: 'mid', desc: `${h.onTime.paid} de ${h.onTime.due} contas pagas em dia nos últimos 90 dias`, why: 'Faturas e boletos que venceram e foram pagos até o vencimento. Não entra na nota, mas atraso gera juros que pioram os indicadores.' },
        { title: 'Uso do limite do cartão', value: h.limitUse.pct === null ? '—' : `${Math.round(h.limitUse.pct * 100)}%`, impact: 'Sinal extra', tone: 'mid', desc: `${money(h.limitUse.usedMinor)} de ${money(h.limitUse.limitMinor)} de limite`, why: 'Quanto do limite dos cartões está em uso hoje. Não entra na nota; perto de 100% é sinal de aperto.' },
      ]
    : [];

  return (
    <View style={{ borderRadius: 28, overflow: 'hidden', padding: 18, gap: 16 }}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="healthbg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.healthFrom} />
            <Stop offset="0.48" stopColor={t.dark ? t.card : '#FFFFFF'} />
            <Stop offset="1" stopColor={t.healthTo} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#healthbg)" />
      </Svg>

      <View style={{ alignItems: 'center', gap: 8 }}>
        <T size={21} weight={600} style={{ textAlign: 'center' }} accessibilityRole="header">
          Olá, {firstName}, esta é a sua saúde financeira 🙂
        </T>
        <T size={13} tone="muted" style={{ textAlign: 'center', maxWidth: 420 }}>
          Nota de 0 a 100 com 5 indicadores: quanto da renda vai para fixos e dívidas, reserva, poupança e o que sobra no mês.
        </T>
      </View>

      <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', aspectRatio: VB_W / VB_H }}>
        <Svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" accessibilityLabel={h && h.score !== null && h.band ? `Saúde financeira: ${h.score} de 100, ${h.band.label.toLowerCase()}` : 'Saúde financeira'}>
          <Defs>
            <LinearGradient id="hgwarm" gradientUnits="userSpaceOnUse" x1={pt(0)[0] - STROKE} y1="0" x2={pt(tOf(40))[0]} y2="0">
              <Stop offset="0" stopColor="#F2626B" />
              <Stop offset="0.55" stopColor="#F79A3B" />
              <Stop offset="1" stopColor="#F6D23E" />
            </LinearGradient>
          </Defs>
          {SEGMENTS.map((s, i) => {
            const [a, b] = segT(i);
            return <Path key={s.from} d={arc(a, b)} fill="none" stroke={s.paint} strokeWidth={STROKE} strokeLinecap="round" />;
          })}
          {TICKS.map((v) => {
            const tt = tOf(v), [x, y] = pt(tt, R + STROKE + 14);
            return (
              <SvgText key={v} x={x} y={tt === 0 || tt === 1 ? y + 16 : y} textAnchor="middle" fontSize={12} fill={t.mutedForeground}>
                {v}
              </SvgText>
            );
          })}
          {h && h.score !== null && (
            <>
              <Circle cx={mx} cy={my} r={STROKE * 0.55} fill="#FFFFFF" stroke="#111111" strokeWidth={2.5} />
            </>
          )}
        </Svg>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: '34%', bottom: 0, alignItems: 'center', gap: 4 }}>
          {delta !== null ? (
            <View style={{ borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: delta >= 0 ? '#C6F432' : t.dangerSoft }}>
              <T size={13} weight={600} color={delta >= 0 ? '#111111' : t.dangerText}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} pts
              </T>
            </View>
          ) : (
            <View style={{ height: 26 }} />
          )}
          <T size={60} weight={500} tabular style={{ lineHeight: 64 }}>
            {h && h.score !== null ? shown : '—'}
          </T>
          <T size={13} tone="muted">
            {h ? (h.band?.label ?? 'Sem nota ainda') : 'Calculando…'}
          </T>
        </View>
      </View>

      <View style={{ alignItems: 'center' }}>
        <Btn label={q.isFetching ? 'Recalculando…' : 'Recalcular'} onPress={() => void qc.invalidateQueries({ queryKey: ['analytics', 'health'] })} disabled={q.isFetching} />
      </View>
      {q.error && (
        <T tone="danger" style={{ textAlign: 'center' }}>
          Não conseguimos calcular agora. Tente de novo.
        </T>
      )}
      {h && !h.incomeKnown && (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <T size={13} tone="muted" style={{ textAlign: 'center' }}>
            Para calcular a nota, o Plutão precisa saber sua renda líquida.
          </T>
          <Btn small label="Informar renda" onPress={() => router.navigate('/configuracoes')} />
        </View>
      )}
      {h?.containment && (
        <View style={{ flexDirection: 'row', gap: 8, borderRadius: 16, backgroundColor: t.dangerSoft, padding: 14 }}>
          <Icon icon="circle-alert" size={16} color={t.dangerText} />
          <T size={13} color={t.dangerText} style={{ flex: 1 }}>
            <T size={13} weight={700} color={t.dangerText}>
              Modo de contenção.
            </T>{' '}
            Com a nota abaixo de 40, o Plutão só aprova gastos essenciais até os indicadores melhorarem. Comece pelo que está fora da faixa nos cards abaixo.
          </T>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }} style={{ marginHorizontal: -2 }}>
        {cards.map((c) => (
          <Pressable
            key={c.title}
            accessibilityRole="button"
            accessibilityState={{ expanded: open === c.title }}
            accessibilityLabel={`${c.title}: ${c.value}. ${c.impact}. ${c.desc}`}
            onPress={() => setOpen(open === c.title ? null : c.title)}
            style={{ width: 230, borderRadius: 28, padding: 18, gap: 12, backgroundColor: t.healthCard, borderWidth: 1, borderColor: t.border }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <T size={15} weight={600} style={{ flex: 1 }}>
                {c.title}
              </T>
              <View style={{ width: 34, height: 34, borderRadius: 99, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}>
                <Icon icon={open === c.title ? 'chevron-up' : 'arrow-up-right'} size={15} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <T size={28} weight={500} tabular numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>
                {c.value}
              </T>
              <View style={{ borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: TONE[c.tone]!.bg }}>
                <T size={11} weight={600} color={TONE[c.tone]!.fg}>
                  {c.impact}
                </T>
              </View>
            </View>
            <T size={13} tone="muted" style={{ lineHeight: 18 }}>
              {c.desc}
            </T>
            {open === c.title && (
              <T size={13} style={{ lineHeight: 18, borderTopWidth: 1, borderTopColor: t.border, paddingTop: 8 }}>
                {c.why}
              </T>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
