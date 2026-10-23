import { categoryOf, type Spending } from '@pluto/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { change, monthLong, monthLower, monthShort } from '@/lib/dates';
import { money } from '@/lib/format';
import { usePrefs, useTheme } from '@/lib/theme';
import { PlutoLogo } from './brand';
import { Icon } from './Icon';
import { T } from './T';
import { Card, CardTitle } from './ui';

// Graficos e componentes de analise do site (Sparkline, Insight, RevenueChart, CategoryChart).

/** Curva monotona (Fritsch-Carlson): suave sem "ondas" que inventam picos entre os pontos. */
function monotonePath(pts: readonly [number, number][]): string {
  const n = pts.length;
  if (n < 2) return '';
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i]![0]);
  const m = pts.slice(1).map((p, i) => (p[1] - pts[i]![1]) / (dx[i] || 1));
  const t = pts.map((_, i) => (i === 0 ? m[0]! : i === n - 1 ? m[n - 2]! : m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2));
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += ` C${pts[i]![0] + h},${pts[i]![1] + t[i]! * h} ${pts[i + 1]![0] - h},${pts[i + 1]![1] - t[i + 1]! * h} ${pts[i + 1]![0]},${pts[i + 1]![1]}`;
  }
  return d;
}

let sparkId = 0;
/** Mini grafico de linha (sem eixos), com area em degrade opcional. */
export function Sparkline({ data, color, height = 48, filled = false, label }: { data: readonly number[]; color: string; height?: number; filled?: boolean; label: string }) {
  const width = 240, pad = 4;
  const id = useMemo(() => `spark${++sparkId}`, []);
  const { pts, path, area } = useMemo(() => {
    if (data.length < 2) return { pts: [] as [number, number][], path: '', area: '' };
    const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
    const p = data.map((v, i) => [pad + (i / (data.length - 1)) * (width - 2 * pad), pad + (1 - (v - min) / span) * (height - 2 * pad)] as [number, number]);
    const line = monotonePath(p);
    return { pts: p, path: line, area: `${line} L${p[p.length - 1]![0]},${height} L${p[0]![0]},${height} Z` };
  }, [data, height]);
  if (pts.length < 2)
    return (
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" accessibilityLabel={`${label}: sem dados suficientes`}>
        <Line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} stroke={color} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
      </Svg>
    );
  const first = data[0]!, last = data[data.length - 1]!;
  const ch = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
  const end = pts[pts.length - 1]!;
  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      accessibilityLabel={`${label} dos últimos ${data.length} dias${ch === null ? '' : `, ${ch >= 0 ? 'em alta' : 'em queda'} de ${Math.abs(ch).toFixed(1).replace('.', ',')}%`}`}
    >
      {filled && (
        <>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.35} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill={`url(#${id})`} />
        </>
      )}
      <Path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <Circle cx={end[0]} cy={end[1]} r={2.5} fill={color} />
    </Svg>
  );
}

/** "78% de chance": cor pela faixa (< 50% perigo, 50-80% atencao, > 80% positivo), sempre com texto. */
export function ProbabilityBadge({ p, label = 'de chance' }: { p: number; label?: string }) {
  const t = useTheme();
  const pct = Math.round(p * 100);
  const tone = pct < 50 ? { bg: t.dangerSoft, fg: t.dangerText, icon: 'circle-alert' } : pct <= 80 ? { bg: '#FEF3C7', fg: '#92400E', icon: 'clock' } : { bg: t.accent, fg: '#000000', icon: 'circle-check' };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: tone.bg, alignSelf: 'flex-start' }}>
      <Icon icon={tone.icon} size={13} color={tone.fg} />
      <T size={12} weight={600} color={tone.fg}>
        {pct}% {label}
      </T>
    </View>
  );
}

/** Faixa P10-P90 com marca no P50 e, opcional, a linha do limite. Com valores ocultos, so a forma. */
export function RangeBar({ p10, p50, p90, limit, limitLabel }: { p10: number; p50: number; p90: number; limit?: number; limitLabel?: string }) {
  const { theme: t, hideValues } = usePrefs();
  const lo = Math.min(p10, limit ?? p10), hi = Math.max(p90, limit ?? p90);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
  const min = lo - pad, span = hi + pad - min;
  const x = (v: number) => ((v - min) / span) * 100;
  const below = limit !== undefined && p10 < limit;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: 24 }} accessibilityLabel={hideValues ? 'Faixa da previsão' : `Faixa provável de ${money(p10)} a ${money(p90)}, mais provável ${money(p50)}`}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 9, height: 6, borderRadius: 99, backgroundColor: t.muted }} />
        <View
          style={{
            position: 'absolute',
            top: 6,
            height: 12,
            left: `${x(p10)}%`,
            width: `${Math.max(x(p90) - x(p10), 2)}%`,
            borderRadius: 99,
            backgroundColor: below ? '#FCA5A5' : t.brandSoft,
            borderWidth: 1,
            borderColor: below ? t.dangerText : t.brand,
          }}
        />
        <View style={{ position: 'absolute', top: 0, height: 24, width: 3, borderRadius: 99, left: `${x(p50)}%`, marginLeft: -1.5, backgroundColor: t.foreground }} />
        {limit !== undefined && <View style={{ position: 'absolute', top: -2, height: 28, width: 0, left: `${x(limit)}%`, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: t.dangerText }} />}
      </View>
      {!hideValues && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T size={12} tone="muted" tabular>
            {money(p10)}
          </T>
          {limit !== undefined && limitLabel ? (
            <T size={12} tone="danger">
              {limitLabel}
            </T>
          ) : null}
          <T size={12} tone="muted" tabular>
            {money(p90)}
          </T>
        </View>
      )}
    </View>
  );
}

