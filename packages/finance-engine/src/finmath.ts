// Matematica financeira do agente (doc. Pluton, secao 5.1). Valores em centavos; arredondamento
// bancario (half-even) so no resultado final em centavos.

/** Arredondamento bancario: 0,5 vai para o par mais proximo (2,5 -> 2; 3,5 -> 4). */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

/**
 * Aporte mensal para chegar a VF em n meses partindo de VP, rendendo i ao mes:
 * PMT = (VF - VP(1+i)^n) i / ((1+i)^n - 1). Ja atingido: 0. Taxa zero: (VF - VP) / n.
 */
export function goalContribution(targetMinor: number, savedMinor: number, monthlyRate: number, months: number): number {
  if (savedMinor >= targetMinor) return 0;
  if (months <= 0) return targetMinor - savedMinor;
  if (monthlyRate === 0) return roundHalfEven((targetMinor - savedMinor) / months);
  const g = (1 + monthlyRate) ** months;
  return Math.max(0, roundHalfEven(((targetMinor - savedMinor * g) * monthlyRate) / (g - 1)));
}

/** Parcela de financiamento (Price): P = PV i(1+i)^n / ((1+i)^n - 1). Taxa zero: PV / n. */
export function priceInstallment(principalMinor: number, monthlyRate: number, n: number): number {
  if (n <= 0) throw new RangeError('Número de parcelas precisa ser maior que zero');
  if (monthlyRate === 0) return roundHalfEven(principalMinor / n);
  const g = (1 + monthlyRate) ** n;
  return roundHalfEven((principalMinor * monthlyRate * g) / (g - 1));
}

/** Valor presente de um fluxo, descontado a i ao mes (fluxo[t] no mes t). */
export const presentValueOf = (flows: readonly number[], i: number) => flows.reduce((s, f, t) => s + f / (1 + i) ** t, 0);

/**
 * Custo efetivo total (CET) mensal: a taxa i que zera o fluxo, por Newton-Raphson. Fluxo do ponto de
 * vista de quem recebe o credito: valor liberado positivo no mes 0, parcelas negativas depois.
 * null se nao converge (fluxo sem troca de sinal).
 */
export function cetMonthly(flows: readonly number[], guess = 0.02): number | null {
  if (!flows.some((f) => f > 0) || !flows.some((f) => f < 0)) return null;
  let i = guess;
  for (let k = 0; k < 100; k++) {
    let f = 0, df = 0;
    flows.forEach((c, t) => {
      f += c / (1 + i) ** t;
      df -= (t * c) / (1 + i) ** (t + 1);
    });
    if (Math.abs(df) < 1e-12) return null;
    const next = i - f / df;
    if (!Number.isFinite(next) || next <= -0.99) return null;
    if (Math.abs(next - i) < 1e-10) return next;
    i = next;
  }
  return null;
}

/** Taxa mensal equivalente a uma anual: (1 + a)^(1/12) - 1. */
export const monthlyFromAnnual = (annual: number) => (1 + annual) ** (1 / 12) - 1;

export interface CashVsInstallments {
  /** Preco a vista com desconto. */
  cashMinor: number;
  /** Valor presente das parcelas sem juros, descontadas pelo rendimento do dinheiro guardado. */
  installmentsPvMinor: number;
  best: 'cash' | 'installments';
  /** Quanto se economiza (em valor presente) escolhendo a melhor. */
  savingMinor: number;
}

/**
 * A vista com desconto d x parcelado sem juros em n vezes: parcelar so compensa se o rendimento do
 * dinheiro guardado (r ao mes) superar o desconto. VP = soma P/(1+r)^t, t = 1..n.
 */
export function cashVsInstallments(priceMinor: number, discount: number, n: number, monthlyRate: number): CashVsInstallments {
  const cashMinor = roundHalfEven(priceMinor * (1 - discount));
  const p = priceMinor / n;
  let pv = 0;
  for (let t = 1; t <= n; t++) pv += p / (1 + monthlyRate) ** t;
  const installmentsPvMinor = roundHalfEven(pv);
  const best = cashMinor <= installmentsPvMinor ? 'cash' : 'installments';
  return { cashMinor, installmentsPvMinor, best, savingMinor: Math.abs(installmentsPvMinor - cashMinor) };
}

