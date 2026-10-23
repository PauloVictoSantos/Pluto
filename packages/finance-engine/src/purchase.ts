import { priceInstallment, roundHalfEven } from './finmath';

// Avaliacao de compra (doc. Pluton 3.4 e 5.5). Funcao pura: o backend junta os numeros, aqui se
// decide o veredito com o motivo e o numero que o justifica.

export type PurchaseVerdict = 'aprovar' | 'adiar' | 'recusar';
export type Mood = 'calmo' | 'estressado' | 'recompensa' | 'pressa';
export type PurchasePayment = 'cash' | 'installments' | 'financed' | 'card';

export interface PurchaseInput {
  priceMinor: number;
  payment: PurchasePayment;
  installments: number | null;
  /** Juros ao mes (financiado ou parcelado no cartao com juros). */
  monthlyRate: number | null;
  /** Saude, moradia/reparo essencial, trabalho ou renda. */
  essential: boolean;
  /** Urgencia real declarada (4 ou 5) em compra essencial. */
  urgent: boolean;
  mood: Mood;
  incomeMinor: number;
  /** O que ainda cabe no limite do mes (pode ser negativo). */
  limitRemainingMinor: number;
  /** Gasto variavel esperado ate o fim do mes, alem do ja gasto. */
  expectedRestMinor: number;
  /** Meta de maior prioridade (para "quantos dias ela atrasa"). */
  topGoal: { name: string; monthlyMinor: number } | null;
  reserveMinor: number;
  fixedMinor: number;
  containment: boolean;
  /** Sobra mensal livre (capacidade - metas), para recompor a reserva. */
  freeMinor: number;
  /** Ja passou pela espera de 72 h: nao aplica de novo. */
  cooled?: boolean;
}

export type PurchaseReason =
  | 'urgencia-reserva'
  | 'juros-sem-reserva'
  | 'contencao'
  | 'estoura-limite'
  | 'reserva-baixa'
  | 'atrasa-meta'
  | 'regra-72h'
  | 'cabe';

export interface PurchaseResult {
  verdict: PurchaseVerdict;
  reason: PurchaseReason;
  /** Quanto pesa no mes atual (a vista: o preco; parcelado: a parcela). */
  monthImpactMinor: number;
  installmentMinor: number | null;
  /** Juros totais se financiado/parcelado com juros. */
  interestMinor: number;
  /** Dias de atraso da meta principal (atrasa-meta, ou custo de oportunidade). */
  goalDelayDays: number | null;
  /** Custo de oportunidade: meses de custo fixo que o preco representa. */
  reserveMonths: number | null;
  /** Usar a reserva (urgencia real): quanto e em quantos meses recompor. */
  reservePlan: { useMinor: number; months: number | null; monthlyMinor: number } | null;
  /** Regra das 72 h aplicada. */
  hold72h: boolean;
}

/** 72 h (5.5): nao essencial acima de 10% da renda, ou compra feita sob emocao. */
export const needsCooling = (essential: boolean, priceMinor: number, incomeMinor: number, mood: Mood) =>
  !essential && (mood !== 'calmo' || (incomeMinor > 0 && priceMinor > incomeMinor * 0.1));

export function evaluatePurchase(i: PurchaseInput): PurchaseResult {
  const n = i.installments && i.payment !== 'cash' ? i.installments : null;
  const rate = i.payment === 'financed' || i.payment === 'card' ? (i.monthlyRate ?? 0) : 0;
  const installmentMinor = n ? priceInstallment(i.priceMinor, rate, n) : null;
  const interestMinor = n ? installmentMinor! * n - i.priceMinor : 0;
  const monthImpactMinor = installmentMinor ?? i.priceMinor;
  const dayOfGoal = i.topGoal && i.topGoal.monthlyMinor > 0 ? i.topGoal.monthlyMinor / 30 : null;
  const reserveMonths = i.fixedMinor > 0 ? Math.round((i.priceMinor / i.fixedMinor) * 10) / 10 : null;
  const reserveCover = i.fixedMinor > 0 ? i.reserveMinor / i.fixedMinor : 0;
  const base = { monthImpactMinor, installmentMinor, interestMinor, reserveMonths, reservePlan: null, hold72h: false };
  const delay = (minor: number) => (dayOfGoal ? Math.ceil(minor / dayOfGoal) : null);

  // Urgencia real (saude, trabalho, reparo essencial): se nao cabe no limite, usa a reserva com plano.
  if (i.essential && i.urgent && monthImpactMinor > i.limitRemainingMinor && i.reserveMinor > 0) {
    const useMinor = Math.min(i.reserveMinor, i.priceMinor - Math.max(0, i.limitRemainingMinor));
    return {
      ...base,
      verdict: 'aprovar',
      reason: 'urgencia-reserva',
      goalDelayDays: null,
      reservePlan: { useMinor, months: i.freeMinor > 0 ? Math.ceil(useMinor / i.freeMinor) : null, monthlyMinor: i.freeMinor },
    };
  }
  // Credito com juros e reserva abaixo de 3 meses: recusar mostrando o custo dos juros.
  if (interestMinor > 0 && reserveCover < 3) return { ...base, verdict: 'recusar', reason: 'juros-sem-reserva', goalDelayDays: delay(interestMinor) };
  // Modo de contencao: so essenciais.
  if (i.containment && !i.essential) return { ...base, verdict: 'recusar', reason: 'contencao', goalDelayDays: delay(i.priceMinor) };
  // Estoura o limite do mes.
  if (monthImpactMinor > i.limitRemainingMinor) return { ...base, verdict: 'recusar', reason: 'estoura-limite', goalDelayDays: delay(monthImpactMinor - Math.max(0, i.limitRemainingMinor)) };
  // MT-06 / 10.3: desejo com reserva abaixo de 3 meses espera; a reserva vem antes (compras pequenas passam).
  if (!i.essential && i.fixedMinor > 0 && reserveCover < 3 && i.priceMinor > i.incomeMinor * 0.02)
    return { ...base, verdict: 'adiar', reason: 'reserva-baixa', goalDelayDays: delay(i.priceMinor) };
  // Cabe no limite, mas o resto do mes nao: a diferenca sai das metas.
  const gap = i.expectedRestMinor - (i.limitRemainingMinor - monthImpactMinor);
  if (!i.essential && gap > 0 && i.topGoal) return { ...base, verdict: 'adiar', reason: 'atrasa-meta', goalDelayDays: delay(roundHalfEven(gap)) };
  if (!i.cooled && needsCooling(i.essential, i.priceMinor, i.incomeMinor, i.mood)) return { ...base, verdict: 'adiar', reason: 'regra-72h', goalDelayDays: delay(i.priceMinor), hold72h: true };
  return { ...base, verdict: 'aprovar', reason: 'cabe', goalDelayDays: delay(i.priceMinor) };
}
