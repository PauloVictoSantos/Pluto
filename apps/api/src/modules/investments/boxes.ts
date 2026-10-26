import { annualRateOf, growthMinor, monthsToTarget, savingsAnnual } from '@pluto/finance-engine';
import type { InvestmentBox, InvestmentBoxes } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import { AppError, notFound } from '../../lib/errors';
import { marketRates } from '../../lib/marketRates';
import { readProfile } from '../agent/profile';

// Caixinhas e investimentos (tela Investimentos): um card por aplicacao com banco, saldo, taxa,
// quanto rende em 1 mes / 1 ano / 5 anos (bruto, antes do IR) e a meta a que esta ligada.
// Poupancas (contas SAVINGS) entram como caixinha tambem.

const offline = (async () => {
  throw new Error('sem rede nos testes');
}) as unknown as typeof fetch;

export async function listBoxes(ctx: AppContext, userId: ObjectId, fetchImpl?: typeof fetch): Promise<InvestmentBoxes> {
  const { profile } = await readProfile(ctx, userId);
  // Testes nao chamam a rede (a menos que passem um fetch falso).
  const rates = await marketRates(profile.referenceRateMonthly, fetchImpl ?? (ctx.env.NODE_ENV === 'test' ? offline : fetch));
  const fallback = Math.pow(1 + profile.referenceRateMonthly, 12) - 1;
  const conns = new Map((await ctx.col.connections.find({ userId }).toArray()).map((c) => [c._id.toHexString(), c]));
  const alive = (connectionId: ObjectId) => !conns.get(connectionId.toHexString())?.removedAt;
  const [invs, savings, goals] = await Promise.all([
    ctx.col.investments.find({ userId }).sort({ currentValueMinor: -1 }).toArray(),
    ctx.col.accounts.find({ userId, type: 'SAVINGS' }).toArray(),
    ctx.col.goals.find({ userId, status: { $nin: ['concluida', 'cancelada'] } }).toArray(),
  ]);

  const base: (Omit<InvestmentBox, 'goal' | 'projection'> & { goalId: ObjectId | null })[] = [
    ...invs
      .filter((i) => alive(i.connectionId) && i.currentValueMinor > 0)
      .map((i) => {
        const r = annualRateOf(i, rates, fallback);
        return {
          id: `inv:${i._id.toHexString()}`,
          kind: 'investimento' as const,
          name: i.name,
          institutionName: conns.get(i.connectionId.toHexString())?.institutionName ?? '',
          type: i.type,
          valueMinor: i.currentValueMinor,
          appliedMinor: i.appliedMinor,
          annualRate: r.annual,
          rateLabel: r.label,
          estimated: r.estimated,
          goalId: i.goalId ?? null,
        };
      }),
    ...savings
      .filter((a) => alive(a.connectionId) && a.balanceMinor > 0)
      .map((a) => ({
        id: `acc:${a._id.toHexString()}`,
        kind: 'poupanca' as const,
        name: /poup/i.test(a.name) ? a.name : `Poupança ${a.name}`,
        institutionName: conns.get(a.connectionId.toHexString())?.institutionName ?? '',
        type: 'SAVINGS',
        valueMinor: a.balanceMinor,
        appliedMinor: null,
        annualRate: savingsAnnual(rates),
        rateLabel: rates.selic > 0.085 ? 'Poupança: 0,5% ao mês' : 'Poupança: 70% da Selic',
        estimated: rates.source !== 'bcb',
        goalId: a.goalId ?? null,
      })),
  ];

  // Meta: soma das caixinhas ligadas a ela e quando chega no alvo (rendimento medio + aporte do mes).
  const byGoal = new Map<string, { saved: number; weighted: number }>();
  for (const b of base)
    if (b.goalId) {
      const k = b.goalId.toHexString(), g = byGoal.get(k) ?? { saved: 0, weighted: 0 };
      g.saved += b.valueMinor;
      g.weighted += b.valueMinor * b.annualRate;
      byGoal.set(k, g);
    }
  const items: InvestmentBox[] = base.map(({ goalId, ...b }) => {
    const g = goalId ? goals.find((x) => x._id.equals(goalId)) : undefined;
    const sum = g ? byGoal.get(g._id.toHexString())! : null;
    return {
      ...b,
      projection: { monthMinor: growthMinor(b.valueMinor, b.annualRate, 1), yearMinor: growthMinor(b.valueMinor, b.annualRate, 12), fiveYearsMinor: growthMinor(b.valueMinor, b.annualRate, 60) },
      goal:
        g && sum
          ? {
              id: g._id.toHexString(),
              name: g.name,
              targetMinor: g.targetMinor,
              deadline: g.deadline,
              savedMinor: sum.saved,
              monthlyMinor: g.monthlyContributionMinor ?? 0,
              monthsToTarget: monthsToTarget(sum.saved, g.targetMinor, sum.saved ? sum.weighted / sum.saved : 0, g.monthlyContributionMinor ?? 0),
            }
          : null,
    };
  });
  return {
    items,
    rates: { cdi: rates.cdi, selic: rates.selic, ipca: rates.ipca, source: rates.source, at: rates.at },
    goals: goals.map((g) => ({ id: g._id.toHexString(), name: g.name })),
  };
}

/** Liga (ou desliga, goalId null) uma caixinha a uma meta do usuario. */
export async function linkBoxGoal(ctx: AppContext, userId: ObjectId, boxId: string, goalId: string | null) {
  const m = /^(inv|acc):([a-f0-9]{24})$/.exec(boxId);
  if (!m) throw notFound('Caixinha');
  const gid = goalId ? new ObjectId(goalId) : null;
  if (gid && !(await ctx.col.goals.findOne({ _id: gid, userId }, { projection: { _id: 1 } }))) throw new AppError(404, 'NOT_FOUND', 'Meta não encontrada');
  const col = m[1] === 'inv' ? ctx.col.investments : ctx.col.accounts;
  const r = await (col as typeof ctx.col.investments).updateOne({ _id: new ObjectId(m[2]), userId }, { $set: { goalId: gid } });
  if (!r.matchedCount) throw notFound('Caixinha');
}
