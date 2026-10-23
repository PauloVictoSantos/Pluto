import type { Bill } from '@pluto/shared';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { PlutoLogo } from '@/components/brand';
import { BankLogo, bankBrand } from '@/components/brands';
import { CategoryChart, PlutoTip, RevenueChart, Sparkline } from '@/components/charts';
import { CreditCard, cardLook } from '@/components/CreditCard';
import { ForecastCard } from '@/components/ForecastCard';
import { HealthGauge } from '@/components/HealthGauge';
import { Icon } from '@/components/Icon';
import { RecentTransactions } from '@/components/RecentTransactions';
import { useShell } from '@/components/shell/ShellContext';
import { T } from '@/components/T';
import { Btn, Card, CardTitle, Screen } from '@/components/ui';
import { change, daysBetween, hourIn, monthLower, monthProgress, nextDue, pctText, spendingTip, ymdIn } from '@/lib/dates';
import { VALUE_MASK, fmtDay, money } from '@/lib/format';
import { useBills, useBudget, useCards, useCurrentMonth, useInvestments, useMe, useSeries, useSpending, useSummary, useTz } from '@/lib/queries';
import { usePrefs } from '@/lib/theme';

// Visao geral (como apps/web/app/(app)/page.tsx no celular): 7 blocos em destaque (Saldo, Receitas,
// Despesas, Investido, Compras recentes, Proximos vencimentos, Limite de gastos) e "Analises".

interface Due {
  id: string;
  name: string;
  sub: string;
  date: string;
  amount: number;
  overdue: boolean;
  bank: string | null;
}