/** Meses para juntar o que falta guardando PMT por mes a i ao mes (null se nunca chega). */
export function monthsToReach(targetMinor: number, savedMinor: number, monthlyMinor: number, monthlyRate: number): number | null {
  if (savedMinor >= targetMinor) return 0;
  if (monthlyMinor <= 0 && monthlyRate <= 0) return null;
  let v = savedMinor;
  for (let m = 1; m <= 1200; m++) {
    v = v * (1 + monthlyRate) + monthlyMinor;
    if (v >= targetMinor) return m;
  }
  return null;
}

/** MT-07: divida acima de 2% a.m. vem antes de qualquer meta de compra. */
export const HIGH_INTEREST_MONTHLY = 0.02;

export interface DebtTerms {
  balanceMinor: number;
  monthlyRate: number;
  /** Parcela mensal; null = sem parcela fixa (rotativo, cheque especial). */
  installmentMinor: number | null;
}

export interface DebtPayoff {
  /** Meses ate quitar; null se a parcela nao cobre os juros (a divida nunca acaba). */
  months: number | null;
  totalInterestMinor: number | null;
  /** Juros do proximo mes sobre o saldo atual. */
  monthlyInterestMinor: number;
}

/** Amortizacao mes a mes: juros (half-even) sobre o saldo, depois a parcela. */
export function debtPayoff(d: DebtTerms, maxMonths = 600): DebtPayoff {
  const monthlyInterestMinor = roundHalfEven(d.balanceMinor * d.monthlyRate);
  if (d.balanceMinor <= 0) return { months: 0, totalInterestMinor: 0, monthlyInterestMinor: 0 };
  if (!d.installmentMinor || d.installmentMinor <= monthlyInterestMinor) return { months: null, totalInterestMinor: null, monthlyInterestMinor };
  let bal = d.balanceMinor, interest = 0;
  for (let m = 1; m <= maxMonths; m++) {
    const j = roundHalfEven(bal * d.monthlyRate);
    interest += j;
    bal += j - d.installmentMinor;
    // Centavos que sobram do arredondamento da parcela entram na ultima.
    if (bal <= d.installmentMinor * 0.005) return { months: m, totalInterestMinor: interest, monthlyInterestMinor };
  }
  return { months: null, totalInterestMinor: null, monthlyInterestMinor };
}

/** Saldo depois de pagar `months` parcelas (estimativa entre atualizacoes do usuario). */
export function balanceAfter(d: DebtTerms, months: number): number {
  let bal = d.balanceMinor;
  for (let m = 0; m < months && bal > 0; m++) bal = bal + roundHalfEven(bal * d.monthlyRate) - (d.installmentMinor ?? 0);
  return Math.max(0, bal);
}

/** Taxa mensal implicita de um parcelamento (saldo hoje, n parcelas iguais). */
export const impliedMonthlyRate = (balanceMinor: number, installmentMinor: number, n: number) =>
  installmentMinor * n <= balanceMinor ? 0 : cetMonthly([balanceMinor, ...Array<number>(n).fill(-installmentMinor)], 0.03);

/** Juros evitados e meses a menos amortizando `extraMinor` hoje. */
export function extraPaymentEffect(d: DebtTerms, extraMinor: number) {
  const base = debtPayoff(d), after = debtPayoff({ ...d, balanceMinor: Math.max(0, d.balanceMinor - extraMinor) });
  if (base.totalInterestMinor === null || after.totalInterestMinor === null) {
    // Sem fim previsto: o ganho imediato e o juro do mes que deixa de incidir sobre o valor amortizado.
    return { interestSavedMinor: null, monthsSaved: null, monthlyInterestSavedMinor: roundHalfEven(Math.min(extraMinor, d.balanceMinor) * d.monthlyRate) };
  }
  return { interestSavedMinor: base.totalInterestMinor - after.totalInterestMinor, monthsSaved: base.months! - after.months!, monthlyInterestSavedMinor: roundHalfEven(Math.min(extraMinor, d.balanceMinor) * d.monthlyRate) };
}

/** Ordem de quitacao (avalanche): maior taxa primeiro; empate, menor saldo. */
export const payoffOrder = <T extends DebtTerms>(debts: readonly T[]) =>
  [...debts].sort((a, b) => b.monthlyRate - a.monthlyRate || a.balanceMinor - b.balanceMinor);
