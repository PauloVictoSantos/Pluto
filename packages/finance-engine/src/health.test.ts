import { describe, expect, it } from 'vitest';
import { CONTAINMENT_BELOW, HEALTH_WEIGHTS, healthBand, healthScore, isHealthy, piecewise } from './health';

// Score 0-100 (doc. Pluton 5.2): media ponderada dos indicadores normalizados.

const ideal = { commitment: 0.3, debt: 0, reserve: 6, savingsRate: 0.15, capacity: 0.2 };

describe('saude financeira 0-100', () => {
  it('pesos somam 1; tudo ideal da 100; tudo ruim da 0', () => {
    expect(Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(healthScore(ideal).score).toBe(100);
    expect(healthScore({ commitment: 1.2, debt: 0.8, reserve: 0, savingsRate: 0, capacity: -0.5 }).score).toBe(0);
  });

  it('caso tipico: fixos altos, sem reserva, sem poupanca -> contencao', () => {
    const s = healthScore({ commitment: 0.7, debt: 0.35, reserve: 0.5, savingsRate: 0, capacity: -0.05 }).score!;
    expect(s).toBeLessThan(CONTAINMENT_BELOW);
    expect(healthBand(s).key).toBe('containment');
  });

  it('dado ausente redistribui o peso; sem metade dos pesos nao ha nota', () => {
    expect(healthScore({ ...ideal, reserve: null }).score).toBe(100);
    expect(healthScore({ commitment: null, debt: null, reserve: 6, savingsRate: null, capacity: null }).score).toBeNull();
  });

  it('curvas, faixas e limites saudaveis do doc', () => {
    expect(piecewise(0.4, [[0.3, 1], [0.5, 0.75]])).toBeCloseTo(0.875, 6);
    expect(piecewise(-1, [[0, 0], [1, 1]])).toBe(0);
    expect(piecewise(9, [[0, 0], [1, 1]])).toBe(1);
    expect([39, 40, 59, 60, 79, 80, 100].map((s) => healthBand(s).key)).toEqual(['containment', 'attention', 'attention', 'good', 'good', 'excellent', 'excellent']);
    expect([isHealthy('commitment', 0.5), isHealthy('debt', 0.31), isHealthy('reserve', 6), isHealthy('savingsRate', 0.1), isHealthy('capacity', 0)]).toEqual([true, false, true, false, false]);
  });
});
