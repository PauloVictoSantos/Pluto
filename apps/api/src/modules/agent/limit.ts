import { quantile, spendingLimit, usageThreshold, weeklyAllowance } from '@pluto/finance-engine';
import { CATEGORIES, type SpendingLimit } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { SpendingLimitDoc } from '../../db/collections';
import { audit } from '../../lib/audit';
import { addMonth, monthOf, monthStart, tzOffsetMs } from '../../lib/time';
import { listFixed } from './fixed';
import { readProfile } from './profile';

// Limite de gasto variavel do mes (doc. Pluton 3.3). O snapshot fica em spending_limits; o gasto e
// lido na hora. recalcLimit e a ferramenta "recalcular_limite": sempre auditada.

const tzOf = async (ctx: AppContext, userId: ObjectId) =>
  (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';

/** Parcelas de dividas tem categoria propria; o resto do gasto "de consumo" e variavel. */
const VARIABLE_KEYS = CATEGORIES.filter((c) => (c.group === 'essential' || c.group === 'lifestyle') && c.key !== 'dividas').map((c) => c.key);

/**
 * Gasto variavel por mes no intervalo: saidas de consumo, menos o que ja esta nos fixos (descricoes
 * vinculadas) e as partes de pagamento dividido (parcelas de Contas a pagar, ja contadas nos fixos).
 */
export async function variableByMonth(ctx: AppContext, userId: ObjectId, tz: string, from: Date, to: Date, fixedKeys: string[]) {
  const rows = await ctx.col.transactions
    .aggregate<{ _id: string; total: number }>([
      {
        $match: {
          userId,
          deletedAt: null,
          amountMinor: { $lt: 0 },
          categoryKey: { $in: VARIABLE_KEYS },
          matchKey: { $nin: fixedKeys },
          splitOf: null,
          date: { $gte: from, $lt: to },
        },
      },
      { $group: { _id: { $dateToString: { date: '$date', format: '%Y-%m', timezone: tz } }, total: { $sum: '$amountMinor' } } },
    ])
    .toArray();
  return new Map(rows.map((r) => [r._id, -r.total]));
}

/** Recalcula o limite do mes (LG-01/LG-03). Mantem a sobrescrita manual do mes. */
export async function recalcLimit(ctx: AppContext, userId: ObjectId, reason: string, now = new Date()) {
  const tz = await tzOf(ctx, userId), month = monthOf(now, tz);
  const [{ profile }, fixed, goals] = await Promise.all([
    readProfile(ctx, userId),
    listFixed(ctx, userId, now),
    ctx.col.goals.find({ userId, status: { $nin: ['pausada', 'concluida', 'cancelada'] } }, { projection: { targetMinor: 1, savedMinor: 1, monthlyContributionMinor: 1 } }).toArray(),
  ]);
  const incomeMinor = profile.netIncomeMinor ?? fixed.incomeMinor ?? 0;
  const goalsMinor = goals.filter((g) => g.savedMinor < g.targetMinor).reduce((t, g) => t + (g.monthlyContributionMinor ?? 0), 0);
  const r = spendingLimit({ incomeMinor, fixedMinor: fixed.monthlyTotalMinor, goalsMinor, safetyMarginPct: profile.safetyMarginPct });
  const nowAt = new Date();
  await ctx.col.spendingLimits.updateOne(
    { userId, month },
    {
      $set: {
        computedMinor: r.limitMinor,
        inputs: { incomeMinor, incomeKnown: incomeMinor > 0, fixedMinor: fixed.monthlyTotalMinor, goalsMinor, marginMinor: r.marginMinor, deficitMinor: r.deficitMinor },
        fixedKeys: fixed.items.map((i) => i.matchKey).filter((k): k is string => !!k),
        computedAt: nowAt,
      },
      $setOnInsert: { overrideMinor: null, createdAt: nowAt },
    },
    { upsert: true },
  );
  // A auditoria guarda o motivo e o resultado, nao a renda.
  await audit(ctx.col, 'limit.recalculated', userId, { month, reason, computedMinor: r.limitMinor });
  return ctx.col.spendingLimits.findOne({ userId, month }) as Promise<SpendingLimitDoc>;
}

export async function getLimit(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<SpendingLimit> {
  const tz = await tzOf(ctx, userId), month = monthOf(now, tz);
  const doc = (await ctx.col.spendingLimits.findOne({ userId, month })) ?? (await recalcLimit(ctx, userId, 'primeira leitura do mês', now));
  const spentMap = await variableByMonth(ctx, userId, tz, monthStart(month, tz), monthStart(addMonth(month, 1), tz), doc.fixedKeys);
  const spentMinor = spentMap.get(month) ?? 0;
  const history = await variableByMonth(ctx, userId, tz, monthStart(addMonth(month, -6), tz), monthStart(month, tz), doc.fixedKeys);
  const limitMinor = doc.overrideMinor ?? doc.computedMinor;
  const remainingMinor = limitMinor - spentMinor;
  const local = new Date(now.getTime() + tzOffsetMs(now, tz));
  const daysInMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  const w = weeklyAllowance(remainingMinor, daysInMonth - local.getUTCDate() + 1);
  const t = usageThreshold(spentMinor, limitMinor);
  const { incomeMinor, fixedMinor, goalsMinor, marginMinor, deficitMinor } = doc.inputs;
  const breakdown = { incomeMinor, fixedMinor, goalsMinor, marginMinor, deficitMinor };
  return {
    month,
    computedMinor: doc.computedMinor,
    overrideMinor: doc.overrideMinor,
    limitMinor,
    spentMinor,
    remainingMinor,
    usedPct: limitMinor > 0 ? Math.round((spentMinor / limitMinor) * 1000) / 1000 : spentMinor > 0 ? 1 : 0,
    weekMinor: w.weekMinor,
    dayMinor: w.dayMinor,
    weeksLeft: w.weeksLeft,
    breakdown,
    typicalMinor: history.size ? Math.round(quantile([...history.values()], 0.8)) : null,
    status: !doc.inputs.incomeKnown ? 'sem-renda' : t === 1 ? 'estourado' : t === 0.8 ? 'atencao' : 'ok',
    computedAt: doc.computedAt.toISOString(),
  };
}

/** LG-04: sobrescrita manual so vale para este mes; gera auditoria e alerta. */
export async function overrideLimit(ctx: AppContext, userId: ObjectId, amountMinor: number | null, ip: string | null, now = new Date()) {
  const month = monthOf(now, await tzOf(ctx, userId));
  const before = (await ctx.col.spendingLimits.findOne({ userId, month })) ?? (await recalcLimit(ctx, userId, 'sobrescrita manual', now));
  await ctx.col.spendingLimits.updateOne({ _id: before._id }, { $set: { overrideMinor: amountMinor } });
  await audit(ctx.col, 'limit.override', userId, { month, computedMinor: before.computedMinor, before: before.overrideMinor, after: amountMinor }, ip);
  if (amountMinor !== null) {
    const brl = (m: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(m / 100);
    await ctx.col.alerts.insertOne({
      _id: new ObjectId(),
      userId,
      type: 'limit_override',
      target: `limit-override:${month}:${now.getTime()}`,
      title: `Você definiu o limite do mês em ${brl(amountMinor)}`,
      body:
        amountMinor > before.computedMinor
          ? `O plano calculou ${brl(before.computedMinor)}. Gastar acima disso sai das metas ou da margem de segurança. No mês que vem o limite volta a ser calculado.`
          : `O plano calculou ${brl(before.computedMinor)}. Gastar menos acelera suas metas. No mês que vem o limite volta a ser calculado.`,
      pushText: 'Limite do mês alterado manualmente',
      action: { label: 'Ver limite', page: 'budget' },
      why: [`Limite calculado: ${brl(before.computedMinor)}`, `Limite definido por você: ${brl(amountMinor)}`, 'Regra LG-04: sobrescrita gera alerta e vale só para o mês'],
      score: 0,
      features: { type: 'limit_override', hour: 0, group: 'limit', amountMinor },
      dueToday: false,
      createdAt: now,
      readAt: null,
      sentAt: null,
      channels: [],
      feedback: null,
      feedbackAt: null,
    });
  }
}

/** LG-03: abre o limite do mes no dia 1 para quem tem perfil financeiro. */
export async function ensureMonthLimits(ctx: AppContext, now = new Date()) {
  let n = 0;
  for (const userId of await ctx.col.financialProfiles.distinct('userId')) {
    const month = monthOf(now, await tzOf(ctx, userId));
    if (await ctx.col.spendingLimits.findOne({ userId, month }, { projection: { _id: 1 } })) continue;
    await recalcLimit(ctx, userId, 'virada do mês', now);
    n++;
  }
  return n;
}
