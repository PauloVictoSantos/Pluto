import { describe, expect, it } from 'vitest';
import { presentValue } from './present-value';

describe('presentValue', () => {
  it('sem taxa, VP e igual ao valor futuro', () => {
    expect(presentValue(10_000, 0, 12)).toBe(10_000);
  });

  it('desconta um periodo', () => {
    expect(presentValue(10_100, 0.01, 1)).toBeCloseTo(10_000, 6);
  });

  it('rejeita taxa <= -100%', () => {
    expect(() => presentValue(100, -1, 1)).toThrow(RangeError);
  });
});
