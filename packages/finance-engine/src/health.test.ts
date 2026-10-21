import { describe, expect, it } from 'vitest';
import { healthBand, healthScore, installmentsScore, limitScore } from './health';

describe('saude financeira', () => {
  it('tudo ideal da 850; tudo ruim da 300; sempre entre os dois', () => {
    expect(healthScore({ onTimeRate: 1, limitUse: 0.02, installmentsRatio: 0.05 })).toBe(850);
    expect(healthScore({ onTimeRate: 0, limitUse: 1.2, installmentsRatio: 0.9 })).toBe(300);
    expect(healthScore({ onTimeRate: null, limitUse: null, installmentsRatio: null })).toBe(850);
  });

  it('pesos: pagamentos em dia pesam mais que o limite, que pesa mais que parcelas', () => {
    const base = { onTimeRate: 1, limitUse: 0.05, installmentsRatio: 0.05 };
    const late = healthScore({ ...base, onTimeRate: 0.5 });
    const limit = healthScore({ ...base, limitUse: 0.55 });
    const inst = healthScore({ ...base, installmentsRatio: 0.25 });
    expect(late).toBeLessThan(limit);
    expect(limit).toBeLessThan(inst);
  });

  it('faixas e componentes', () => {
    expect(healthBand(803).label).toBe('Excelente');
    expect(healthBand(720).label).toBe('Muito bom');
    expect(healthBand(450).label).toBe('Regular');
    expect(healthBand(300).label).toBe('Baixo');
    expect(limitScore(0.1)).toBe(1);
    expect(limitScore(1)).toBe(0);
    expect(installmentsScore(0.4)).toBe(0);
  });
});
