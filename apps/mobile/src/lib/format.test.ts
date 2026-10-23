import { describe, expect, it } from 'vitest';
import { maskMoney, pct } from './format';

describe('formatacao', () => {
  it('campo de dinheiro em centavos', () => {
    expect(maskMoney('150000')).toMatchObject({ minor: 150_000 });
    expect(maskMoney('R$ 1.500,00').minor).toBe(150_000);
    expect(maskMoney('').minor).toBe(0);
    expect(maskMoney('abc').text).toBe('');
    expect(maskMoney('5').text).toMatch(/^R\$\s0,05$/);
  });
  it('percentual', () => {
    expect(pct(0.456)).toBe('46%');
  });
});