export default function Overview() {
  const { theme: t, hideValues, setHideValues } = usePrefs();
  const { nav, openChat } = useShell();
  const tz = useTz();
  const month = useCurrentMonth();
  const me = useMe();
  const summary = useSummary();
  const series = useSeries();
  const spending = useSpending();
  const budget = useBudget(month);
  const cards = useCards();
  const invest = useInvestments();
  const bills = useBills();
  const [analyses, setAnalyses] = useState(false);

  const fullName = me.data?.name ?? '';
  const userName = fullName.split(' ')[0] ?? '';
  const s = summary.data, sr = series.data;
  const cur = s?.current, prev = s?.previous;
  const now = new Date();
  const today = ymdIn(now, tz);
  const hour = hourIn(now, tz);
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  // Proximos vencimentos: faturas dos cartoes + boletos a pagar, por data.
  const cardList = cards.data ?? [];
  const dues: Due[] = [
    ...cardList
      .filter((c) => c.dueDay && c.currentBillMinor > 0)
      .map((c) => ({ id: `c-${c.id}`, name: c.name, sub: 'Fatura atual', date: nextDue(c.dueDay!, today), amount: c.currentBillMinor, overdue: false, bank: c.institutionName })),
    ...cardList
      .filter((c) => c.invoice?.status === 'OVERDUE')
      .map((c) => ({ id: `o-${c.id}`, name: c.name, sub: 'Fatura não paga', date: c.invoice!.dueDate.toISOString().slice(0, 10), amount: c.invoice!.totalMinor - c.invoice!.paidMinor, overdue: true, bank: c.institutionName })),
    ...(bills.data ?? []).filter((b: Bill) => b.status !== 'paid').map((b: Bill) => ({ id: `b-${b.id}`, name: b.payee, sub: 'Boleto', date: b.dueDate, amount: b.amountMinor, overdue: b.status === 'overdue', bank: null })),
  ].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date));
  const urgent = dues.some((d) => d.overdue || daysBetween(today, d.date) <= 7);
  const sub = cur && prev ? `${monthLower(cur.month)} vs. ${monthLower(prev.month)}` : '';

  const refresh = () => void Promise.all([summary.refresh(), series.refresh(), spending.refresh(), budget.refresh(), cards.refresh(), invest.refresh(), bills.refresh()]);

  return (
    <Screen refreshing={summary.refreshing} onRefresh={refresh} gap={12}>
      {/* Cabecalho: a gata, a saudacao e o atalho para o Plutao. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <PlutoLogo size={38} />
        </View>
        <T size={22} weight={700} numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
          {greeting}
          {userName ? `, ${userName}` : ''}!
        </T>
        <Pressable accessibilityRole="button" accessibilityLabel="Falar com o Plutão" onPress={openChat} style={{ width: 44, height: 44, borderRadius: 99, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon icon="sparkles" size={18} color="#000000" />
        </Pressable>
      </View>

      {saldoCard()}
      {urgent && dueCard()}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {kpiCard('Receitas', cur?.incomeMinor, cur && prev ? change(cur.incomeMinor, prev.incomeMinor) : null, 'arrow-down-left', true, false, sr?.incomeMinor)}
        {kpiCard('Despesas', cur?.expensesMinor, cur && prev ? change(cur.expensesMinor, prev.expensesMinor) : null, 'arrow-up-right', false, true, sr?.expensesMinor)}
      </View>
      {investedCard()}
      {!urgent && dueCard()}
      <RecentTransactions limit={5} />
      {limitCard()}

      {/* Analises: secundario e recolhivel (fechado no celular, como no site). */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: analyses }}
        onPress={() => setAnalyses(!analyses)}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginTop: 8, paddingHorizontal: 4 }}
      >
        <T size={15} weight={600} tone="muted">
          Análises
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
          <T size={13} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {analyses ? 'Recolher' : 'Ver projeção, gráficos, saúde e cartões'}
          </T>
          <Icon icon={analyses ? 'chevron-up' : 'chevron-down'} size={16} color={t.mutedForeground} />
        </View>
      </Pressable>
      {analyses && (
        <View style={{ gap: 12 }}>
          <ForecastCard />
          <RevenueChart data={s?.monthly ?? []} loading={summary.isLoading} />
          <CategoryChart spending={spending.data} loading={spending.isLoading} tip={spendingTip(spending.data, budget.data)} />
          <HealthGauge firstName={userName} />
          {cardsBlock()}
          {investmentsList()}
        </View>
      )}
    </Screen>
  );

  // Blocos como funcoes (nao componentes): nao remontam a cada renderizacao da pagina.
  function saldoCard() {
    const monthChange = cur && prev ? change(cur.incomeMinor - cur.expensesMinor, prev.incomeMinor - prev.expensesMinor) : null;
    const actions = [
      { label: 'Extrato', icon: 'arrow-left-right', go: () => nav('tx') },
      { label: 'Faturas', icon: 'calendar-days', go: () => nav('bills') },
      { label: 'Metas', icon: 'target', go: () => nav('goals') },
      { label: 'Planejar', icon: 'pie-chart', go: () => nav('plan') },
    ];
    return (
      <View style={{ borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#26262C', padding: 20, gap: 16 }}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="saldobg" x1="0.2" y1="0" x2="0.8" y2="1">
              <Stop offset="0" stopColor="#17171C" />
              <Stop offset="1" stopColor="#0B0B0E" />
            </LinearGradient>
            <RadialGradient id="saldoglow" cx="1" cy="0" rx="1.2" ry="1.2">
              <Stop offset="0" stopColor="#C6F432" stopOpacity={0.22} />
              <Stop offset="0.45" stopColor="#C6F432" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#saldobg)" />
          <Rect width="100%" height="100%" fill="url(#saldoglow)" />
        </Svg>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T size={16} weight={600} color="#FFFFFF">
            Saldo em conta
          </T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
            onPress={() => setHideValues(!hideValues)}
            style={{ width: 40, height: 40, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon icon={hideValues ? 'eye-off' : 'eye'} size={17} color="#FFFFFF" />
          </Pressable>
        </View>
        <View style={{ gap: 8 }}>
          <T size={40} weight={700} color="#FFFFFF" tabular numberOfLines={1} adjustsFontSizeToFit style={{ letterSpacing: -1.6 }}>
            {s ? (hideValues ? VALUE_MASK : money(s.balanceMinor)) : '—'}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <T size={13} color="rgba(255,255,255,0.75)">
              Saldo do mês{' '}
              <T size={13} weight={700} color="#FFFFFF" tabular>
                {cur ? money(cur.incomeMinor - cur.expensesMinor) : '—'}
              </T>
            </T>
            {monthChange !== null && (
              <View style={{ borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: monthChange >= 0 ? '#C6F432' : 'rgba(248,113,113,0.2)' }}>
                <T size={12} weight={600} color={monthChange >= 0 ? '#000000' : '#FCA5A5'}>
                  {monthChange >= 0 ? '▲' : '▼'} {pctText(monthChange)}
                </T>
              </View>
            )}
          </View>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {actions.map((a, i) => (
            <Pressable key={a.label} accessibilityRole="button" onPress={a.go} style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 4 }}>
              <View style={{ width: 48, height: 48, borderRadius: 99, backgroundColor: i === 0 ? '#C6F432' : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon icon={a.icon} size={19} color={i === 0 ? '#000000' : '#FFFFFF'} />
              </View>
              <T size={12} weight={600} color="#FFFFFF">
                {a.label}
              </T>
            </Pressable>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {s && s.banks.length === 0 && <Btn small kind="outline" icon="plus" label="Conectar banco" onPress={() => nav('settings')} />}
          {(s?.banks ?? []).map((b) => {
            const line = sr?.banks.find((x) => x.connectionId === b.connectionId);
            return (
              <View key={b.connectionId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 6, paddingLeft: 6, paddingRight: 12 }}>
                <BankLogo name={b.institutionName} color={b.primaryColor} size={24} />
                <T size={12} weight={600} color="#FFFFFF">
                  {bankBrand(b.institutionName).label}
                </T>
                <T size={12} color="rgba(255,255,255,0.8)" tabular>
                  {money(b.balanceMinor)}
                </T>
                {line && (
                  <View style={{ width: 48 }}>
                    <Sparkline data={line.balanceMinor} height={18} label={`Saldo ${bankBrand(b.institutionName).label}`} color="#C6F432" />
                  </View>
                )}
                {b.needsAction && <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: '#EF4444' }} accessibilityLabel="Reconectar" />}
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  function kpiCard(label: string, v: number | undefined, c: number | null, icon: string, featured: boolean, invert: boolean, line: number[] | undefined) {
    const up = (c ?? 0) >= 0, good = invert ? !up : up;
    const fg = featured ? '#FFFFFF' : t.foreground;
    return (
      <View style={{ flex: 1, minWidth: 0, borderRadius: 24, padding: 14, gap: 12, backgroundColor: featured ? '#7D39EB' : t.card, borderWidth: 1, borderColor: featured ? '#7D39EB' : t.border }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <View style={{ width: 36, height: 36, borderRadius: 99, backgroundColor: featured ? 'rgba(255,255,255,0.16)' : t.muted, alignItems: 'center', justifyContent: 'center' }}>
            <Icon icon={icon} size={17} color={fg} />
          </View>
          {c !== null && badge(up, good, pctText(c), featured)}
        </View>
        <View style={{ height: 44 }}>{line ? <Sparkline data={line} height={44} filled label={label} color={featured ? 'rgba(255,255,255,0.9)' : good ? '#C6F432' : '#F87171'} /> : null}</View>
        <View>
          <T size={14} weight={600} color={fg}>
            {label}
          </T>
          <T size={20} weight={700} color={fg} tabular numberOfLines={1} adjustsFontSizeToFit style={{ marginTop: 4 }}>
            {v === undefined ? '—' : money(v)}
          </T>
          <T size={12} color={featured ? 'rgba(255,255,255,0.85)' : t.mutedForeground} style={{ marginTop: 4 }}>
            {sub}
          </T>
        </View>
      </View>
    );
  }

  function badge(up: boolean, good: boolean, text: string, featured?: boolean) {
    const bg = good ? '#C6FF33' : featured ? '#FFFFFF' : t.dangerSoft;
    const fg = good ? '#000000' : featured ? '#B42318' : t.dangerText;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: bg }}>
        <Icon icon={up ? 'arrow-up-right' : 'arrow-down-right'} size={13} color={fg} />
        <T size={12} weight={600} color={fg}>
          {text}
        </T>
      </View>
    );
  }

  function investedCard() {
    const total = invest.data?.totalMinor;
    const line = sr?.investedMinor;
    const first = line?.[0] ?? 0, last = line?.[line.length - 1] ?? 0;
    const c = line && first ? ((last - first) / Math.abs(first)) * 100 : null;
    // Agrupa posicoes iguais (mesma instituicao e indexador) numa linha so.
    const groups = new Map<string, { label: string; sub: string; value: number }>();
    for (const i of invest.data?.items ?? []) {
      const key = `${i.institutionName}|${i.rateInfo ?? i.subtype ?? i.type}`;
      const g = groups.get(key) ?? { label: i.subtype ?? i.name, sub: [i.institutionName, i.rateInfo].filter(Boolean).join(' · '), value: 0 };
      g.value += i.currentValueMinor;
      groups.set(key, g);
    }
    const top = [...groups.values()].sort((a, b) => b.value - a.value).slice(0, 3);
    return (
      <Card hero style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CardTitle>Investido</CardTitle>
          {c !== null && badge(c >= 0, c >= 0, pctText(c))}
        </View>
        <T size={28} weight={700} tabular>
          {total === undefined ? '—' : money(total)}
        </T>
        <View style={{ height: 40 }}>{line ? <Sparkline data={line} height={40} filled label="Patrimônio investido" color={c === null || c >= 0 ? '#C6F432' : '#F87171'} /> : null}</View>
        {invest.data && !invest.data.items.length ? (
          <T size={13} tone="muted">
            Nenhum investimento nas conexões atuais.
          </T>
        ) : (
          <View>
            {top.map((g) => (
              <View key={g.label + g.sub} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: t.border, paddingVertical: 6 }}>
                <T size={13} numberOfLines={1} style={{ flex: 1 }}>
                  <T size={13} weight={600}>
                    {g.label}
                  </T>{' '}
                  <T size={13} tone="muted">
                    {g.sub}
                  </T>
                </T>
                <T size={13} weight={600} tabular>
                  {money(g.value)}
                </T>
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={() => nav('invest')} style={{ height: 36, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <T size={13} weight={600} tone="brand">
                Ver todos
              </T>
            </Pressable>
          </View>
        )}
      </Card>
    );
  }

  function dueCard() {
    const overdue = dues.filter((d) => d.overdue);
    const loading = cards.isLoading || bills.isLoading;
    const chip = (d: Due) => {
      const n = daysBetween(today, d.date);
      if (d.overdue || n < 0) return { text: 'atrasada', bg: t.dangerSoft, fg: t.dangerText };
      if (n === 0) return { text: 'vence hoje', bg: t.dangerSoft, fg: t.dangerText };
      if (n <= 3) return { text: `em ${n} dia${n > 1 ? 's' : ''}`, bg: t.dangerSoft, fg: t.dangerText };
      if (n <= 7) return { text: `em ${n} dias`, bg: '#FEF3C7', fg: '#92400E' };
      return { text: `em ${n} dias`, bg: t.muted, fg: t.mutedForeground };
    };
    return (
      <Card hero style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CardTitle>Próximos vencimentos</CardTitle>
          <Pressable accessibilityRole="button" onPress={() => nav('bills')} style={{ height: 40, justifyContent: 'center' }}>
            <T size={13} weight={600} tone="brand">
              Contas a pagar
            </T>
          </Pressable>
        </View>
        {overdue.length > 0 && (
          <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 8, borderRadius: 12, backgroundColor: t.dangerSoft, paddingHorizontal: 12, paddingVertical: 10 }}>
            <Icon icon="circle-alert" size={16} color={t.dangerText} />
            <T size={13} weight={500} color={t.dangerText} style={{ flex: 1 }}>
              {overdue.length === 1 ? `${overdue[0]!.name}: ${overdue[0]!.sub.toLowerCase()}, vencida em ${fmtDay(overdue[0]!.date)}.` : `${overdue.length} contas vencidas sem pagamento.`}
            </T>
          </View>
        )}
        {!loading && dues.length === 0 && (
          <T size={14} tone="muted" style={{ paddingVertical: 8 }}>
            Nada para pagar agora. 🎉
          </T>
        )}
        {dues
          .filter((d) => !d.overdue)
          .slice(0, 4)
          .map((d) => {
            const c = chip(d);
            return (
              <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: t.border, paddingTop: 10 }}>
                {d.bank ? (
                  <BankLogo name={d.bank} size={36} />
                ) : (
                  <View style={{ width: 36, height: 36, borderRadius: 99, backgroundColor: t.muted, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon icon="barcode" size={16} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T size={14} weight={600} numberOfLines={1}>
                    {d.name}
                  </T>
                  <T size={12} tone="muted">
                    {d.sub} · {fmtDay(d.date)}
                  </T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <T size={14} weight={600} tabular>
                    {money(d.amount)}
                  </T>
                  <View style={{ borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: c.bg }}>
                    <T size={11} weight={600} color={c.fg}>
                      {c.text}
                    </T>
                  </View>
                </View>
              </View>
            );
          })}
      </Card>
    );
  }

  function limitCard() {
    const limitTotal = (budget.data?.items ?? []).reduce((acc, b) => acc + b.limitMinor, 0);
    const spent = cur?.expensesMinor ?? 0;
    const used = limitTotal ? spent / limitTotal : 0;
    // RN-21: projecao do mes = gasto ate hoje / dias decorridos x dias do mes.
    const { days, elapsed } = monthProgress(month, today);
    const projected = elapsed ? Math.round((spent / elapsed) * days) : spent;
    const color = used >= 0.9 ? '#EF4444' : used >= 0.7 ? '#F59E0B' : '#7D39EB';
    if (budget.data && !limitTotal)
      return (
        <Card hero style={{ gap: 12 }}>
          <CardTitle>Limite de gastos</CardTitle>
          <T size={14} tone="muted">
            Defina quanto quer gastar por mês. A Pluto sugere limites pelo seu hábito real.
          </T>
          <View style={{ alignSelf: 'flex-start' }}>
            <Btn icon="plus" label="Definir limite" onPress={() => nav('budget')} />
          </View>
        </Card>
      );
    return (
      <Card hero style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CardTitle>Limite de gastos</CardTitle>
          <Pressable accessibilityRole="button" onPress={() => nav('budget')} style={{ height: 40, justifyContent: 'center' }}>
            <T size={13} weight={600} tone="brand">
              Ver
            </T>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}>
          <T size={28} weight={700} tabular>
            {money(spent)}
          </T>
          <T size={14} tone="muted">
            de {money(limitTotal)}
          </T>
        </View>
        <View style={{ height: 10, borderRadius: 99, overflow: 'hidden', backgroundColor: t.muted }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(used * 100) }}>
          <View style={{ width: `${Math.min(used * 100, 100)}%`, height: '100%', borderRadius: 99, backgroundColor: color }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T size={13} tone="muted">
            {(used * 100).toFixed(0)}% usado
          </T>
          <T size={13} tone="muted">
            {limitTotal >= spent ? 'Restam ' : 'Passou '}
            <T size={13} weight={700}>
              {money(Math.abs(limitTotal - spent))}
            </T>
          </T>
        </View>
        <T size={13} color={projected > limitTotal ? t.dangerText : t.mutedForeground}>
          No ritmo atual, o mês fecha em <T size={13} weight={700} color={projected > limitTotal ? t.dangerText : t.foreground}>{money(projected)}</T>
          {projected > limitTotal ? ', acima do limite.' : '.'}
        </T>
      </Card>
    );
  }

  function cardsBlock() {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CardTitle>Meus cartões</CardTitle>
          <Pressable accessibilityRole="button" onPress={() => nav('cards')} style={{ height: 36, justifyContent: 'center' }}>
            <T size={13} weight={600} tone="brand">
              Ver todos
            </T>
          </Pressable>
        </View>
        {cards.data && !cardList.length && (
          <T size={14} tone="muted">
            Nenhum cartão de crédito nas contas conectadas.
          </T>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToAlignment="start" decelerationRate="fast" contentContainerStyle={{ gap: 12 }}>
          {cardList.map((c, i) => (
            <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`Abrir ${c.name}`} onPress={() => nav('cards')} style={{ width: 290, gap: 8 }}>
              <CreditCard card={cardLook(c, i, fullName, t.darkCard)} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <T size={13} tone="muted">
                  {c.dueDay ? `Fatura atual · vence ${fmtDay(nextDue(c.dueDay, today))}` : 'Fatura atual'}
                </T>
                <T size={13} weight={700} tabular>
                  {money(c.currentBillMinor)}
                </T>
              </View>
            </Pressable>
          ))}
        </ScrollView>
        <PlutoTip text="Pagar as faturas até o vencimento evita os juros do rotativo, que estão entre os mais altos do mercado." />
      </Card>
    );
  }

  function investmentsList() {
    const items = invest.data?.items ?? [];
    return (
      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <CardTitle>Investimentos</CardTitle>
          <Pressable accessibilityRole="button" onPress={() => nav('invest')} style={{ height: 36, justifyContent: 'center' }}>
            <T size={13} weight={600} tone="brand">
              Ver todos
            </T>
          </Pressable>
        </View>
        {invest.data && !items.length && (
          <T size={14} tone="muted">
            Nenhum investimento nas conexões atuais.
          </T>
        )}
        {items.slice(0, 5).map((i) => {
          const gain = i.appliedMinor ? ((i.currentValueMinor - i.appliedMinor) / i.appliedMinor) * 100 : null;
          return (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, borderTopWidth: 1, borderTopColor: t.border }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T size={14} weight={600} numberOfLines={1}>
                  {i.name}
                </T>
                <T size={12} tone="muted" numberOfLines={1}>
                  {[i.institutionName, i.rateInfo].filter(Boolean).join(' · ')}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                <T size={14} weight={600} tabular>
                  {money(i.currentValueMinor)}
                </T>
                {gain !== null && (
                  <T size={12} tabular color={gain >= 0 ? '#16A34A' : t.dangerText}>
                    {pctText(gain)}
                  </T>
                )}
              </View>
            </View>
          );
        })}
      </Card>
    );
  }
}
