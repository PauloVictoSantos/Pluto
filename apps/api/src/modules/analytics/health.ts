import { CONTAINMENT_BELOW, HEALTH_INDICATORS, HEALTH_WEIGHTS, healthBand, healthScore, isHealthy, mean, type HealthIndicator, type HealthValues } from '@pluto/finance-engine';
import type { FinancialHealth, HealthIndicatorDTO } from '@pluto/shared';
import type { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import { addMonth, monthOf, monthStart, tzOffsetMs } from '../../lib/time';
import { listFixed } from '../agent/fixed';
import { variableByMonth } from '../agent/limit';
import { readProfile } from '../agent/profile';

// Saude financeira 0-100 (doc. Pluton 5.2) com os indicadores do doc, todos dos dados reais:
// comprometimento, endividamento, cobertura da reserva, taxa e capacidade de poupanca.

const DAY = 86_400_000;
const brl = (minor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const RESERVE_GOAL = /reserva|emerg/i;

export async function financialHealth(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<FinancialHealth> {
  const { col } = ctx;
  const tz = (await col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
  const month = monthOf(now, tz);
  const ymd = (d: Date) => new Date(d.getTime() + tzOffsetMs(d, tz)).toISOString().slice(0, 10);
  const removed = new Set((await col.connections.find({ userId, removedAt: { $ne: null } }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id)));
  const cards = (await col.accounts.find({ userId, type: 'CREDIT_CARD' }).toArray()).filter((a) => !removed.has(String(a.connectionId)));
  const cardIds = cards.map((c) => c._id);

  const [{ profile }, fixed] = await Promise.all([readProfile(ctx, userId), listFixed(ctx, userId, now)]);
  const incomeMinor = profile.netIncomeMinor ?? fixed.incomeMinor ?? 0;
  const income = incomeMinor > 0 ? incomeMinor : null;

  // Compras parceladas nos cartoes do banco com parcelas por vir (as de Contas a pagar e dividas com
  // juros ja estao nos fixos).
  const groups = await col.transactions
    .aggregate<{ _id: string; n: number; total: number; amountMinor: number }>([
      { $match: { userId, deletedAt: null, 'installment.groupId': { $exists: true }, date: { $gte: new Date(now.getTime() - 40 * DAY), $lt: now } } },
      { $sort: { 'installment.n': -1 } },
      { $group: { _id: '$installment.groupId', n: { $first: '$installment.n' }, total: { $first: '$installment.total' }, amountMinor: { $first: '$amountMinor' } } },
    ])
    .toArray();
  const cardInstallmentsMinor = groups.filter((g) => g.n < g.total).reduce((s, g) => s + Math.abs(g.amountMinor), 0);
  const fixedMinor = fixed.monthlyTotalMinor + cardInstallmentsMinor;
  const debtMinor = fixed.items.filter((i) => i.source === 'divida').reduce((s, i) => s + i.monthlyMinor, 0) + cardInstallmentsMinor;

  // Reserva: metas de reserva de emergencia; sem elas, o total investido.
  const goals = await col.goals.find({ userId }).toArray();
  const reserveGoals = goals.filter((g) => RESERVE_GOAL.test(g.name));
  const invested = (await col.investments.find({ userId }, { projection: { currentValueMinor: 1, connectionId: 1 } }).toArray())
    .filter((i) => !removed.has(String(i.connectionId)))
    .reduce((s, i) => s + i.currentValueMinor, 0);
  const reserveMinor = reserveGoals.length ? reserveGoals.reduce((s, g) => s + g.savedMinor, 0) : invested;
  const reserveSource = reserveGoals.length ? 'na meta de reserva' : invested ? 'investidos' : null;

  // Poupanca: o que foi para investimentos nos 3 ultimos meses fechados (liquido de resgates);
  // sem movimento, os aportes planejados das metas.
  const from3 = monthStart(addMonth(month, -3), tz), curStart = monthStart(month, tz);
  const inv = await col.transactions
    .aggregate<{ total: number }>([
      { $match: { userId, deletedAt: null, categoryKey: 'investimentos', date: { $gte: from3, $lt: curStart } } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ])
    .toArray();
  const realSavings = Math.max(0, -(inv[0]?.total ?? 0)) / 3;
  const plannedSavings = goals.filter((g) => g.savedMinor < g.targetMinor && (!g.status || g.status === 'ativa')).reduce((s, g) => s + (g.monthlyContributionMinor ?? 0), 0);
  const savingsMinor = Math.round(realSavings || plannedSavings);

  const fixedKeys = fixed.items.map((i) => i.matchKey).filter((k): k is string => !!k);
  const variable = [...(await variableByMonth(ctx, userId, tz, from3, curStart, fixedKeys)).values()];
  const variableAvgMinor = variable.length ? Math.round(mean(variable)) : 0;
  const capacityMinor = incomeMinor - fixedMinor - variableAvgMinor;

  const values: HealthValues = {
    commitment: income ? fixedMinor / income : null,
    debt: income ? debtMinor / income : null,
    reserve: fixedMinor > 0 ? reserveMinor / fixedMinor : null,
    savingsRate: income ? savingsMinor / income : null,
    capacity: income ? capacityMinor / income : null,
  };
  const { score, parts } = healthScore(values);

  const TEXT: Record<HealthIndicator, { label: string; unit: HealthIndicatorDTO['unit']; target: string; desc: string; why: string }> = {
    commitment: {
      label: 'Comprometimento da renda',
      unit: 'pct',
      target: 'até 50% da renda',
      desc: `${brl(fixedMinor)} por mês em fixos e parcelas`,
      why: 'Gastos fixos + parcelas ÷ renda líquida. Acima de 50% sobra pouco para metas e imprevistos.',
    },
    debt: {
      label: 'Endividamento',
      unit: 'pct',
      target: 'até 30% da renda',
      desc: `${brl(debtMinor)} por mês em parcelas de dívidas e compras`,
      why: 'Parcelas de dívidas e compras parceladas ÷ renda líquida.',
    },
    reserve: {
      label: 'Cobertura da reserva',
      unit: 'months',
      target: '6 meses de custo fixo',
      desc: reserveSource ? `${brl(reserveMinor)} ${reserveSource}` : 'Nenhuma reserva encontrada',
      why: 'Quantos meses a reserva paga os fixos sem renda. Abaixo de 3 meses, a reserva vem antes de qualquer meta de compra.',
    },
    savingsRate: {
      label: 'Taxa de poupança',
      unit: 'pct',
      target: '15% da renda ou mais',
      desc: realSavings ? `${brl(savingsMinor)} por mês investidos (média de 3 meses)` : plannedSavings ? `${brl(savingsMinor)} por mês planejados nas metas` : 'Nada guardado nos últimos 3 meses',
      why: 'Quanto da renda vai para investimentos ou metas por mês.',
    },
    capacity: {
      label: 'Capacidade de poupança',
      unit: 'money',
      target: 'maior que zero',
      desc: `Renda − fixos − média de ${brl(variableAvgMinor)} em gastos variáveis`,
      why: 'O que sobra por mês depois dos fixos, parcelas e da média dos gastos variáveis dos últimos 3 meses.',
    },
  };
  const indicators: HealthIndicatorDTO[] = HEALTH_INDICATORS.map((k) => {
    const v = k === 'capacity' ? (income ? capacityMinor : null) : values[k];
    return {
      key: k,
      ...TEXT[k],
      value: v === null ? null : k === 'capacity' ? v : Math.round(v * 1000) / 1000,
      points: parts[k] === null ? null : Math.round(parts[k]! * 100),
      weight: HEALTH_WEIGHTS[k],
      healthy: values[k] === null ? null : isHealthy(k, values[k]!),
    };
  });

  // Sinais extras: pagamentos em dia nos ultimos 90 dias e uso do limite dos cartoes hoje.
  const from90 = new Date(now.getTime() - 90 * DAY);
  const invoices = await col.invoices.find({ userId, accountId: { $in: cardIds }, dueDate: { $gte: from90, $lt: now } }).toArray();
  const bills = await col.bills.find({ userId, dueDate: { $gte: ymd(from90), $lt: ymd(now) } }).toArray();
  const paid = invoices.filter((i) => i.status === 'PAID' || i.status === 'CLOSED').length + bills.filter((b) => b.status === 'paid' && (!b.paidAt || ymd(b.paidAt) <= b.dueDate)).length;
  const due = invoices.length + bills.length;
  const limitMinor = cards.reduce((s, c) => s + (c.creditLimitMinor ?? 0), 0);
  const usedMinor = cards.reduce((s, c) => s + (c.creditLimitMinor != null && c.availableCreditMinor != null ? c.creditLimitMinor - c.availableCreditMinor : Math.max(0, c.balanceMinor)), 0);

  // Historico mensal da nota: guarda a do mes e compara com a do mes anterior.
  if (score !== null) await col.healthSnapshots.updateOne({ userId, month }, { $set: { score, at: now } }, { upsert: true });
  const prev = await col.healthSnapshots.findOne({ userId, month: addMonth(month, -1) });
  const band = score === null ? null : healthBand(score);
  return {
    score,
    prevScore: prev?.score ?? null,
    band: band && { key: band.key, label: band.label, from: band.from, to: Math.min(band.to, 100) },
    containment: score !== null && score < CONTAINMENT_BELOW,
    incomeKnown: income !== null,
    indicators,
    onTime: { pct: due ? paid / due : null, paid, due },
    limitUse: { pct: limitMinor > 0 ? usedMinor / limitMinor : null, usedMinor, limitMinor },
  };
}

export const describeIndicator = (i: HealthIndicatorDTO) =>
  i.value === null ? 'sem dado' : i.unit === 'pct' ? pct(i.value) : i.unit === 'months' ? `${i.value.toFixed(1).replace('.', ',')} meses` : brl(i.value);
