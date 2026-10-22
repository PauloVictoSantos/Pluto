import { describe, expect, it } from 'vitest';
import { cashVsInstallments, cetMonthly, goalContribution, monthlyFromAnnual, monthsToReach, priceInstallment, roundHalfEven } from './finmath';

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
