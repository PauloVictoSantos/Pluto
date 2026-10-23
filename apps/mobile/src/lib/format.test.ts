import { describe, expect, it } from 'vitest';
import { fmtDay, maskMoney, money, pct, setValuesHidden } from './format';

describe('formatacao', () => {
  it('campo de dinheiro em centavos', () => {
    expect(maskMoney('150000')).toMatchObject({ minor: 150_000 });
    expect(maskMoney('R$ 1.500,00').minor).toBe(150_000);
    expect(maskMoney('').minor).toBe(0);
    expect(maskMoney('abc').text).toBe('');
    expect(maskMoney('5').text).toMatch(/^R\$\s0,05$/);
  });
  it('ocultar valores mascara todo dinheiro da tela', () => {
    expect(money(123_456)).toMatch(/^R\$\s1\.234,56$/);
    setValuesHidden(true);
    expect(money(123_456)).toBe('R$ ••••');
    setValuesHidden(false);
  });
  it('percentual e datas', () => {
    expect(pct(0.456)).toBe('46%');
    expect(fmtDay('2026-10-05T12:00:00Z')).toBe('5 out.');
  });
});
