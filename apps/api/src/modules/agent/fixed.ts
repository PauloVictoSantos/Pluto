import { CATEGORY_BY_KEY, fixedDueError, monthlyEquivalent, type CreateFixedExpense, type FixedExpense, type FixedRecurrence, type FixedSuggestion, type UpdateFixedExpense } from '@pluto/shared';
import { mean, stdDev } from '@pluto/finance-engine';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { FixedExpenseDoc } from '../../db/collections';
import { AppError, notFound } from '../../lib/errors';
import { addMonth, monthOf, monthStart, tzOffsetMs } from '../../lib/time';
import { listDebts } from '../debts/service';
import { listLoans } from './loans';
import { readProfile, suggestIncome } from './profile';

// Gastos fixos (doc. Pluton 3.1). As mesmas funcoes atendem a tela e, na etapa 8, as ferramentas do
// chat (GF-01): o modelo propoe, o backend valida e grava.

const tzOf = async (ctx: AppContext, userId: ObjectId) =>
  (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';

/**
 * GF-04: media e desvio padrao dos ultimos 3 meses fechados das saidas com estas descricoes.
 * Meses sem lancamento nao contam (a conta pode ainda nao ter chegado).
 */
export async function variableStats(ctx: AppContext, userId: ObjectId, keys: string[], now = new Date()) {
  const out = new Map<string, { meanMinor: number; stdMinor: number }>();
  if (!keys.length) return out;
  const tz = await tzOf(ctx, userId), cur = monthOf(now, tz);
  const rows = await ctx.col.transactions
    .aggregate<{ _id: { k: string; m: string }; total: number }>([
      { $match: { userId, deletedAt: null, amountMinor: { $lt: 0 }, matchKey: { $in: keys }, date: { $gte: monthStart(addMonth(cur, -3), tz), $lt: monthStart(cur, tz) } } },
      { $group: { _id: { k: '$matchKey', m: { $dateToString: { date: '$date', format: '%Y-%m', timezone: tz } } }, total: { $sum: '$amountMinor' } } },
    ])
    .toArray();
  for (const k of keys) {
    const xs = rows.filter((r) => r._id.k === k).map((r) => -r.total);
    if (xs.length) out.set(k, { meanMinor: Math.round(mean(xs)), stdMinor: xs.length > 1 ? Math.round(stdDev(xs)) : 0 });
  }
  return out;
}

const toDto = (d: FixedExpenseDoc): FixedExpense => ({
  id: d._id.toHexString(),
  name: d.name,
  categoryKey: d.categoryKey,
  amountMinor: d.amountMinor,
  isVariable: d.isVariable,
  amountStdMinor: d.amountStdMinor,
  dueDay: d.dueDay,
  dueMonth: d.dueMonth,
  recurrence: d.recurrence,
  endsOn: d.endsOn,
  source: d.source,
  matchKey: d.matchKey,
  monthlyMinor: monthlyEquivalent(d.amountMinor, d.recurrence),
  installment: null,
});

/** GF-06: parcelas e mensalidades de Contas a pagar que caem neste mes, como fixos temporarios. */
async function debtItems(ctx: AppContext, userId: ObjectId, now: Date): Promise<FixedExpense[]> {
  const sources = await listDebts(ctx, userId, now);
  return sources.flatMap((s) =>
    s.items
      .filter((c) => c.current)
      .map((c) => ({
        id: `divida:${c.id}`,
        name: c.merchant,
        categoryKey: c.categoryKey,
        amountMinor: c.current!.amountMinor,
        isVariable: false,
        amountStdMinor: null,
        dueDay: s.dueDay,
        dueMonth: null,
        recurrence: 'monthly' as const,
        endsOn: c.kind === 'installments' && c.installments ? addMonth(c.firstMonth, c.installments - 1) : c.lastMonth,
        source: 'divida' as const,
        matchKey: null,
        monthlyMinor: c.current!.amountMinor,
        installment: c.current!.n && c.current!.total ? { n: c.current!.n, total: c.current!.total } : null,
      })),
  );
}

/** GF-06: parcelas das dividas com juros, ate a ultima prevista. */
async function loanItems(ctx: AppContext, userId: ObjectId, now: Date): Promise<FixedExpense[]> {
  const { items } = await listLoans(ctx, userId, now);
  return items
    .filter((l) => l.installmentMinor && l.balanceMinor > 0)
    .map((l) => ({
      id: `juros:${l.id}`,
      name: l.creditor,
      categoryKey: 'dividas',
      amountMinor: l.installmentMinor!,
      isVariable: false,
      amountStdMinor: null,
      dueDay: l.dueDay,
      dueMonth: null,
      recurrence: 'monthly' as const,
      endsOn: l.endsOn,
      source: 'divida' as const,
      matchKey: null,
      monthlyMinor: l.installmentMinor!,
      installment: null,
    }));
}

const PERIOD: Partial<Record<number, FixedRecurrence>> = { 7: 'weekly', 30: 'monthly', 365: 'yearly' };

/** Recorrencias de saida detectadas no extrato que ainda nao sao fixos (o usuario confirma). */
async function suggestions(ctx: AppContext, userId: ObjectId, used: Set<string>, tz: string, now: Date): Promise<FixedSuggestion[]> {
  const recs = await ctx.col.recurrences.find({ userId, direction: 'out' }).toArray();
  return recs
    .filter((r) => PERIOD[r.period] && !used.has(r.key) && ['essential', 'lifestyle'].includes(CATEGORY_BY_KEY[r.categoryKey]?.group ?? ''))
    // Serie viva: a ultima ocorrencia foi ha no maximo 2 periodos.
    .filter((r) => now.getTime() - r.lastDate.getTime() <= 2 * r.period * 86_400_000)
    .sort((a, b) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor))
    .slice(0, 8)
    .map((r) => {
      const local = new Date(r.nextDate.getTime() + tzOffsetMs(r.nextDate, tz));
      const recurrence = PERIOD[r.period]!;
      return {
        matchKey: r.key,
        name: r.label,
        categoryKey: r.categoryKey,
        amountMinor: Math.abs(r.amountMinor),
        recurrence,
        dueDay: recurrence === 'weekly' ? local.getUTCDay() + 1 : local.getUTCDate(),
      };
    });
}

