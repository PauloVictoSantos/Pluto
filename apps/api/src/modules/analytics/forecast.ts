import {
  diverges,
  evaluate,
  extraForChance,
  goalChances,
  median,
  monthEnd,
  monthProfile,
  paymentOrder,
  pmt,
  profileEstimate,
  quantile,
  simulateVariable,
  suggestBudget,
  type BacktestPoint,
  type DelayTerms,
} from '@pluto/finance-engine';
import { CATEGORY_BY_KEY, type BudgetSuggestion, type Forecast, type GoalInsights, type PaymentPlan } from '@pluto/shared';
import type { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { TransactionDoc } from '../../db/collections';
import { addMonth, monthOf, monthStart, tzOffsetMs } from '../../lib/time';
import { directionOf, ruleKeyOf } from '../categories/rules';
import { monthsBetween } from '../shopping/service';
import { recurringKeys } from './service';

// Previsao, orcamento sugerido, chance das metas e ordem de pagamento (doc. "Previsao, metas e
// boletos"). O servidor calcula tudo; a interface e o Gemini so mostram e explicam (RN-I01).

const DAY = 86_400_000;
/** Historico usado no bootstrap (13 semanas = ~90 dias). */
const WEEKS = 13;
/** Minimo de semanas antes de qualquer previsao. */
const MIN_WEEKS = 4;
/** Juros do rotativo: o Open Finance nao informa a taxa da fatura; tipico no Brasil. */
export const REVOLVING_RATE = 0.14;
const CARD_TERMS: DelayTerms = { monthlyRate: REVOLVING_RATE, fine: 0.02, iof: true };

const ymdIn = (d: Date, tz: string) => new Date(d.getTime() + tzOffsetMs(d, tz)).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dowOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const daysInMonth = (month: string) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const seedOf = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
const round = (x: number) => Math.round(x);
const rangeInt = (r: { p10: number; p50: number; p90: number }) => ({ p10: round(r.p10), p50: round(r.p50), p90: round(r.p90) });

interface Base {
  tz: string;
  month: string;
  today: string;
  /** Primeiro dia com transacoes: semanas antes dele nao existem (nao sao "gasto zero"). */
  historyStart: string | null;
  cardIds: Set<string>;
  recurring: Set<string>;
}

async function base(ctx: AppContext, userId: ObjectId, now: Date): Promise<Base> {
  const tz = (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
  const first = await ctx.col.transactions.findOne({ userId, deletedAt: null }, { sort: { date: 1 }, projection: { date: 1 } });
  const cards = await ctx.col.accounts.find({ userId, type: 'CREDIT_CARD' }, { projection: { _id: 1 } }).toArray();
  return {
    tz,
    month: monthOf(now, tz),
    today: ymdIn(now, tz),
    historyStart: first ? ymdIn(first.date, tz) : null,
    cardIds: new Set(cards.map((a) => a._id.toHexString())),
    recurring: await recurringKeys(ctx.col, userId),
  };
}

const isRecurring = (b: Base, t: Pick<TransactionDoc, 'amountMinor' | 'counterpartyKey' | 'matchKey' | 'descriptionNorm'>) =>
  b.recurring.has(`${directionOf(t.amountMinor)}|${ruleKeyOf(t)}`);

/** Gasto variavel por dia (positivo): debito/Pix fora do cartao, sem parcelas nem recorrentes. */
async function dailyVariable(ctx: AppContext, userId: ObjectId, b: Base, from: Date): Promise<Map<string, number>> {
  const txs = await ctx.col.transactions
    .find(
      { userId, deletedAt: null, type: 'EXPENSE', installment: null, date: { $gte: from } },
      { projection: { date: 1, amountMinor: 1, accountId: 1, matchKey: 1, counterpartyKey: 1, descriptionNorm: 1 } },
    )
    .toArray();
  const daily = new Map<string, number>();
  for (const t of txs) {
    if (b.cardIds.has(t.accountId.toHexString()) || isRecurring(b, t)) continue;
    const d = ymdIn(t.date, b.tz);
    daily.set(d, (daily.get(d) ?? 0) - t.amountMinor);
  }
  return daily;
}

/** Semanas completas antes de ref (exclusivo), mais recentes primeiro; weeks[w][dow]. */
function weeksBefore(daily: Map<string, number>, ref: string, historyStart: string | null, n = WEEKS): number[][] {
  const out: number[][] = [];
  for (let k = 1; k <= n; k++) {
    const start = addDays(ref, -7 * k);
    if (!historyStart || start < historyStart) break;
    const week = Array<number>(7).fill(0);
    for (let j = 0; j < 7; j++) {
      const d = addDays(start, j);
      week[dowOf(d)] = daily.get(d) ?? 0;
    }
    out.push(week);
  }
  return out;
}

const sumDays = (daily: Map<string, number>, from: string, to: string) => {
  let s = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) s += daily.get(d) ?? 0;
  return s;
};
const dowsBetween = (from: string, to: string) => {
  const out: number[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(dowOf(d));
  return out;
};

/**
 * Backtest walk-forward: em cada mes fechado, nos dias 5, 10, 15, 20 e 25, preve o gasto variavel do
 * resto do mes so com o passado e compara com "igual ao mes passado" (proporcional aos dias).
 */
function backtest(daily: Map<string, number>, b: Base): BacktestPoint[] {
  const points: BacktestPoint[] = [];
  for (let i = 6; i >= 1; i--) {
    const m = addMonth(b.month, -i), prev = addMonth(m, -1);
    if (!b.historyStart || `${prev}-01` < b.historyStart) continue;
    const last = `${m}-${String(daysInMonth(m)).padStart(2, '0')}`;
    const prevTotal = sumDays(daily, `${prev}-01`, `${prev}-${String(daysInMonth(prev)).padStart(2, '0')}`);
    for (const d of [5, 10, 15, 20, 25]) {
      const ref = `${m}-${String(d + 1).padStart(2, '0')}`;
      const weeks = weeksBefore(daily, ref, b.historyStart);
      if (weeks.length < MIN_WEEKS) continue;
      const dows = dowsBetween(ref, last);
      const sims = simulateVariable(weeks, dows, 1000, seedOf(ref));
      points.push({
        actual: sumDays(daily, ref, last),
        baseline: prevTotal * (dows.length / daysInMonth(m)),
        model: { p10: quantile(sims, 0.1), p50: quantile(sims, 0.5), p90: quantile(sims, 0.9) },
      });
    }
  }
  return points;
}

async function balanceOf(ctx: AppContext, userId: ObjectId) {
  const removed = new Set((await ctx.col.connections.find({ userId, removedAt: { $ne: null } }, { projection: { _id: 1 } }).toArray()).map((c) => c._id.toHexString()));
  const accs = await ctx.col.accounts.find({ userId, type: { $in: ['CHECKING', 'SAVINGS'] } }, { projection: { balanceMinor: 1, connectionId: 1 } }).toArray();
  return accs.filter((a) => !removed.has(a.connectionId.toHexString())).reduce((s, a) => s + a.balanceMinor, 0);
}

/** Boletos a pagar em aberto, com valor decifrado. */
async function openBills(ctx: AppContext, userId: ObjectId) {
  const docs = await ctx.col.bills.find({ userId, status: { $in: ['pending', 'overdue'] } }).toArray();
  return docs.map((d) => ({ ...d, amountMinor: Number(ctx.crypto.decrypt(d.amountEnc)), payee: ctx.crypto.decrypt(d.payeeEnc) }));
}

/** Saldo no fim do mes: S_fim = S_d + receitas previstas - boletos - faturas - parcelas - fixas - variavel. */
export async function forecast(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<Forecast> {
  const b = await base(ctx, userId, now);
  const monthEndDay = `${b.month}-${String(daysInMonth(b.month)).padStart(2, '0')}`;
  const monthEndAt = monthStart(addMonth(b.month, 1), b.tz);
  const daily = await dailyVariable(ctx, userId, b, monthStart(addMonth(b.month, -7), b.tz));

  // O que ja se sabe.
  const rec = await ctx.col.recurrences.find({ userId, nextDate: { $gt: now, $lt: monthEndAt } }).toArray();
  const incomeMinor = rec.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amountMinor, 0);
  const recurringMinor = rec.filter((r) => r.direction === 'out' && !r.onCard).reduce((s, r) => s - r.amountMinor, 0);
  const invoices = await ctx.col.invoices
    .find({ userId, status: { $ne: 'PAID' }, dueDate: { $gte: new Date(now.getTime() - DAY), $lt: monthEndAt } })
    .toArray();
  const invoicesMinor = invoices.reduce((s, i) => s + Math.max(0, i.totalMinor - i.paidMinor), 0);
  const billsMinor = (await openBills(ctx, userId)).filter((x) => x.dueDate <= monthEndDay).reduce((s, x) => s + x.amountMinor, 0);
  // Parcelas fora do cartao (no cartao ja estao na fatura): a do mes ainda nao caiu.
  const inst = await ctx.col.transactions
    .aggregate<{ _id: string; n: number; total: number; amountMinor: number; date: Date; accountId: ObjectId }>([
      { $match: { userId, deletedAt: null, 'installment.groupId': { $exists: true }, date: { $gte: new Date(now.getTime() - 70 * DAY) } } },
      { $sort: { 'installment.n': -1 } },
      { $group: { _id: '$installment.groupId', n: { $first: '$installment.n' }, total: { $first: '$installment.total' }, amountMinor: { $first: '$amountMinor' }, date: { $first: '$date' }, accountId: { $first: '$accountId' } } },
    ])
    .toArray();
  const installmentsMinor = inst
    .filter((i) => !b.cardIds.has(i.accountId.toHexString()) && i.n < i.total && ymdIn(i.date, b.tz).slice(0, 7) < b.month)
    .reduce((s, i) => s + Math.abs(i.amountMinor), 0);
  const known = { incomeMinor, invoicesMinor, billsMinor, recurringMinor, installmentsMinor };
  const knownNet = incomeMinor - invoicesMinor - billsMinor - recurringMinor - installmentsMinor;

  const balanceMinor = await balanceOf(ctx, userId);
  const spentMinor = sumDays(daily, `${b.month}-01`, b.today);
  const remainingDows = b.today < monthEndDay ? dowsBetween(addDays(b.today, 1), monthEndDay) : [];
  const weeks = weeksBefore(daily, b.today, b.historyStart);
  const weeksOfHistory = b.historyStart ? Math.floor(daysBetween(b.historyStart, b.today) / 7) : 0;

  const ev = evaluate(backtest(daily, b));
  const status: Forecast['status'] = weeks.length < MIN_WEEKS || ev.n === 0 ? 'learning' : ev.beatsBaseline ? 'ready' : 'baseline';
  const out: Forecast = {
    month: b.month,
    status,
    needWeeks: status === 'learning' ? Math.max(1, MIN_WEEKS + 4 - weeksOfHistory) : 0,
    daysLeft: remainingDows.length,
    balanceMinor,
    range: null,
    probPositive: null,
    known,
    variable: { spentMinor, remaining: null },
    crossCheck: { profileTotalMinor: null, modelTotalMinor: null, divergent: false },
    backtest: {
      n: ev.n,
      maeModelMinor: ev.n ? round(ev.maeModel) : null,
      maeBaselineMinor: ev.n ? round(ev.maeBaseline) : null,
      coverage: ev.n ? ev.coverage : null,
    },
  };
  if (status !== 'ready') return out;

  const r = monthEnd({ balance: balanceMinor, knownNet, weeks, remainingDows, sims: 10_000, seed: seedOf(`${userId.toHexString()}:${b.today}`) });
  out.range = rangeInt(r);
  out.probPositive = r.probPositive;
  out.variable.remaining = rangeInt(r.variable);

  // Controle cruzado: perfil do mes (mediana dos ultimos 6 meses fechados).
  const months = Array.from({ length: 6 }, (_, i) => addMonth(b.month, -1 - i)).filter((m) => b.historyStart && `${m}-01` >= b.historyStart);
  const F = monthProfile(months.map((m) => Array.from({ length: daysInMonth(m) }, (_, d) => daily.get(`${m}-${String(d + 1).padStart(2, '0')}`) ?? 0)));
  const profileTotal = months.length ? profileEstimate(spentMinor, F[+b.today.slice(8) - 1]!) : null;
  const modelTotal = spentMinor + r.variable.p50;
  out.crossCheck = { profileTotalMinor: profileTotal === null ? null : round(profileTotal), modelTotalMinor: round(modelTotal), divergent: profileTotal !== null && diverges(profileTotal, modelTotal) };
  return out;
}

// ---------------------------------------------------------------------------------------------

/** Ultimos n meses fechados com historico completo (o mes em que o historico comeca fica de fora), mais antigo primeiro. */
const closedMonths = (b: Base, n: number) =>
  Array.from({ length: n }, (_, i) => addMonth(b.month, -n + i)).filter((m) => !!b.historyStart && `${m}-01` >= b.historyStart);

async function monthlyTotals(ctx: AppContext, userId: ObjectId, b: Base, months: string[]) {
  if (!months.length) return { income: new Map<string, number>(), expenses: new Map<string, number>() };
  const rows = await ctx.col.transactions
    .aggregate<{ _id: { m: string; type: string }; total: number }>([
      { $match: { userId, deletedAt: null, type: { $in: ['INCOME', 'EXPENSE'] }, date: { $gte: monthStart(months[0]!, b.tz), $lt: monthStart(b.month, b.tz) } } },
      { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$date', timezone: b.tz } }, type: '$type' }, total: { $sum: '$amountMinor' } } },
    ])
    .toArray();
  const income = new Map<string, number>(), expenses = new Map<string, number>();
  for (const r of rows) (r._id.type === 'INCOME' ? income : expenses).set(r._id.m, Math.abs(r.total));
  return { income, expenses };
}

/** Compromissos mensais fixos: recorrencias de saida (equivalente mensal) + parcelas em curso. */
async function fixedMonthly(ctx: AppContext, userId: ObjectId, now: Date) {
  const rec = await ctx.col.recurrences.find({ userId, direction: 'out' }).toArray();
  const recurring = rec.reduce((s, r) => s + Math.abs(r.amountMinor) * (r.period === 365 ? 1 / 12 : 30 / r.period), 0);
  const inst = await ctx.col.transactions
    .aggregate<{ amountMinor: number; n: number; total: number }>([
      { $match: { userId, deletedAt: null, 'installment.groupId': { $exists: true }, date: { $gte: new Date(now.getTime() - 40 * DAY) } } },
      { $sort: { 'installment.n': -1 } },
      { $group: { _id: '$installment.groupId', amountMinor: { $first: '$amountMinor' }, n: { $first: '$installment.n' }, total: { $first: '$installment.total' } } },
    ])
    .toArray();
  return recurring + inst.filter((i) => i.n < i.total).reduce((s, i) => s + Math.abs(i.amountMinor), 0);
}

/** Aporte mensal de cada meta: o planejado, ou o necessario (PMT sem rendimento) se nao houver plano. */
async function goalsMonthly(ctx: AppContext, userId: ObjectId, month: string) {
  const goals = await ctx.col.goals.find({ userId }).toArray();
  return goals.map((g) => {
    const months = Math.max(0, monthsBetween(month, g.deadline.slice(0, 7)) + 1);
    const required = pmt(g.targetMinor, g.savedMinor, 0, months);
    return { g, months, required, monthly: g.monthlyContributionMinor > 0 ? g.monthlyContributionMinor : required };
  });
}

/**
 * Orcamento sugerido: limites perto do habito (percentil 60), cabendo no que sobra da receita
 * mediana depois das contas fixas, parcelas e metas. Fixas e parcelas saem do historico das
 * categorias para nao contar duas vezes.
 */
export async function budgetSuggestion(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<BudgetSuggestion> {
  const b = await base(ctx, userId, now);
  const months = closedMonths(b, 6);
  const empty: BudgetSuggestion = { month: b.month, status: 'learning', months: months.length, incomeMedianMinor: 0, fixedMinor: 0, goalsMinor: 0, availableMinor: 0, fits: true, lines: [] };
  if (months.length < 2) return empty;

  const txs = await ctx.col.transactions
    .find(
      { userId, deletedAt: null, type: 'EXPENSE', installment: null, date: { $gte: monthStart(months[0]!, b.tz), $lt: monthStart(b.month, b.tz) } },
      { projection: { date: 1, amountMinor: 1, categoryKey: 1, matchKey: 1, counterpartyKey: 1, descriptionNorm: 1 } },
    )
    .toArray();
  const byCat = new Map<string, Map<string, number>>();
  for (const t of txs) {
    if (isRecurring(b, t)) continue;
    const m = ymdIn(t.date, b.tz).slice(0, 7), c = byCat.get(t.categoryKey) ?? new Map<string, number>();
    c.set(m, (c.get(m) ?? 0) - t.amountMinor);
    byCat.set(t.categoryKey, c);
  }
  const habits = [...byCat].map(([key, m]) => ({ key, monthly: months.map((x) => Math.max(0, m.get(x) ?? 0)) })).filter((h) => h.monthly.some((x) => x > 0));

  const { income } = await monthlyTotals(ctx, userId, b, months);
  const incomeMedianMinor = round(median(months.map((m) => income.get(m) ?? 0)));
  const fixedMinor = round(await fixedMonthly(ctx, userId, now));
  const goalsMinor = round((await goalsMonthly(ctx, userId, b.month)).reduce((s, x) => s + x.monthly, 0));
  const availableMinor = incomeMedianMinor - fixedMinor - goalsMinor;
  const { lines, fits } = suggestBudget(habits, Math.max(0, availableMinor));
  // Limites em reais redondos (R$ 10), sem passar do disponivel por arredondamento.
  const ten = (x: number) => Math.max(0, Math.floor(x / 1000) * 1000);
  return {
    month: b.month,
    status: 'ready',
    months: months.length,
    incomeMedianMinor,
    fixedMinor,
    goalsMinor,
    availableMinor,
    fits,
    lines: lines
      .map((l) => ({ categoryKey: l.key, q10Minor: round(l.q10), q60Minor: round(l.q60), cv: Math.round(l.cv * 100) / 100, limitMinor: ten(l.limit) }))
      .sort((a, b2) => b2.q60Minor - a.q60Minor),
  };
}

/** Chance de cada meta pelo bootstrap da sobra mensal, na ordem de prioridade (RN-M01). */
export async function goalInsights(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<GoalInsights> {
  const b = await base(ctx, userId, now);
  const months = closedMonths(b, 12);
  const { income, expenses } = await monthlyTotals(ctx, userId, b, months);
  const surpluses = months.map((m) => (income.get(m) ?? 0) - (expenses.get(m) ?? 0));
  const gm = await goalsMonthly(ctx, userId, b.month);
  const inputs = gm
    .filter((x) => x.g.targetMinor > x.g.savedMinor)
    .map((x) => ({ id: x.g._id.toHexString(), remaining: x.g.targetMinor - x.g.savedMinor, months: x.months, priority: x.g.priority ?? 3 }));
  const enough = surpluses.length >= 3;
  const chances = enough ? goalChances(inputs, surpluses, { sims: 4000, seed: seedOf(`${userId.toHexString()}:${b.month}`) }) : new Map<string, number>();

  // Categoria de estilo de vida com mais gasto: de onde a sugestao "a menos em ..." tira.
  const spend = await ctx.col.transactions
    .aggregate<{ _id: string; total: number }>([
      { $match: { userId, deletedAt: null, type: 'EXPENSE', date: { $gte: monthStart(addMonth(b.month, -3), b.tz), $lt: monthStart(b.month, b.tz) } } },
      { $group: { _id: '$categoryKey', total: { $sum: '$amountMinor' } } },
      { $sort: { total: 1 } },
    ])
    .toArray();
  const cut = spend.find((s) => CATEGORY_BY_KEY[s._id]?.group === 'lifestyle' && !['outros', 'pix-enviado'].includes(s._id))?._id ?? null;

  return {
    months: surpluses.length,
    goals: gm.map((x) => {
      const id = x.g._id.toHexString();
      const chance = x.g.savedMinor >= x.g.targetMinor ? 1 : enough ? (chances.get(id) ?? 0) : null;
      const extra = chance !== null && chance < 0.85 ? extraForChance(id, inputs, surpluses, 0.85, { sims: 800, seed: seedOf(id) }) : null;
      return {
        goalId: id,
        months: x.months,
        requiredMonthlyMinor: round(x.required),
        chance,
        extraFor85Minor: extra === null ? null : Math.ceil(extra / 1000) * 1000,
        cutCategory: cut,
      };
    }),
  };
}

/**
 * Contas a pagar: faturas e boletos em aberto na ordem de maior custo por real atrasado (mochila
 * fracionaria), com o custo de atrasar 30 dias e quanto o saldo atual cobre.
 */
export async function paymentPlan(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<PaymentPlan> {
  const b = await base(ctx, userId, now);
  const accounts = new Map((await ctx.col.accounts.find({ userId, type: 'CREDIT_CARD' }).toArray()).map((a) => [a._id.toHexString(), a]));
  const invoices = await ctx.col.invoices
    .find({ userId, status: { $ne: 'PAID' }, dueDate: { $gte: new Date(now.getTime() - 40 * DAY), $lt: new Date(now.getTime() + 35 * DAY) } })
    .toArray();
  const bills = await openBills(ctx, userId);
  const items = [
    ...invoices
      .filter((i) => i.totalMinor > i.paidMinor)
      .map((i) => ({
        kind: 'invoice' as const,
        id: i._id.toHexString(),
        label: `Fatura ${accounts.get(i.accountId.toHexString())?.name ?? 'do cartão'}`,
        dueDate: ymdIn(i.dueDate, b.tz),
        amountMinor: i.totalMinor - i.paidMinor,
        terms: CARD_TERMS,
      })),
    ...bills.map((x) => ({
      kind: 'bill' as const,
      id: x._id.toHexString(),
      label: x.payee,
      dueDate: x.dueDate,
      amountMinor: x.amountMinor,
      terms: { monthlyRate: x.monthlyInterest, fine: x.fine, iof: false },
    })),
  ];
  const available = await balanceOf(ctx, userId);
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = paymentOrder(items.map((i) => ({ id: i.id, amount: i.amountMinor, terms: i.terms })), available);
  const totalDueMinor = items.reduce((s, i) => s + i.amountMinor, 0);
  return {
    availableMinor: available,
    totalDueMinor,
    short: available < totalDueMinor,
    revolvingRateMonthly: REVOLVING_RATE,
    items: order.map((o) => {
      const it = byId.get(o.id)!;
      return {
        kind: it.kind,
        id: it.id,
        label: it.label,
        dueDate: it.dueDate,
        amountMinor: it.amountMinor,
        costPerReal: Math.round(o.costPerReal * 10000) / 10000,
        // Custo de atrasar o valor inteiro 30 dias (o "por que" da ordem).
        cost30Minor: round(it.amountMinor * o.costPerReal),
        payMinor: round(o.pay),
      };
    }),
  };
}