/** O "por que" de qualquer numero: dados de entrada e regra. Abre no lugar. */
export function Why({ children, label = 'Por quê?' }: { children: ReactNode; label?: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, alignSelf: 'flex-start' }}>
        <Icon icon="info" size={14} color={t.brandText} />
        <T size={13} weight={600} tone="brand">
          {label}
        </T>
        <Icon icon={open ? 'chevron-up' : 'chevron-down'} size={14} color={t.brandText} />
      </Pressable>
      {open && <View style={{ borderRadius: 12, backgroundColor: t.muted, paddingHorizontal: 12, paddingVertical: 10, gap: 4 }}>{children}</View>}
    </View>
  );
}
export const WhyLine = ({ children }: { children: ReactNode }) => (
  <T size={12} tone="muted" style={{ lineHeight: 18 }}>
    {children}
  </T>
);

/** Dica da Pluto: bloco cinza com a gata. */
export function PlutoTip({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, backgroundColor: t.muted, padding: 12 }}>
      <PlutoLogo size={28} />
      <T size={13} style={{ flex: 1, lineHeight: 19 }}>
        {text}
      </T>
    </View>
  );
}

/** Arredonda para cima numa escala "bonita" (1, 2, 2,5, 5 x 10^n). */
function niceCeil(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** Barras empilhadas de receitas x despesas dos ultimos meses (toque mostra os valores). */
export function RevenueChart({ data, loading }: { data: { month: string; incomeMinor: number; expensesMinor: number }[]; loading?: boolean }) {
  const t = useTheme();
  const H = 180;
  const [sel, setSel] = useState(-1);
  const n = data.length;
  const max = niceCeil(Math.max(0, ...data.map((m) => m.incomeMinor + m.expensesMinor)));
  const cur = data[n - 1], prev = data[n - 2];
  const ch = cur && prev ? change(cur.incomeMinor, prev.incomeMinor) : null;
  const empty = !loading && data.every((m) => !m.incomeMinor && !m.expensesMinor);
  const s = sel >= 0 ? data[sel] : null;
  return (
    <Card>
      <CardTitle>Receitas x Despesas</CardTitle>
      <T size={13} tone="muted">
        {loading ? 'Carregando…' : n ? `${monthShort(data[0]!.month)} – ${monthLong(data[n - 1]!.month)}` : ''}
      </T>
      <View style={{ height: H, marginTop: 6 }}>
        {[0, 25, 50, 75, 100].map((p) => (
          <View key={p} style={{ position: 'absolute', left: 0, right: 0, top: `${p}%`, borderTopWidth: 1, borderTopColor: t.border }} />
        ))}
        {empty && (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
            <T size={13} tone="muted">
              Sem movimentações no período
            </T>
          </View>
        )}
        <View style={{ position: 'absolute', inset: 0, flexDirection: 'row' }}>
          {data.map((m, i) => (
            <Pressable key={m.month} accessibilityLabel={`${monthLong(m.month)}: receitas ${money(m.incomeMinor)}, despesas ${money(m.expensesMinor)}`} onPress={() => setSel(sel === i ? -1 : i)} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
              <View style={{ width: '62%', maxWidth: 40, opacity: sel === -1 || sel === i ? 1 : 0.5 }}>
                <View style={{ height: (m.expensesMinor / max) * H, backgroundColor: '#C6FF33', borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                <View style={{ height: (m.incomeMinor / max) * H, backgroundColor: '#7D39EB', borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
              </View>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {data.map((m) => (
          <T key={m.month} size={12} tone="muted" style={{ flex: 1, textAlign: 'center' }}>
            {monthShort(m.month)}
          </T>
        ))}
      </View>
      {s ? (
        <View style={{ borderRadius: 12, borderWidth: 1, borderColor: t.border, padding: 10, gap: 4 }}>
          <T size={13} weight={600}>
            {monthLong(s.month)}
          </T>
          <Legend color="#7D39EB" label="Receitas" value={money(s.incomeMinor)} />
          <Legend color="#C6FF33" label="Despesas" value={money(s.expensesMinor)} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
          <Legend color="#7D39EB" label="Receitas" />
          <Legend color="#C6FF33" label="Despesas" />
        </View>
      )}
      {cur && ch !== null && (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T size={14} weight={500}>
              Receitas {ch >= 0 ? 'subiram' : 'caíram'} {Math.abs(ch).toFixed(1).replace('.', ',')}% em {monthLower(cur.month)}
            </T>
            <Icon icon={ch >= 0 ? 'trending-up' : 'trending-down'} size={16} />
          </View>
          <T size={13} tone="muted">
            Transferências entre suas contas e pagamentos de fatura não entram na conta.
          </T>
        </View>
      )}
    </Card>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: color }} />
      <T size={12} tone={value ? 'muted' : 'default'} style={value ? { flex: 1 } : undefined}>
        {label}
      </T>
      {value ? (
        <T size={12} weight={600} tabular>
          {value}
        </T>
      ) : null}
    </View>
  );
}

const RING = 2 * Math.PI * 76;
/** Rosca de gastos por categoria do mes (5 maiores + Outras). */
export function CategoryChart({ spending, loading, tip }: { spending?: Spending; loading?: boolean; tip?: string | null }) {
  const t = useTheme();
  const [sel, setSel] = useState(-1);
  const all = spending?.categories ?? [];
  const total = spending?.totalMinor ?? 0;
  const top = all.slice(0, 5).map((c) => ({ ...categoryOf(c.key), spentMinor: c.spentMinor }));
  const restSum = all.slice(5).reduce((s, c) => s + c.spentMinor, 0);
  const cats = restSum > 0 ? [...top, { key: 'resto', label: 'Outras categorias', icon: 'receipt', color: '#A1A1AA', group: 'lifestyle' as const, spentMinor: restSum }] : top;
  // Preto vira a cor do texto para aparecer no tema escuro.
  const items = cats.map((c) => ({ ...c, color: c.color === '#000000' ? t.foreground : c.color, pct: total ? (c.spentMinor / total) * 100 : 0 }));
  const lens = items.map((c) => (c.pct / 100) * RING);
  const cur = sel >= 0 ? items[sel] : null;
  const center = cur
    ? { label: cur.label, value: money(cur.spentMinor), sub: `${cur.pct.toFixed(1).replace('.', ',')}% do total` }
    : { label: 'Total gasto', value: money(total), sub: `${all.length} categoria${all.length === 1 ? '' : 's'}` };
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: 4 }}>
          <CardTitle>Gastos por categoria</CardTitle>
          <T size={13} tone="muted">
            {spending ? monthLong(spending.month) : loading ? 'Carregando…' : ''}
          </T>
        </View>
        <Icon icon="pie-chart" size={18} />
      </View>
      {!loading && !items.length ? (
        <T size={13} tone="muted" style={{ textAlign: 'center', paddingVertical: 32 }}>
          Nenhum gasto neste mês ainda.
        </T>
      ) : (
        <>
          <View style={{ alignSelf: 'center', width: 190, height: 190 }}>
            <Svg viewBox="0 0 200 200" width={190} height={190} accessibilityLabel="Gastos por categoria">
              <Circle cx={100} cy={100} r={76} fill="none" stroke={t.muted} strokeWidth={24} />
              <G rotation={-90} origin="100, 100">
                {items.map((s, i) => (
                  <Circle
                    key={s.key}
                    cx={100}
                    cy={100}
                    r={76}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={sel === i ? 32 : 24}
                    strokeDasharray={`${Math.max(lens[i]! - 3, 0.5)} ${RING}`}
                    strokeDashoffset={-lens.slice(0, i).reduce((a, b) => a + b, 0)}
                    opacity={sel === -1 || sel === i ? 1 : 0.35}
                    onPress={() => setSel(sel === i ? -1 : i)}
                  />
                ))}
              </G>
            </Svg>
            <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 }}>
              <T size={12} tone="muted" numberOfLines={1}>
                {center.label}
              </T>
              <T size={19} weight={700} tabular numberOfLines={1} adjustsFontSizeToFit>
                {center.value}
              </T>
              <T size={12} tone="muted">
                {center.sub}
              </T>
            </View>
          </View>
          <View>
            {items.map((s, i) => (
              <Pressable key={s.key} accessibilityRole="button" onPress={() => setSel(sel === i ? -1 : i)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, borderRadius: 10, paddingHorizontal: 8, backgroundColor: sel === i ? t.muted : 'transparent' }}>
                <View style={{ width: 28, height: 28, borderRadius: 99, borderWidth: 2, borderColor: s.color, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon icon={s.icon} size={14} />
                </View>
                <T size={14} style={{ flex: 1 }} numberOfLines={1}>
                  {s.label}
                </T>
                <T size={12} tone="muted" tabular>
                  {s.pct.toFixed(0)}%
                </T>
                <T size={14} weight={600} tabular style={{ minWidth: 86, textAlign: 'right' }}>
                  {money(s.spentMinor)}
                </T>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {tip ? <PlutoTip text={tip} /> : null}
    </Card>
  );
}
