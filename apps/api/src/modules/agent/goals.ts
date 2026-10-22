import {
  HIGH_INTEREST_MONTHLY,
  allocateCapacity,
  balanceAfter,
  cashVsInstallments,
  essentiality,
  financialImpact,
  goalContribution,
  monthsToReach,
  priceInstallment,
  priorityScore,
  validatedUrgency,
  viability,
  type GoalReason,
} from '@pluto/finance-engine';
import {
  GOAL_QUESTIONS,
  missingFields,
  type GoalAnswers,
  type GoalDiagnosis,
  type GoalDraft,
  type GoalKindV2,
  type GoalScenario,
  type GoalsPlan,
  type YearObjective,
} from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { GoalDoc, GoalDraftDoc } from '../../db/collections';
import { AppError, notFound } from '../../lib/errors';
import { tzOffsetMs } from '../../lib/time';
import { financialHealth } from '../analytics/health';
import { listFixed } from './fixed';
import { listLoans } from './loans';
import { readProfile } from './profile';

// Metas v2 (doc. Pluton 3.2, 4 e 5.4). O diagnostico e deterministico: todo numero vem daqui, o
// modelo (etapa 8) so conversa. A meta so nasce na confirmacao, com cronograma e justificativa.

const brl = (minor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',').replace(',0', '')}%`;
const ICON: Record<GoalKindV2, string> = { purchase: 'laptop', fixed: 'shield', debt_payoff: 'landmark', experience: 'plane' };
/** MT-08: objetivo do ano -> tipo de meta que ganha R = 1. */
const OBJECTIVE_KIND: Partial<Record<YearObjective, GoalKindV2>> = {
  'quitar-dividas': 'debt_payoff',
  'reserva-emergencia': 'fixed',
  investir: 'fixed',
  'comprar-bem': 'purchase',
  viajar: 'experience',
};

const today = async (ctx: AppContext, userId: ObjectId, now: Date) => {
  const tz = (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
  return new Date(now.getTime() + tzOffsetMs(now, tz)).toISOString().slice(0, 10);
};
const addMonthsDay = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
};
/** Meses inteiros entre hoje e a data (no minimo 1). */
const monthsUntil = (from: string, to: string) => Math.max(1, (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) - (+to.slice(8) < +from.slice(8) ? 1 : 0));
/** S -> prioridade 1..5 das telas antigas. */
const priorityOf = (s: number) => (s >= 0.7 ? 1 : s >= 0.55 ? 2 : s >= 0.4 ? 3 : s >= 0.25 ? 4 : 5);
/** Metas antigas sem S: estimado pela prioridade 1..5. */
const legacyScore = (g: GoalDoc) => g.score ?? Math.round(((6 - (g.priority ?? 3)) / 5) * 0.8 * 1000) / 1000;
const isActive = (g: GoalDoc) => !g.status || g.status === 'ativa';

function toDraft(d: GoalDraftDoc): GoalDraft {
  const missing = missingFields(d.kind, d.answers);
  return {
    id: d._id.toHexString(),
    kind: d.kind,
    title: d.title,
    status: d.status,
    answers: d.answers,
    missing,
    next: missing.slice(0, 2).map((f) => GOAL_QUESTIONS[f]),
    diagnosis: d.diagnosis,
    goalId: d.goalId?.toHexString() ?? null,
  };
}

const ownDraft = async (ctx: AppContext, userId: ObjectId, id: string) => {
  const d = await ctx.col.goalDrafts.findOne({ _id: new ObjectId(id), userId });
  if (!d) throw notFound('Rascunho de meta');
  return d;
};

export async function createDraft(ctx: AppContext, userId: ObjectId, kind: GoalKindV2, title: string) {
  const now = new Date();
  const doc: GoalDraftDoc = { _id: new ObjectId(), userId, kind, title, status: 'rascunho', answers: {}, diagnosis: null, goalId: null, discardReason: null, createdAt: now, updatedAt: now };
  await ctx.col.goalDrafts.insertOne(doc);
  return toDraft(doc);
}

export async function listDrafts(ctx: AppContext, userId: ObjectId) {
  return (await ctx.col.goalDrafts.find({ userId, status: { $in: ['rascunho', 'em-analise'] } }).sort({ updatedAt: -1 }).toArray()).map(toDraft);
}

export async function getDraft(ctx: AppContext, userId: ObjectId, id: string) {
  return toDraft(await ownDraft(ctx, userId, id));
}

/** Entrevista: grava as respostas; mudar qualquer resposta invalida o diagnostico anterior. */
export async function answerDraft(ctx: AppContext, userId: ObjectId, id: string, answers: GoalAnswers, now = new Date()) {
  const d = await ownDraft(ctx, userId, id);
  if (d.status === 'confirmada' || d.status === 'descartada') throw new AppError(409, 'DRAFT_CLOSED', 'Esta meta já foi decidida.');
  if (answers.targetDate && answers.targetDate <= (await today(ctx, userId, now))) throw new AppError(400, 'INVALID_DATE', 'A data alvo precisa ser no futuro.');
  if (answers.loanId && !(await ctx.col.loans.findOne({ _id: new ObjectId(answers.loanId), userId, deletedAt: null }))) throw notFound('Dívida');
  const merged = { ...d.answers, ...Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)) };
  await ctx.col.goalDrafts.updateOne({ _id: d._id }, { $set: { answers: merged, status: 'rascunho', diagnosis: null, updatedAt: now } });
  return toDraft({ ...d, answers: merged, status: 'rascunho', diagnosis: null });
}

/** Retrato financeiro usado no diagnostico e no plano das metas. */
async function snapshot(ctx: AppContext, userId: ObjectId, now: Date) {
  const [health, { profile }, fixed, loans, goals] = await Promise.all([
    financialHealth(ctx, userId, now),
    readProfile(ctx, userId),
    listFixed(ctx, userId, now),
    listLoans(ctx, userId, now),
    ctx.col.goals.find({ userId }).toArray() as Promise<GoalDoc[]>,
  ]);
  const ind = (k: string) => health.indicators.find((i) => i.key === k)?.value ?? null;
  return {
    health,
    capacityMinor: Math.max(0, Math.round(ind('capacity') ?? 0)),
    reserveMonths: ind('reserve'),
    fixedMinor: fixed.monthlyTotalMinor,
    refRate: profile.referenceRateMonthly,
    objective: profile.yearObjective,
    highInterest: loans.items.filter((l) => l.highInterest && l.balanceMinor > 0),
    loans: loans.items,
    goals,
  };
}

/** Diagnostico (etapa 3) e proposta (etapa 4): veredito, justificativa e ate 3 cenarios. */
export async function diagnoseDraft(ctx: AppContext, userId: ObjectId, id: string, now = new Date()) {
  const d = await ownDraft(ctx, userId, id);
  if (d.status === 'confirmada' || d.status === 'descartada') throw new AppError(409, 'DRAFT_CLOSED', 'Esta meta já foi decidida.');
  const missing = missingFields(d.kind, d.answers);
  // MT-02: sem entrevista completa nao ha diagnostico.
  if (missing.length) throw new AppError(409, 'INTERVIEW_INCOMPLETE', `Faltam respostas: ${missing.map((f) => GOAL_QUESTIONS[f].question).join(' ')}`);
  const a = d.answers, day = await today(ctx, userId, now), s = await snapshot(ctx, userId, now);
  const why: string[] = [];
  let payment: GoalDiagnosis['payment'] = null, financedInterestMinor: number | null = null;
  const savedMinor = a.savedMinor ?? 0;
  let targetMinor: number, targetDate: string, months: number, requiredMonthlyMinor: number;

  if (d.kind === 'fixed') {
    if (s.fixedMinor <= 0) throw new AppError(409, 'NO_FIXED', 'Cadastre seus gastos fixos para calcular o tamanho da reserva.');
    targetMinor = a.targetMonths! * s.fixedMinor;
    requiredMonthlyMinor = a.monthlyCapacityMinor!;
    months = monthsToReach(targetMinor, savedMinor, requiredMonthlyMinor, s.refRate) ?? 600;
    targetDate = addMonthsDay(day, Math.max(1, months));
    why.push(`Reserva de ${a.targetMonths} meses do custo fixo (${brl(s.fixedMinor)}/mês): ${brl(targetMinor)}.`);
    if (!a.liquidity) why.push('Reserva de emergência precisa de resgate imediato: prefira um lugar com liquidez diária.');
  } else if (d.kind === 'debt_payoff') {
    const loan = s.loans.find((l) => l.id === a.loanId);
    if (!loan) throw notFound('Dívida');
    targetMinor = loan.balanceMinor;
    targetDate = a.targetDate!;
    months = monthsUntil(day, targetDate);
    requiredMonthlyMinor = goalContribution(targetMinor, savedMinor, s.refRate, months);
    const paidUntil = (loan.installmentMinor ?? 0) * months - (loan.balanceMinor - balanceAfter({ balanceMinor: loan.balanceMinor, monthlyRate: loan.monthlyRate, installmentMinor: loan.installmentMinor }, months));
    const avoided = loan.totalInterestMinor !== null ? Math.max(0, loan.totalInterestMinor - paidUntil) : loan.monthlyInterestMinor * 12;
    why.push(`Quitar ${loan.creditor} (${pct(loan.monthlyRate)} ao mês) até ${targetDate} evita cerca de ${brl(avoided)} em juros${loan.totalInterestMinor === null ? ' no próximo ano' : ''}.`);
  } else {
    const price = a.targetMinor!;
    targetMinor = Math.round(price * (1 - (a.cashDiscount ?? 0)));
    targetDate = a.targetDate!;
    months = monthsUntil(day, targetDate);
    requiredMonthlyMinor = goalContribution(targetMinor, savedMinor, s.refRate, months);
    if (a.paymentMethod === 'installments' && a.installments) {
      payment = cashVsInstallments(price, a.cashDiscount ?? 0, a.installments, s.refRate);
      why.push(
        payment.best === 'cash'
          ? `À vista com ${pct(a.cashDiscount ?? 0)} de desconto sai ${brl(payment.savingMinor)} mais barato que ${a.installments}x sem juros, mesmo com o dinheiro rendendo.`
          : `Parcelar em ${a.installments}x sem juros e deixar o dinheiro rendendo sai ${brl(payment.savingMinor)} mais barato que à vista.`,
      );
    }
    if (a.paymentMethod === 'financed' && a.installments) {
      const p = priceInstallment(price, a.monthlyRate ?? 0, a.installments);
      financedInterestMinor = p * a.installments - price;
      why.push(`Financiar em ${a.installments}x a ${pct(a.monthlyRate ?? 0)} ao mês custaria ${brl(financedInterestMinor)} só de juros. Juntar antes e pagar à vista evita esse custo.`);
    }
    if (a.paymentMethod === 'card') why.push('No cartão, atrasar a fatura cai no rotativo (os juros mais altos do mercado). O plano é juntar e pagar à vista.');
    if (!a.priceResearched) why.push('O preço ainda não foi pesquisado em mais de um lugar: vale cotar antes de fechar o valor da meta.');
  }

  // Fatores do score (5.4).
  const reason = (a.reason ?? null) as GoalReason | null;
  const reserveLow = s.reserveMonths === null ? s.fixedMinor > 0 : s.reserveMonths < 3;
  const urgency = d.kind === 'fixed' ? (reserveLow ? 5 : 3) : (a.urgency ?? 3);
  const committedMinor = s.goals.filter(isActive).reduce((t, g) => t + (g.monthlyContributionMinor ?? 0), 0);
  const freeMinor = Math.max(0, s.capacityMinor - committedMinor);
  const factors = {
    U: validatedUrgency(urgency, d.kind, reason),
    E: essentiality(d.kind, reason),
    F: financialImpact(d.kind, reason),
    R: s.objective && OBJECTIVE_KIND[s.objective] === d.kind ? 1 : 0,
    A: Math.round(viability(freeMinor, requiredMonthlyMinor) * 1000) / 1000,
  };
  const score = priorityScore(factors);
  const discretionary = (d.kind === 'purchase' || d.kind === 'experience') && factors.E < 1;

  why.push(`Para chegar a ${brl(targetMinor)} até ${targetDate} são ${brl(requiredMonthlyMinor)} por mês.`);
  why.push(`Sobra no mês hoje: ${brl(s.capacityMinor)}; ${brl(committedMinor)} já vão para outras metas; livres: ${brl(freeMinor)}.`);
  if (factors.R) why.push('Está alinhada ao seu objetivo do ano: ganhou peso extra na prioridade.');

  // Regras de prioridade (MT-06, MT-07) e modo de contencao.
  let blocked: string | null = null;
  if (discretionary && s.health.containment) blocked = `Sua saúde financeira está em ${s.health.score} de 100 (modo de contenção): por enquanto só gastos essenciais.`;
  else if (discretionary && s.highInterest.length) {
    const top = s.highInterest[0]!;
    blocked = `Você tem dívida com juros acima de ${pct(HIGH_INTEREST_MONTHLY)} ao mês (${top.creditor}, ${pct(top.monthlyRate)}): são ${brl(top.monthlyInterestMinor)} de juros por mês. Quitar vem antes de metas de compra.`;
  } else if (discretionary && reserveLow)
    blocked = `Sua reserva cobre ${s.reserveMonths === null ? '0' : s.reserveMonths.toFixed(1).replace('.', ',')} mês(es) de custo fixo. Abaixo de 3 meses, a reserva vem antes de metas que não são essenciais.`;

  // Cenarios (MT-05): no prazo, adiar, reduzir ou pausar uma meta de menor prioridade.
  const scenarios: GoalScenario[] = [];
  if (!blocked && requiredMonthlyMinor <= freeMinor)
    scenarios.push({ key: 'no-prazo', label: 'No prazo', targetMinor, targetDate, monthlyMinor: requiredMonthlyMinor, note: `Cabe na sua sobra: ${brl(requiredMonthlyMinor)} por mês até ${targetDate}.`, pauseGoalId: null });
  if (blocked || requiredMonthlyMinor > freeMinor) {
    if (freeMinor > 0) {
      const m = monthsToReach(targetMinor, savedMinor, freeMinor, s.refRate);
      // Bloqueada por regra: comeca depois de resolver a prioridade (6 meses de folga).
      const extra = blocked ? 6 : 0;
      if (m !== null && m <= 240) {
        const monthly = blocked ? goalContribution(targetMinor, savedMinor, s.refRate, m + extra) : freeMinor;
        scenarios.push({
          key: 'adiar',
          label: 'Adiar',
          targetMinor,
          targetDate: addMonthsDay(day, m + extra),
          monthlyMinor: monthly,
          note: blocked ? `Começa depois de resolver a prioridade acima: ${brl(monthly)} por mês até ${addMonthsDay(day, m + extra)}.` : `Com o que sobra livre (${brl(freeMinor)}/mês), chega lá em ${m} meses.`,
          pauseGoalId: null,
        });
      }
      if (!blocked && d.kind !== 'fixed') {
        const reach = Math.round(savedMinor * (1 + s.refRate) ** months + (s.refRate ? (freeMinor * ((1 + s.refRate) ** months - 1)) / s.refRate : freeMinor * months));
        if (reach > savedMinor && reach < targetMinor)
          scenarios.push({ key: 'reduzir', label: 'Reduzir o valor', targetMinor: reach, targetDate, monthlyMinor: freeMinor, note: `Mantendo a data, dá para juntar ${brl(reach)}. ${a.alternative ? `A alternativa citada (“${a.alternative}”) pode caber.` : ''}`.trim(), pauseGoalId: null });
      }
    }
    if (!blocked) {
      const lower = s.goals
        .filter(isActive)
        .filter((g) => legacyScore(g) < score && (g.monthlyContributionMinor ?? 0) + freeMinor >= requiredMonthlyMinor)
        .sort((x, y) => legacyScore(x) - legacyScore(y))[0];
      if (lower)
        scenarios.push({ key: 'pausar', label: `Pausar “${lower.name}”`, targetMinor, targetDate, monthlyMinor: requiredMonthlyMinor, note: `“${lower.name}” tem prioridade menor; pausar libera ${brl(lower.monthlyContributionMinor ?? 0)} por mês.`, pauseGoalId: lower._id.toHexString() });
    }
  }
  const verdict: GoalDiagnosis['verdict'] = scenarios.some((x) => x.key === 'no-prazo') ? 'aprovar' : scenarios.length ? 'adiar' : 'recusar';
  if (blocked) why.unshift(blocked);
  if (verdict === 'recusar') why.push(s.capacityMinor <= 0 ? 'Hoje o mês não tem sobra: primeiro é preciso abrir espaço cortando fixos ou variáveis.' : 'A sobra livre está toda comprometida com metas de prioridade maior.');

  const diagnosis: GoalDiagnosis = {
    verdict,
    rationale: why,
    targetMinor,
    savedMinor,
    targetDate,
    months,
    requiredMonthlyMinor,
    capacityMinor: s.capacityMinor,
    committedMinor,
    freeMinor,
    score,
    factors,
    health: { score: s.health.score, containment: s.health.containment, reserveMonths: s.reserveMonths },
    payment,
    financedInterestMinor,
    scenarios: scenarios.slice(0, 3),
  };
  await ctx.col.goalDrafts.updateOne({ _id: d._id }, { $set: { status: 'em-analise', diagnosis, updatedAt: now } });
  return toDraft({ ...d, status: 'em-analise', diagnosis });
}

/** Confirmacao (etapa 5): grava a meta com cronograma e justificativa. */
export async function confirmDraft(ctx: AppContext, userId: ObjectId, id: string, key: GoalScenario['key'], now = new Date()) {
  const d = await ownDraft(ctx, userId, id);
  if (d.status !== 'em-analise' || !d.diagnosis) throw new AppError(409, 'NOT_DIAGNOSED', 'Faça o diagnóstico antes de confirmar.');
  const sc = d.diagnosis.scenarios.find((x) => x.key === key);
  if (!sc) throw new AppError(400, 'INVALID_SCENARIO', 'Esse cenário não foi proposto para esta meta.');
  const s = await snapshot(ctx, userId, now);
  // MT-04: a soma dos aportes nunca passa da capacidade (o "pausar" libera antes).
  const paused = sc.pauseGoalId ? new ObjectId(sc.pauseGoalId) : null;
  const committed = s.goals.filter((g) => isActive(g) && !(paused && g._id.equals(paused))).reduce((t, g) => t + (g.monthlyContributionMinor ?? 0), 0);
  if (committed + sc.monthlyMinor > s.capacityMinor) throw new AppError(409, 'OVER_CAPACITY', `Não cabe: sobram ${brl(Math.max(0, s.capacityMinor - committed))} por mês para metas. Refaça o diagnóstico.`);
  if (paused) await ctx.col.goals.updateOne({ _id: paused, userId }, { $set: { status: 'pausada', updatedAt: now } });
  const day = await today(ctx, userId, now);
  const goal: GoalDoc = {
    _id: new ObjectId(),
    userId,
    name: d.title,
    icon: ICON[d.kind],
    targetMinor: sc.targetMinor,
    savedMinor: d.diagnosis.savedMinor,
    deadline: sc.targetDate,
    monthlyContributionMinor: sc.monthlyMinor,
    priority: priorityOf(d.diagnosis.score),
    status: 'ativa',
    kind: d.kind,
    score: d.diagnosis.score,
    factors: d.diagnosis.factors,
    rationale: [...d.diagnosis.rationale, `Cenário escolhido: ${sc.label}. ${sc.note}`],
    startDate: day,
    draftId: d._id,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.col.goals.insertOne(goal);
  await ctx.col.goalDrafts.updateOne({ _id: d._id }, { $set: { status: 'confirmada', goalId: goal._id, updatedAt: now } });
  return { draft: toDraft({ ...d, status: 'confirmada', goalId: goal._id }), goalId: goal._id.toHexString(), pausedGoalId: sc.pauseGoalId, scenario: key };
}

export async function discardDraft(ctx: AppContext, userId: ObjectId, id: string, reason: string) {
  const d = await ownDraft(ctx, userId, id);
  if (d.status === 'confirmada') throw new AppError(409, 'DRAFT_CLOSED', 'Esta meta já foi criada.');
  await ctx.col.goalDrafts.updateOne({ _id: d._id }, { $set: { status: 'descartada', discardReason: reason, updatedAt: new Date() } });
  return toDraft({ ...d, status: 'descartada' });
}

/** Pausar, retomar ou concluir. Retomar respeita MT-04. */
export async function setGoalStatus(ctx: AppContext, userId: ObjectId, id: string, status: 'ativa' | 'pausada' | 'concluida', now = new Date()) {
  const g = (await ctx.col.goals.findOne({ _id: new ObjectId(id), userId })) as GoalDoc | null;
  if (!g) throw notFound('Meta');
  const before = g.status ?? 'ativa';
  if (status === 'ativa' && before !== 'ativa') {
    const s = await snapshot(ctx, userId, now);
    const committed = s.goals.filter(isActive).reduce((t, x) => t + (x.monthlyContributionMinor ?? 0), 0);
    if (committed + (g.monthlyContributionMinor ?? 0) > s.capacityMinor)
      throw new AppError(409, 'OVER_CAPACITY', `Não cabe retomar agora: sobram ${brl(Math.max(0, s.capacityMinor - committed))} por mês e a meta precisa de ${brl(g.monthlyContributionMinor ?? 0)}.`);
  }
  await ctx.col.goals.updateOne({ _id: g._id }, { $set: { status, updatedAt: now } });
  return { before, after: status };
}

/** Plano das metas: capacidade distribuida da maior para a menor prioridade (5.4, MT-04). */
export async function goalsPlan(ctx: AppContext, userId: ObjectId, now = new Date()): Promise<GoalsPlan> {
  const s = await snapshot(ctx, userId, now), day = await today(ctx, userId, now);
  const open = s.goals.filter((g) => g.status !== 'cancelada' && g.status !== 'concluida' && g.savedMinor < g.targetMinor);
  const required = (g: GoalDoc) =>
    g.monthlyContributionMinor && g.monthlyContributionMinor > 0 ? g.monthlyContributionMinor : g.deadline > day ? goalContribution(g.targetMinor, g.savedMinor, s.refRate, monthsUntil(day, g.deadline)) : g.targetMinor - g.savedMinor;
  const active = open.filter(isActive).map((g) => ({ id: g._id.toHexString(), score: legacyScore(g), requiredMinor: required(g), g }));
  const alloc = allocateCapacity(active, s.capacityMinor);
  const rows = alloc.goals.map((x) => ({
    goalId: x.id,
    name: x.g.name,
    status: (x.g.status ?? 'ativa') as GoalsPlan['goals'][number]['status'],
    score: x.score,
    requiredMinor: x.requiredMinor,
    allocatedMinor: x.allocatedMinor,
    waiting: x.waiting,
    note: !x.waiting ? 'Aporte coberto pela sua sobra.' : x.allocatedMinor > 0 ? `Só ${brl(x.allocatedMinor)} cabem: a sobra acabou nas metas de prioridade maior.` : 'Em espera: a sobra acabou nas metas de prioridade maior.',
  }));
  const pausedRows = open
    .filter((g) => g.status === 'pausada')
    .map((g) => ({ goalId: g._id.toHexString(), name: g.name, status: 'pausada' as const, score: legacyScore(g), requiredMinor: required(g), allocatedMinor: 0, waiting: true, note: 'Pausada: não recebe aporte.' }));
  return { capacityMinor: s.capacityMinor, allocatedMinor: s.capacityMinor - alloc.freeMinor, freeMinor: alloc.freeMinor, goals: [...rows, ...pausedRows] };
}
