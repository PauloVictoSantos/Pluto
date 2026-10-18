import { describe, expect, it } from 'vitest';
import { formatCpf, isValidCpf, maskCpf, normalizeCpf } from './cpf';

describe('cpf', () => {
  it('valida digitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('1234')).toBe(false);
  });

  it('normaliza, formata e mascara', () => {
    expect(normalizeCpf(' 529.982.247-25 ')).toBe('52998224725');
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(formatCpf('5299822')).toBe('529.982.2');
    expect(maskCpf('52998224725')).toBe('***.982.247-**');
  });
});