export async function listFixed(ctx: AppContext, userId: ObjectId, now = new Date()) {
  const tz = await tzOf(ctx, userId), month = monthOf(now, tz);
  const docs = await ctx.col.fixedExpenses.find({ userId, deletedAt: null }).sort({ createdAt: 1 }).toArray();
  // Valor variavel acompanha o extrato: a media dos ultimos 3 meses e recalculada na leitura.
  const stats = await variableStats(ctx, userId, docs.filter((d) => d.isVariable && d.matchKey).map((d) => d.matchKey!), now);
  for (const d of docs) {
    const s = d.isVariable && d.matchKey ? stats.get(d.matchKey) : undefined;
    if (s && (s.meanMinor !== d.amountMinor || s.stdMinor !== d.amountStdMinor)) {
      Object.assign(d, { amountMinor: s.meanMinor, amountStdMinor: s.stdMinor });
      await ctx.col.fixedExpenses.updateOne({ _id: d._id }, { $set: { amountMinor: s.meanMinor, amountStdMinor: s.stdMinor } });
    }
  }
  const items = [...docs.map(toDto), ...(await debtItems(ctx, userId, now)), ...(await loanItems(ctx, userId, now))];
  const active = items.filter((i) => !i.endsOn || i.endsOn >= month);
  const monthlyTotalMinor = active.reduce((t, i) => t + i.monthlyMinor, 0);
  const { profile } = await readProfile(ctx, userId);
  const incomeMinor = profile.netIncomeMinor ?? (await suggestIncome(ctx, userId, now));
  return {
    items: active,
    suggestions: await suggestions(ctx, userId, new Set(docs.map((d) => d.matchKey).filter((k): k is string => !!k)), tz, now),
    monthlyTotalMinor,
    incomeMinor,
    incomeShare: incomeMinor ? Math.round((monthlyTotalMinor / incomeMinor) * 1000) / 1000 : null,
  };
}

const badDue = (b: Parameters<typeof fixedDueError>[0]) => {
  const e = fixedDueError(b);
  if (e) throw new AppError(400, 'INVALID_DUE', e.message);
};

/** GF-04 na gravacao: com descricao do extrato e valor variavel, vale a media dos ultimos 3 meses. */
async function withStats(ctx: AppContext, userId: ObjectId, d: Pick<FixedExpenseDoc, 'isVariable' | 'matchKey' | 'amountMinor' | 'amountStdMinor'>) {
  if (!d.isVariable) return { amountMinor: d.amountMinor, amountStdMinor: null };
  const s = d.matchKey ? (await variableStats(ctx, userId, [d.matchKey])).get(d.matchKey) : undefined;
  return s ? { amountMinor: s.meanMinor, amountStdMinor: s.stdMinor } : { amountMinor: d.amountMinor, amountStdMinor: d.amountStdMinor };
}

export async function createFixed(ctx: AppContext, userId: ObjectId, body: CreateFixedExpense & { source: 'manual' | 'chat' }) {
  badDue({ recurrence: body.recurrence, dueDay: body.dueDay, dueMonth: body.dueMonth ?? null });
  const now = new Date();
  const base = { isVariable: body.isVariable ?? false, matchKey: body.matchKey ?? null, amountMinor: body.amountMinor, amountStdMinor: null };
  const doc: FixedExpenseDoc = {
    _id: new ObjectId(),
    userId,
    name: body.name,
    categoryKey: body.categoryKey,
    ...base,
    ...(await withStats(ctx, userId, base)),
    dueDay: body.dueDay,
    dueMonth: body.recurrence === 'yearly' ? (body.dueMonth ?? null) : null,
    recurrence: body.recurrence,
    endsOn: body.endsOn ?? null,
    source: body.source,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await ctx.col.fixedExpenses.insertOne(doc);
  return toDto(doc);
}

const own = async (ctx: AppContext, userId: ObjectId, id: string) => {
  const d = ObjectId.isValid(id) ? await ctx.col.fixedExpenses.findOne({ _id: new ObjectId(id), userId, deletedAt: null }) : null;
  if (!d) throw notFound('Gasto fixo');
  return d;
};

export async function updateFixed(ctx: AppContext, userId: ObjectId, id: string, body: UpdateFixedExpense) {
  const before = await own(ctx, userId, id);
  const merged = { ...before, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) } as FixedExpenseDoc;
  badDue(merged);
  if (merged.recurrence !== 'yearly') merged.dueMonth = null;
  Object.assign(merged, await withStats(ctx, userId, merged), { updatedAt: new Date() });
  const set: Partial<FixedExpenseDoc> = { ...merged };
  delete set._id;
  delete set.userId;
  delete set.createdAt;
  await ctx.col.fixedExpenses.updateOne({ _id: before._id }, { $set: set });
  return { before: toDto(before), after: toDto(merged) };
}

export async function removeFixed(ctx: AppContext, userId: ObjectId, id: string) {
  const d = await own(ctx, userId, id);
  await ctx.col.fixedExpenses.updateOne({ _id: d._id }, { $set: { deletedAt: new Date() } });
  return toDto(d);
}
