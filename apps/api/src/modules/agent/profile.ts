import { PROFILE_DEFAULTS, type FinancialProfile, type UpdateFinancialProfile } from '@pluto/shared';
import { median } from '@pluto/finance-engine';
import type { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { FinancialProfileDoc } from '../../db/collections';
import { addMonth, monthOf, monthStart } from '../../lib/time';

/** Mediana das entradas dos ultimos 6 meses fechados (meses sem entrada nao contam). */
export async function suggestIncome(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<number | null> {
  const tz = (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
  const cur = monthOf(now, tz);
  const rows = await ctx.col.transactions
    .aggregate<{ _id: string; total: number }>([
      { $match: { userId, deletedAt: null, type: 'INCOME', date: { $gte: monthStart(addMonth(cur, -6), tz), $lt: monthStart(cur, tz) } } },
      { $group: { _id: { $dateToString: { date: '$date', format: '%Y-%m', timezone: tz } }, total: { $sum: '$amountMinor' } } },
    ])
    .toArray();
  const totals = rows.map((r) => r.total).filter((t) => t > 0);
  return totals.length ? Math.round(median(totals)) : null;
}

/** Perfil com os padroes preenchidos (documento ausente = perfil novo). */
export async function readProfile(ctx: AppContext, userId: ObjectId): Promise<{ doc: FinancialProfileDoc | null; profile: Omit<FinancialProfile, 'suggestedIncomeMinor'> }> {
  const doc = await ctx.col.financialProfiles.findOne({ userId });
  return {
    doc,
    profile: {
      netIncomeMinor: doc?.netIncomeEnc ? Number(ctx.crypto.decrypt(doc.netIncomeEnc)) : null,
      safetyMarginPct: doc?.safetyMarginPct ?? PROFILE_DEFAULTS.safetyMarginPct,
      yearObjective: doc?.yearObjective ?? null,
      referenceRateMonthly: doc?.referenceRateMonthly ?? PROFILE_DEFAULTS.referenceRateMonthly,
      updatedAt: doc?.updatedAt.toISOString() ?? null,
    },
  };
}

export async function getProfile(ctx: AppContext, userId: ObjectId): Promise<FinancialProfile> {
  const [{ profile }, suggestedIncomeMinor] = await Promise.all([readProfile(ctx, userId), suggestIncome(ctx, userId)]);
  return { ...profile, suggestedIncomeMinor };
}

/** Grava as mudancas; devolve o antes e o depois (sem a renda em claro) para a auditoria. */
export async function updateProfile(ctx: AppContext, userId: ObjectId, body: UpdateFinancialProfile) {
  const { profile: before } = await readProfile(ctx, userId);
  const now = new Date();
  const set: Partial<FinancialProfileDoc> = { updatedAt: now };
  if (body.netIncomeMinor !== undefined) set.netIncomeEnc = body.netIncomeMinor === null ? null : ctx.crypto.encrypt(String(body.netIncomeMinor));
  if (body.safetyMarginPct !== undefined) set.safetyMarginPct = body.safetyMarginPct;
  if (body.yearObjective !== undefined) set.yearObjective = body.yearObjective;
  if (body.referenceRateMonthly !== undefined) set.referenceRateMonthly = body.referenceRateMonthly;
  const insert: Partial<FinancialProfileDoc> = { createdAt: now };
  if (!('netIncomeEnc' in set)) insert.netIncomeEnc = null;
  if (!('safetyMarginPct' in set)) insert.safetyMarginPct = PROFILE_DEFAULTS.safetyMarginPct;
  if (!('yearObjective' in set)) insert.yearObjective = null;
  if (!('referenceRateMonthly' in set)) insert.referenceRateMonthly = PROFILE_DEFAULTS.referenceRateMonthly;
  await ctx.col.financialProfiles.updateOne({ userId }, { $set: set, $setOnInsert: insert }, { upsert: true });
  const { profile: after } = await readProfile(ctx, userId);
  // A auditoria registra so se a renda mudou, nunca o valor.
  const redact = ({ netIncomeMinor, updatedAt: _u, ...rest }: typeof before) => ({ ...rest, netIncomeSet: netIncomeMinor !== null });
  return { before: redact(before), after: { ...redact(after), netIncomeChanged: before.netIncomeMinor !== after.netIncomeMinor } };
}
