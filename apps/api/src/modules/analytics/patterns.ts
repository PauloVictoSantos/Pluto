import { bandOf, cusumShift, heatmap, holtForecast } from '@pluto/finance-engine';
import { categoryOf, type Patterns } from '@pluto/shared';
import type { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import { addMonth, monthOf, monthStart, tzOffsetMs } from '../../lib/time';
import { buildCategorizer } from './categorizer';

// Padroes de gasto (doc. "Padroes de despesa", "Quando voce gasta", "Anomalias e mudanca de patamar").

const DAY = 86_400_000;
/** RN-D04: nenhum padrao e afirmado com menos de 8 semanas de dados. */
const MIN_WEEKS = 8;
const WINDOW_WEEKS = 13;
const SHIFT_WEEKS = 26;
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const BAND_LABEL = ['de madrugada (0h às 4h)', 'entre 4h e 8h', 'entre 8h e 12h', 'entre 12h e 16h', 'entre 16h e 20h', 'entre 20h e 24h'];

const local = (d: Date, tz: string) => new Date(d.getTime() + tzOffsetMs(d, tz));
const pct = (x: number) => `${Math.round(x * 100)}%`;

export async function patterns(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<Patterns> {
  const tz = (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
  const first = await ctx.col.transactions.findOne({ userId, deletedAt: null }, { sort: { date: 1 }, projection: { date: 1 } });
  const historyDays = first ? Math.floor((now.getTime() - first.date.getTime()) / DAY) : 0;
  const weeks = Math.min(WINDOW_WEEKS, Math.floor(historyDays / 7));
  const since = new Date(now.getTime() - SHIFT_WEEKS * 7 * DAY);

  const txs = await ctx.col.transactions
    .find({ userId, deletedAt: null, type: 'EXPENSE', date: { $gte: since } }, { projection: { date: 1, amountMinor: 1, hasTime: 1, categoryKey: 1 } })
    .toArray();
  const windowStart = now.getTime() - weeks * 7 * DAY;
  const inWindow = txs.filter((t) => t.date.getTime() >= windowStart);

  // Mapa dia x faixa horaria: so transacoes com horario real (RN-D03).
  const timed = inWindow.filter((t) => t.hasTime !== false);
  const events = timed.map((t) => {
    const l = local(t.date, tz);
    return { dow: l.getUTCDay(), band: bandOf(l.getUTCHours()), amount: -t.amountMinor, cat: t.categoryKey };
  });
  const cells = heatmap(events, weeks);
  const ready = weeks >= MIN_WEEKS;

  // Frase-conclusao: a celula de pico com mais gasto, e a categoria que mais pesa nela.
  let conclusion: string | null = null;
  const timedTotal = events.reduce((s, e) => s + e.amount, 0);
  const peak = ready ? cells.filter((c) => c.peak).sort((a, b) => b.expected - a.expected)[0] : undefined;
  if (peak && timedTotal > 0) {
    const inCell = events.filter((e) => e.dow === peak.dow && e.band === peak.band);
    const byCat = new Map<string, number>();
    inCell.forEach((e) => byCat.set(e.cat, (byCat.get(e.cat) ?? 0) + e.amount));
    const [topCat, topAmt] = [...byCat].sort((a, b) => b[1] - a[1])[0]!;
    const cellTotal = inCell.reduce((s, e) => s + e.amount, 0);
    conclusion =
      `${WEEKDAYS[peak.dow]} ${BAND_LABEL[peak.band]} concentra ${pct(cellTotal / timedTotal)} do seu gasto com horário registrado` +
      (topAmt / cellTotal >= 0.4 ? `, principalmente ${categoryOf(topCat).label.toLowerCase()}.` : '.');
  }

  // Por dia da semana: entram tambem as transacoes so com data.
  const byDayTotal = Array<number>(7).fill(0);
  inWindow.forEach((t) => (byDayTotal[local(t.date, tz).getUTCDay()]! -= t.amountMinor));

  // Categorias: ate 5 + "outras" (doc. "Visualizacao de dados").
  const catTotals = new Map<string, number>();
  inWindow.forEach((t) => catTotals.set(t.categoryKey, (catTotals.get(t.categoryKey) ?? 0) - t.amountMinor));
  const sortedCats = [...catTotals].sort((a, b) => b[1] - a[1]);
  const total = sortedCats.reduce((s, [, v]) => s + v, 0);
  const top = sortedCats.slice(0, 5);
  const rest = sortedCats.slice(5).reduce((s, [, v]) => s + v, 0);
  const categories = [...top, ...(rest > 0 ? [['outras', rest] as [string, number]] : [])].map(([categoryKey, v]) => ({
    categoryKey,
    totalMinor: v,
    share: total ? v / total : 0,
  }));

  // Mudanca de patamar (CUSUM) nos totais semanais de cada categoria.
  const fullWeeks = Math.min(SHIFT_WEEKS, Math.floor(historyDays / 7));
  const shifts: Patterns['shifts'] = [];
  if (fullWeeks >= 16) {
    const weekly = new Map<string, number[]>();
    for (const t of txs) {
      const w = Math.floor((now.getTime() - t.date.getTime()) / (7 * DAY));
      if (w >= fullWeeks) continue;
      const arr = weekly.get(t.categoryKey) ?? Array<number>(fullWeeks).fill(0);
      arr[fullWeeks - 1 - w]! -= t.amountMinor;
      weekly.set(t.categoryKey, arr);
    }
    for (const [categoryKey, series] of weekly) {
      const s = cusumShift(series);
      if (s && s.recent > s.baseline) shifts.push({ categoryKey, weeksAgo: s.weeksAgo, baselineWeeklyMinor: Math.round(s.baseline), recentWeeklyMinor: Math.round(s.recent) });
    }
    shifts.sort((a, b) => b.recentWeeklyMinor - b.baselineWeeklyMinor - (a.recentWeeklyMinor - a.baselineWeeklyMinor));
  }

  // Totais mensais por categoria (meses fechados) para tendencia e variacao.
  const month = monthOf(now, tz);
  const firstMonth = first ? monthOf(first.date, tz) : month;
  const months = Array.from({ length: 12 }, (_, i) => addMonth(month, -12 + i)).filter((m) => m > firstMonth);
  const monthly = new Map<string, Map<string, number>>();
  if (months.length) {
    const rows = await ctx.col.transactions
      .aggregate<{ _id: { m: string; c: string }; total: number }>([
        { $match: { userId, deletedAt: null, type: 'EXPENSE', date: { $gte: monthStart(months[0]!, tz), $lt: monthStart(month, tz) } } },
        { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$date', timezone: tz } }, c: '$categoryKey' }, total: { $sum: '$amountMinor' } } },
      ])
      .toArray();
    for (const r of rows) {
      const m = monthly.get(r._id.c) ?? new Map<string, number>();
      m.set(r._id.m, -r.total);
      monthly.set(r._id.c, m);
    }
  }
  const last = months[months.length - 1], prev = months[months.length - 2];
  const trend: Patterns['trend'] = last
    ? [...monthly]
        .map(([categoryKey, m]) => ({ categoryKey, series: months.map((x) => m.get(x) ?? 0) }))
        .sort((a, b) => b.series[b.series.length - 1]! - a.series[a.series.length - 1]!)
        .slice(0, 6)
        .map(({ categoryKey, series }) => {
          const h = holtForecast(series);
          // RN-I04: so mostra a previsao se vencer "igual ao mes passado" (MASE < 1).
          const ok = h && Number.isFinite(h.mase) && h.mase < 1;
          return { categoryKey, lastMonthMinor: series[series.length - 1]!, nextMonthMinor: ok ? Math.round(h.forecast) : null, mase: h && Number.isFinite(h.mase) ? Math.round(h.mase * 100) / 100 : null };
        })
    : [];

  let variation: Patterns['variation'] = null;
  if (last && prev) {
    const deltas = [...monthly].map(([categoryKey, m]) => ({ categoryKey, deltaMinor: (m.get(last) ?? 0) - (m.get(prev) ?? 0) }));
    const totalDeltaMinor = deltas.reduce((s, d) => s + d.deltaMinor, 0);
    variation = {
      month: last,
      prevMonth: prev,
      totalDeltaMinor,
      // As que mais empurraram na direcao da variacao total.
      drivers: deltas
        .filter((d) => d.deltaMinor !== 0 && Math.sign(d.deltaMinor) === Math.sign(totalDeltaMinor || d.deltaMinor))
        .sort((a, b) => Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor))
        .slice(0, 3),
    };
  }

  const cat = await buildCategorizer(ctx.col, userId);
  const recent = { userId, deletedAt: null, date: { $gte: new Date(now.getTime() - 120 * DAY) } };
  return {
    status: ready ? 'ready' : 'learning',
    weeks,
    needWeeks: Math.max(0, MIN_WEEKS - weeks),
    cells: cells.map((c) => ({
      dow: c.dow,
      band: c.band,
      count: c.count,
      ratePerWeek: Math.round(c.rate * 100) / 100,
      ticketMinor: Math.round(c.ticket),
      expectedMinor: Math.round(c.expected),
      peak: ready && c.peak,
    })),
    conclusion,
    untimedShare: inWindow.length ? 1 - timed.length / inWindow.length : 0,
    byDay: byDayTotal.map((v, dow) => ({ dow, weeklyMinor: weeks ? Math.round(v / weeks) : 0 })),
    categories,
    shifts,
    trend,
    variation,
    seasonalityNeedMonths: Math.max(0, 24 - Math.floor(historyDays / 30.4)),
    categorizer: {
      enabled: cat.enabled,
      examples: cat.examples,
      f1: cat.f1 === null ? null : Math.round(cat.f1 * 100) / 100,
      applied: await ctx.col.transactions.countDocuments({ ...recent, categorySource: 'AI' }),
      suggested: await ctx.col.transactions.countDocuments({ ...recent, aiSuggestion: { $ne: null, $exists: true } }),
    },
  };
}
