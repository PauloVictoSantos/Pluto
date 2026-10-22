import { describe, expect, it } from 'vitest';
import { balanceAfter, cashVsInstallments, cetMonthly, debtPayoff, extraPaymentEffect, goalContribution, impliedMonthlyRate, monthlyFromAnnual, monthsToReach, payoffOrder, priceInstallment, roundHalfEven } from './finmath';

// Doc. Pluton 10.4: cada formula com casos de borda (taxa zero, prazo de 1 mes, valor ja atingido,
// parcelas maiores que a renda), centavos com arredondamento bancario.

describe('arredondamento bancario', () => {
  it('meio vai para o par', () => {
    expect([0.5, 1.5, 2.5, 3.5, -2.5].map(roundHalfEven)).toEqual([0, 2, 2, 4, -2]);
    expect(roundHalfEven(2.4999)).toBe(2);
    expect(roundHalfEven(2.5001)).toBe(3);
  });
});

describe('aporte mensal (PMT)', () => {
  it('casos de borda', () => {
    expect(goalContribution(120_000, 0, 0, 12)).toBe(10_000);
    expect(goalContribution(120_000, 0, 0.01, 1)).toBe(120_000);
    expect(goalContribution(120_000, 130_000, 0.01, 12)).toBe(0);
    expect(goalContribution(120_000, 20_000, 0, 0)).toBe(100_000);
  });
  it('rendimento reduz o aporte', () => {
    expect(goalContribution(1_000_000, 0, 0.01, 12)).toBe(78_849);
    expect(goalContribution(1_000_000, 0, 0.01, 12)).toBeLessThan(goalContribution(1_000_000, 0, 0, 12));
  });
});

describe('Price e CET', () => {
  it('parcela Price e taxa zero', () => {
    expect(priceInstallment(1_000_000, 0.02, 12)).toBe(94_560);
    expect(priceInstallment(1_000_000, 0, 4)).toBe(250_000);
    expect(() => priceInstallment(100, 0.01, 0)).toThrow();
  });
  it('CET recupera a taxa do financiamento e considera tarifas', () => {
    const p = priceInstallment(1_000_000, 0.02, 12);
    expect(cetMonthly([1_000_000, ...Array(12).fill(-p)])!).toBeCloseTo(0.02, 4);
    // Tarifa de R$ 300 descontada na liberacao: CET maior que a taxa nominal.
    expect(cetMonthly([970_000, ...Array(12).fill(-p)])!).toBeGreaterThan(0.02);
    expect(cetMonthly([100, 50])).toBeNull();
  });
});

describe('a vista com desconto x parcelado sem juros', () => {
  it('10% de desconto vence 10x sem juros com rendimento de 1% a.m.', () => {
    const r = cashVsInstallments(500_000, 0.1, 10, 0.01);
    expect(r.cashMinor).toBe(450_000);
    expect(r.best).toBe('cash');
    expect(r.installmentsPvMinor).toBeGreaterThan(450_000);
  });
  it('sem desconto, parcelar compensa quando o dinheiro rende', () => {
    expect(cashVsInstallments(500_000, 0, 10, 0.01).best).toBe('installments');
  });
});

describe('auxiliares', () => {
  it('taxa mensal equivalente e meses para atingir', () => {
    expect(monthlyFromAnnual(0.12682503)).toBeCloseTo(0.01, 6);
    expect(monthsToReach(100_000, 0, 10_000, 0)).toBe(10);
    expect(monthsToReach(100_000, 100_000, 0, 0)).toBe(0);
    expect(monthsToReach(100_000, 0, 0, 0)).toBeNull();
  });
});

describe('dividas com juros', () => {
  it('quita um Price no prazo e soma os juros', () => {
    const p = priceInstallment(1_000_000, 0.02, 12);
    const r = debtPayoff({ balanceMinor: 1_000_000, monthlyRate: 0.02, installmentMinor: p });
    expect(r.months).toBe(12);
    expect(r.totalInterestMinor).toBeGreaterThan(134_000);
    expect(r.totalInterestMinor).toBeLessThan(135_000);
    expect(r.monthlyInterestMinor).toBe(20_000);
  });
  it('parcela que nao cobre os juros nunca quita; saldo zero ja quitado', () => {
    expect(debtPayoff({ balanceMinor: 500_000, monthlyRate: 0.08, installmentMinor: 40_000 }).months).toBeNull();
    expect(debtPayoff({ balanceMinor: 500_000, monthlyRate: 0.08, installmentMinor: null })).toEqual({ months: null, totalInterestMinor: null, monthlyInterestMinor: 40_000 });
    expect(debtPayoff({ balanceMinor: 0, monthlyRate: 0.08, installmentMinor: 100 }).months).toBe(0);
    expect(debtPayoff({ balanceMinor: 120_000, monthlyRate: 0, installmentMinor: 10_000 })).toMatchObject({ months: 12, totalInterestMinor: 0 });
  });
  it('taxa implicita, saldo projetado e amortizacao extra', () => {
    const p = priceInstallment(1_000_000, 0.03, 24);
    expect(impliedMonthlyRate(1_000_000, p, 24)!).toBeCloseTo(0.03, 4);
    expect(impliedMonthlyRate(120_000, 10_000, 12)).toBe(0);
    expect(balanceAfter({ balanceMinor: 1_000_000, monthlyRate: 0.03, installmentMinor: p }, 24)).toBeLessThan(50);
    expect(balanceAfter({ balanceMinor: 1_000_000, monthlyRate: 0.03, installmentMinor: p }, 0)).toBe(1_000_000);
    const e = extraPaymentEffect({ balanceMinor: 1_000_000, monthlyRate: 0.03, installmentMinor: p }, 200_000);
    expect(e.interestSavedMinor!).toBeGreaterThan(0);
    expect(e.monthsSaved!).toBeGreaterThanOrEqual(5);
    expect(extraPaymentEffect({ balanceMinor: 500_000, monthlyRate: 0.08, installmentMinor: null }, 100_000)).toMatchObject({ interestSavedMinor: null, monthlyInterestSavedMinor: 8_000 });
  });
  it('avalanche: maior taxa primeiro', () => {
    const order = payoffOrder([
      { id: 'a', balanceMinor: 100, monthlyRate: 0.02, installmentMinor: 10 },
      { id: 'b', balanceMinor: 900, monthlyRate: 0.08, installmentMinor: 10 },
      { id: 'c', balanceMinor: 50, monthlyRate: 0.02, installmentMinor: 10 },
    ]);
    expect(order.map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });
});
