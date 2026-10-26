import { describe, expect, it } from 'vitest';
import { annualRateOf, growthMinor, monthsToTarget, savingsAnnual } from './yield';

const M = { cdi: 0.14, selic: 0.1415, ipca: 0.045 };

describe('rendimento das caixinhas', () => {
  it('taxa anual pelo indice', () => {
    expect(annualRateOf({ rate: 100, rateType: 'CDI' }, M, 0.1)).toEqual({ annual: 0.14, label: '100% do CDI', estimated: false });
    expect(annualRateOf({ rate: 110, rateType: 'CDI' }, M, 0.1).annual).toBeCloseTo(0.154);
    expect(annualRateOf({ rateType: 'IPCA', fixedAnnualRate: 6 }, M, 0.1).annual).toBeCloseTo(1.045 * 1.06 - 1);
    expect(annualRateOf({ fixedAnnualRate: 12.5 }, M, 0.1)).toMatchObject({ annual: 0.125, label: '12,5% ao ano' });
    // Texto antigo (antes dos campos estruturados).
    expect(annualRateOf({ rateInfo: '102% CDI' }, M, 0.1).annual).toBeCloseTo(0.1428);
    // Sem taxa: referencia, marcada como estimada.
    expect(annualRateOf({}, M, 0.1)).toMatchObject({ annual: 0.1, estimated: true });
  });

  it('projecao composta: 1 mes, 1 ano, 5 anos', () => {
    expect(growthMinor(1_000_000, 0.12, 12)).toBe(120_000);
    expect(growthMinor(1_000_000, 0.12, 1)).toBe(9_489);
    expect(growthMinor(1_000_000, 0.12, 60)).toBe(762_342);
  });

  it('poupanca e prazo da meta', () => {
    expect(savingsAnnual(M)).toBeCloseTo(0.0617, 3);
    expect(monthsToTarget(100_000, 100_000, 0.1, 0)).toBe(0);
    expect(monthsToTarget(0, 120_000, 0, 10_000)).toBe(12);
    expect(monthsToTarget(0, 1, 0, 0)).toBeNull();
  });
});
