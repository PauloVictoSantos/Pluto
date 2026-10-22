import { describe, expect, it } from 'vitest';
import { spendingLimit, usageThreshold, weeklyAllowance } from './limit';

describe('limite de gasto (LG-01, LG-06, LG-05)', () => {
  it('renda - fixos - aportes - margem', () => {
    expect(spendingLimit({ incomeMinor: 500_000, fixedMinor: 200_000, goalsMinor: 50_000, safetyMarginPct: 5 })).toEqual({ limitMinor: 225_000, marginMinor: 25_000, deficitMinor: 0 });
    expect(spendingLimit({ incomeMinor: 500_000, fixedMinor: 200_000, goalsMinor: 0, safetyMarginPct: 0 }).limitMinor).toBe(300_000);
  });
  it('renda zero ou fixos maiores que a renda: limite zero e deficit', () => {
    expect(spendingLimit({ incomeMinor: 0, fixedMinor: 100_000, goalsMinor: 0, safetyMarginPct: 5 })).toEqual({ limitMinor: 0, marginMinor: 0, deficitMinor: 100_000 });
    expect(spendingLimit({ incomeMinor: 300_000, fixedMinor: 320_000, goalsMinor: 10_000, safetyMarginPct: 10 }).deficitMinor).toBe(60_000);
  });
  it('distribui o que sobra pelas semanas e dias', () => {
    expect(weeklyAllowance(100_000, 31)).toEqual({ weeksLeft: 5, weekMinor: 20_000, dayMinor: 3_225 });
    expect(weeklyAllowance(10_000, 1)).toEqual({ weeksLeft: 1, weekMinor: 10_000, dayMinor: 10_000 });
    expect(weeklyAllowance(-5_000, 10).weekMinor).toBe(0);
  });
  it('faixas de consumo', () => {
    expect([0, 49_999, 50_000, 80_000, 100_000, 130_000].map((s) => usageThreshold(s, 100_000))).toEqual([null, null, 0.5, 0.8, 1, 1]);
    expect(usageThreshold(1, 0)).toBe(1);
    expect(usageThreshold(0, 0)).toBeNull();
  });
});
