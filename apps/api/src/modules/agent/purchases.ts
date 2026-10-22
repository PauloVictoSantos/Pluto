import { evaluatePurchase, type PurchaseResult } from '@pluto/finance-engine';
import { MOOD_LABEL, type GoalAnswers, type PurchaseEvaluation, type PurchaseRequest } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../context';
import type { PurchaseEvaluationDoc } from '../../db/collections';
import { AppError, notFound } from '../../lib/errors';
import { monthOf } from '../../lib/time';
import { financialHealth } from '../analytics/health';
import { answerDraft, createDraft, goalsPlan } from './goals';
import { getLimit } from './limit';

// Avaliacao de compra (doc. Pluton 3.4 e 5.5). O motor decide; aqui se juntam os numeros do usuario
// e se escreve a justificativa. RECUSAR bloqueia "planejar"; comprar mesmo assim vira desvio.

const HOLD_MS = 72 * 3_600_000;
const brl = (minor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
const days = (n: number) => `${n} dia${n === 1 ? '' : 's'}`;
const ESSENTIAL = new Set(['renda', 'trabalho', 'saude', 'moradia']);

type Ctx = Awaited<ReturnType<typeof context>>;

/** Os numeros do usuario que entram no veredito. */
async function context(ctx: AppContext, userId: ObjectId, now: Date) {
  const tz = (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
  const [limit, health, plan] = await Promise.all([getLimit(ctx, userId, now), financialHealth(ctx, userId, now), goalsPlan(ctx, userId, now)]);
  const ind = (k: string) => health.indicators.find((i) => i.key === k)?.value ?? null;
  const income = limit.breakdown.incomeMinor;
  const fixedMinor = Math.round((ind('commitment') ?? 0) * income);
  const top = plan.goals.find((g) => g.status === 'ativa' && g.allocatedMinor > 0);
  // Resto do mes: ritmo tipico de gasto variavel (P80) proporcional aos dias que faltam.
  const typical = limit.typicalMinor ?? limit.spentMinor;
  const expectedRestMinor = Math.max(0, Math.round((typical / 30) * Math.max(0, limit.daysLeft - 1)));
  return {
    month: monthOf(now, tz),
    limit,
    income,
    fixedMinor,
    reserveMinor: Math.round((ind('reserve') ?? 0) * fixedMinor),
    containment: health.containment,
    freeMinor: plan.freeMinor,
    topGoal: top ? { name: top.name, monthlyMinor: top.allocatedMinor } : null,
    expectedRestMinor,
  };
}

function run(req: PurchaseRequest, c: Ctx, cooled = false) {
  return evaluatePurchase({
    priceMinor: req.priceMinor,
    payment: req.payment,
    installments: req.installments ?? null,
    monthlyRate: req.monthlyRate ?? null,
    essential: ESSENTIAL.has(req.reason),
    urgent: ESSENTIAL.has(req.reason) && req.urgency >= 4,
    mood: req.mood,
    incomeMinor: c.income,
    limitRemainingMinor: c.limit.remainingMinor,
    expectedRestMinor: c.expectedRestMinor,
    topGoal: c.topGoal,
    reserveMinor: c.reserveMinor,
    fixedMinor: c.fixedMinor,
    containment: c.containment,
    freeMinor: c.freeMinor,
    cooled,
  });
}

/** Veredito em frase, com o numero que o justifica (prompt do doc: "o numero que o justifica"). */
function explain(req: PurchaseRequest, r: PurchaseResult, c: Ctx): Pick<PurchaseEvaluation, 'headline' | 'explanation'> {
  const goal = c.topGoal?.name;
  const after = c.limit.remainingMinor - r.monthImpactMinor;
  const lines: string[] = [];
  let headline: string;
  switch (r.reason) {
    case 'urgencia-reserva':
      headline = `APROVAR usando a reserva: ${brl(r.reservePlan!.useMinor)} saem da reserva de emergência.`;
      lines.push(
        r.reservePlan!.months
          ? `Plano de recomposição: ${brl(r.reservePlan!.monthlyMinor)} por mês durante ${r.reservePlan!.months} mês(es).`
          : 'Hoje não sobra dinheiro no mês para recompor a reserva: o próximo passo é abrir espaço no orçamento.',
      );
      break;
    case 'juros-sem-reserva':
      headline = `RECUSAR: só de juros seriam ${brl(r.interestMinor)}, e sua reserva cobre menos de 3 meses de custo fixo.`;
      lines.push(`Parcela de ${brl(r.installmentMinor ?? 0)}. Juntar antes e pagar à vista evita esse custo.`);
      break;
    case 'contencao':
      headline = 'RECUSAR: sua saúde financeira está em modo de contenção, só gastos essenciais.';
      lines.push('Quando os indicadores voltarem para a faixa saudável, essa compra pode ser reavaliada.');
      break;
    case 'estoura-limite':
      headline = `RECUSAR: passa ${brl(r.monthImpactMinor - Math.max(0, c.limit.remainingMinor))} do limite do mês.`;
      lines.push(`Restam ${brl(Math.max(0, c.limit.remainingMinor))} no limite e a compra pesa ${brl(r.monthImpactMinor)} neste mês.`);
      lines.push('Dá para transformar em meta: o Plutão calcula quanto guardar por mês.');
      break;
    case 'atrasa-meta':
      headline = `ADIAR: cabe no limite, mas o resto do mês não. ${goal ? `Atrasa “${goal}” em ${days(r.goalDelayDays ?? 0)}.` : ''}`.trim();
      lines.push(`Depois dela sobram ${brl(after)}; no seu ritmo, o resto do mês pede cerca de ${brl(c.expectedRestMinor)}.`);
      break;
    case 'regra-72h':
      headline = 'ADIAR por 72 horas antes do veredito final.';
      lines.push(
        req.mood !== 'calmo'
          ? `Você disse: “${MOOD_LABEL[req.mood]}”. Faz sentido querer, e por isso mesmo vale esperar: decisão tomada na emoção costuma pesar depois.`
          : `É um desejo acima de 10% da sua renda (${brl(req.priceMinor)} de ${brl(c.income)}).`,
      );
      lines.push('Se em 72 horas ainda fizer sentido, o Plutão reavalia com os números do dia.');
      break;
    default:
      headline = `APROVAR: cabe no limite. Depois dela sobram ${brl(after)} até o fim do mês.`;
  }
  if (r.installmentMinor && r.reason !== 'juros-sem-reserva') lines.push(`Parcelado: ${brl(r.installmentMinor)} por mês também ocupam o limite dos próximos meses.`);
  // Custo de oportunidade em unidades concretas (5.5).
  const opp: string[] = [];
  if (r.goalDelayDays && goal && r.reason !== 'atrasa-meta') opp.push(`${days(r.goalDelayDays)} de aporte de “${goal}”`);
  if (r.reserveMonths && r.reserveMonths >= 0.1) opp.push(`${r.reserveMonths.toFixed(1).replace('.', ',')} mês(es) do seu custo fixo`);
  if (opp.length) lines.push(`Equivale a ${opp.join(' ou ')}.`);
  return { headline, explanation: lines };
}

const toDto = (d: PurchaseEvaluationDoc, now = new Date()): PurchaseEvaluation => ({
  ...d.result,
  id: d._id.toHexString(),
  status: d.status,
  holdUntil: d.holdUntil?.toISOString() ?? null,
  canPlan: d.verdict === 'aprovar' && d.status === 'avaliada' ? true : d.status === 'espera-72h' && !!d.holdUntil && d.holdUntil <= now,
  consequence: d.consequence,
  createdAt: d.createdAt.toISOString(),
});

function build(req: PurchaseRequest, r: PurchaseResult, c: Ctx) {
  return {
    description: req.description,
    priceMinor: req.priceMinor,
    payment: req.payment,
    verdict: r.verdict,
    reason: r.reason,
    ...explain(req, r, c),
    monthImpactMinor: r.monthImpactMinor,
    installmentMinor: r.installmentMinor,
    interestMinor: r.interestMinor,
    goalDelayDays: r.goalDelayDays,
    goalName: c.topGoal?.name ?? null,
    reservePlan: r.reservePlan,
  };
}

/** simular_compra: calcula sem gravar nada. */
export async function simulatePurchase(ctx: AppContext, userId: ObjectId, req: PurchaseRequest, now = new Date()): Promise<PurchaseEvaluation> {
  const c = await context(ctx, userId, now);
  const r = run(req, c);
  return { ...build(req, r, c), id: null, status: 'simulada', holdUntil: null, canPlan: false, consequence: null, createdAt: now.toISOString() };
}

export async function evaluateAndSave(ctx: AppContext, userId: ObjectId, req: PurchaseRequest, now = new Date()) {
  const c = await context(ctx, userId, now);
  const r = run(req, c);
  const doc: PurchaseEvaluationDoc = {
    _id: new ObjectId(),
    userId,
    month: c.month,
    request: req,
    verdict: r.verdict,
    reason: r.reason,
    result: build(req, r, c),
    monthImpactMinor: r.monthImpactMinor,
    status: r.hold72h ? 'espera-72h' : 'avaliada',
    holdUntil: r.hold72h ? new Date(now.getTime() + HOLD_MS) : null,
    consequence: null,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.col.purchaseEvaluations.insertOne(doc);
  return toDto(doc, now);
}

export async function listPurchases(ctx: AppContext, userId: ObjectId) {
  const now = new Date();
  return (await ctx.col.purchaseEvaluations.find({ userId }).sort({ createdAt: -1 }).limit(20).toArray()).map((d) => toDto(d, now));
}

const own = async (ctx: AppContext, userId: ObjectId, id: string) => {
  const d = await ctx.col.purchaseEvaluations.findOne({ _id: new ObjectId(id), userId });
  if (!d) throw notFound('Avaliação de compra');
  return d;
};

/** Planejar: so com APROVAR. Depois das 72 h, reavalia com os numeros do dia. */
export async function planPurchase(ctx: AppContext, userId: ObjectId, id: string, now = new Date()) {
  let d = await own(ctx, userId, id);
  if (d.status === 'espera-72h') {
    const left = (d.holdUntil?.getTime() ?? 0) - now.getTime();
    if (left > 0) throw new AppError(409, 'COOLING_OFF', `Faltam ${Math.ceil(left / 3_600_000)} horas da espera de 72 horas.`);
    const c = await context(ctx, userId, now);
    const r = run(d.request, c, true);
    const upd = { verdict: r.verdict, reason: r.reason, result: build(d.request, r, c), monthImpactMinor: r.monthImpactMinor, status: 'avaliada' as const, holdUntil: null, month: c.month, updatedAt: now };
    await ctx.col.purchaseEvaluations.updateOne({ _id: d._id }, { $set: upd });
    d = { ...d, ...upd };
  }
  if (d.status !== 'avaliada') throw new AppError(409, 'PURCHASE_CLOSED', 'Esta compra já foi decidida.');
  // RECUSAR (e ADIAR) bloqueiam o registro como planejada (3.4).
  if (d.verdict !== 'aprovar') throw new AppError(409, 'NOT_APPROVED', `${d.result.headline} Por isso ela não pode ser planejada. Você ainda pode registrar se comprar mesmo assim.`);
  await ctx.col.purchaseEvaluations.updateOne({ _id: d._id }, { $set: { status: 'planejada', updatedAt: now } });
  return toDto({ ...d, status: 'planejada' }, now);
}

/** Comprou: se estava planejada, ok; senao e desvio, com a consequencia recalculada. */
export async function boughtPurchase(ctx: AppContext, userId: ObjectId, id: string, now = new Date()) {
  const d = await own(ctx, userId, id);
  if (['comprada', 'desvio', 'desistiu'].includes(d.status)) throw new AppError(409, 'PURCHASE_CLOSED', 'Esta compra já foi decidida.');
  if (d.status === 'planejada') {
    await ctx.col.purchaseEvaluations.updateOne({ _id: d._id }, { $set: { status: 'comprada', updatedAt: now } });
    return toDto({ ...d, status: 'comprada' }, now);
  }
  const c = await context(ctx, userId, now);
  const after = c.limit.remainingMinor - d.monthImpactMinor;
  const consequence = [
    `Marcada como desvio do plano: o veredito era ${d.verdict.toUpperCase()}.`,
    after < 0 ? `O limite do mês fica ${brl(-after)} no negativo; esse valor sai das metas ou da margem de segurança.` : `Sobram ${brl(after)} no limite até o fim do mês.`,
  ];
  if (c.topGoal && c.topGoal.monthlyMinor > 0 && after < 0) consequence.push(`No ritmo atual, “${c.topGoal.name}” atrasa cerca de ${days(Math.ceil(-after / (c.topGoal.monthlyMinor / 30)))}.`);
  if (d.result.interestMinor > 0) consequence.push(`Os juros da compra somam ${brl(d.result.interestMinor)} até a última parcela.`);
  consequence.push('O dinheiro é seu: o Plutão recalculou o plano com essa compra.');
  await ctx.col.purchaseEvaluations.updateOne({ _id: d._id }, { $set: { status: 'desvio', consequence, updatedAt: now } });
  return toDto({ ...d, status: 'desvio', consequence }, now);
}

export async function giveUpPurchase(ctx: AppContext, userId: ObjectId, id: string, now = new Date()) {
  const d = await own(ctx, userId, id);
  if (['comprada', 'desvio'].includes(d.status)) throw new AppError(409, 'PURCHASE_CLOSED', 'Esta compra já foi feita.');
  await ctx.col.purchaseEvaluations.updateOne({ _id: d._id }, { $set: { status: 'desistiu', updatedAt: now } });
  return toDto({ ...d, status: 'desistiu' }, now);
}

/** Oferece o plano como meta: rascunho de compra com o que ja foi respondido. */
export async function purchaseToGoal(ctx: AppContext, userId: ObjectId, id: string) {
  const d = await own(ctx, userId, id);
  const q = d.request;
  const draft = await createDraft(ctx, userId, 'purchase', q.description);
  const answers: GoalAnswers = { targetMinor: q.priceMinor, paymentMethod: q.payment, reason: q.reason, urgency: q.urgency };
  if (q.installments) answers.installments = q.installments;
  if (q.monthlyRate != null) answers.monthlyRate = q.monthlyRate;
  return answerDraft(ctx, userId, draft.id, answers);
}
