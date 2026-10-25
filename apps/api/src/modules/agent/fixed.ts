import { CATEGORY_BY_KEY, fixedDueError, monthlyEquivalent, type CreateFixedExpense, type FixedExpense, type FixedSuggestion, type UpdateFixedExpense } from '@pluto/shared';
import { detectMonthlyCharge, mean, stdDev } from '@pluto/finance-engine';
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

/**
 * Sugestoes a partir do extrato (doc. Melhorias, passo 7): saidas do mesmo estabelecimento que
 * aparecem em >= 3 dos ultimos 6 meses, uma vez por mes, com valor a +-10% e dia a +-3 dias.
 * Calculadas na leitura, entao refletem a ultima importacao. "Remover" grava a chave e ela nao volta.
 */
async function suggestions(ctx: AppContext, userId: ObjectId, used: Set<string>, tz: string, now: Date): Promise<FixedSuggestion[]> {
  const from = monthStart(addMonth(monthOf(now, tz), -6), tz);
  const [rows, dismissed] = await Promise.all([
    ctx.col.transactions
      .find(
        { userId, deletedAt: null, type: 'EXPENSE', amountMinor: { $lt: 0 }, date: { $gte: from }, installment: null },
        { projection: { date: 1, amountMinor: 1, counterpartyKey: 1, matchKey: 1, descriptionNorm: 1, merchant: 1, description: 1, categoryKey: 1 } },
      )
      .toArray(),
    ctx.col.fixedDismissals.find({ userId }, { projection: { key: 1 } }).toArray(),
  ]);
  const skip = new Set([...used, ...dismissed.map((d) => d.key)]);
  const groups = new Map<string, typeof rows>();
  for (const t of rows) {
    const key = t.counterpartyKey ?? t.matchKey ?? t.descriptionNorm;
    if (!key || skip.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const ymd = (d: Date) => new Date(d.getTime() + tzOffsetMs(d, tz)).toISOString().slice(0, 10);
  const cutoff = ymd(new Date(now.getTime() - 45 * 86_400_000));
  const out: (FixedSuggestion & { _last: string })[] = [];
  for (const [key, txs] of groups) {
    const cat = txs.at(-1)!.categoryKey ?? 'outros';
    if (!['essential', 'lifestyle'].includes(CATEGORY_BY_KEY[cat]?.group ?? '')) continue;
    const m = detectMonthlyCharge(txs.map((t) => ({ ymd: ymd(t.date), amountMinor: t.amountMinor })));
    // Serie viva: apareceu nos ultimos 45 dias.
    if (!m || m.lastYmd < cutoff) continue;
    const last = txs.reduce((a, b) => (b.date > a.date ? b : a));
    out.push({ matchKey: key, name: last.merchant ?? last.description, categoryKey: cat, amountMinor: m.meanMinor, recurrence: 'monthly', dueDay: m.day, months: m.months, _last: m.lastYmd });
  }
  return out
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, 8)
    .map(({ _last, ...s }) => s);
}

/** "Remover" uma sugestao: a chave fica guardada e nao e sugerida de novo. */
export async function dismissSuggestion(ctx: AppContext, userId: ObjectId, key: string) {
  await ctx.col.fixedDismissals.updateOne({ userId, key }, { $setOnInsert: { userId, key, createdAt: new Date() } }, { upsert: true });
  return listFixed(ctx, userId);
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
