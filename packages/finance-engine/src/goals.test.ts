import { describe, expect, it } from 'vitest';
import { GOAL_SCORE_WEIGHTS, allocateCapacity, essentiality, financialImpact, priorityScore, validatedUrgency, viability } from './goals';

describe('score de prioridade de meta (5.4)', () => {
  it('pesos somam 1; extremos dao 0 e 1', () => {
    expect(Object.values(GOAL_SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(priorityScore({ U: 1, E: 1, F: 1, R: 1, A: 1 })).toBe(1);
    expect(priorityScore({ U: 0, E: 0, F: 0, R: 0, A: 0 })).toBe(0);
  });

  it('fatores: essencialidade, impacto e urgencia validada', () => {
    expect([essentiality('purchase', 'saude'), essentiality('purchase', 'educacao'), essentiality('experience', 'desejo'), essentiality('fixed', null)]).toEqual([1, 0.8, 0.2, 1]);
    expect([financialImpact('debt_payoff', null), financialImpact('purchase', 'renda'), financialImpact('fixed', null), financialImpact('purchase', 'desejo')]).toEqual([1, 1, 0.6, 0]);
    expect(validatedUrgency(5, 'purchase', 'trabalho')).toBe(1);
    expect(validatedUrgency(5, 'experience', 'desejo')).toBe(0.5);
    expect(validatedUrgency(1, 'fixed', null)).toBe(0);
  });

  it('computador de trabalho vence viagem de desejo; objetivo do ano pesa', () => {
    const work = priorityScore({ U: validatedUrgency(4, 'purchase', 'trabalho'), E: 1, F: 0.5, R: 0, A: 0.5 });
    const trip = priorityScore({ U: validatedUrgency(5, 'experience', 'desejo'), E: 0.2, F: 0, R: 0, A: 1 });
    expect(work).toBeGreaterThan(trip);
    const tripObjective = priorityScore({ U: 0.5, E: 0.2, F: 0, R: 1, A: 1 });
    expect(tripObjective - trip).toBeCloseTo(0.15, 6);
  });

  it('viabilidade e alocacao da capacidade (MT-04)', () => {
    expect(viability(50, 100)).toBe(0.5);
    expect(viability(500, 100)).toBe(1);
    expect(viability(-10, 100)).toBe(0);
    expect(viability(0, 0)).toBe(1);
    const r = allocateCapacity(
      [
        { id: 'viagem', score: 0.3, requiredMinor: 50_000 },
        { id: 'reserva', score: 0.8, requiredMinor: 100_000 },
        { id: 'pc', score: 0.6, requiredMinor: 80_000 },
      ],
      150_000,
    );
    expect(r.goals.map((g) => [g.id, g.allocatedMinor, g.waiting])).toEqual([
      ['reserva', 100_000, false],
      ['pc', 50_000, true],
      ['viagem', 0, true],
    ]);
    expect(r.freeMinor).toBe(0);
    expect(allocateCapacity([{ id: 'a', score: 1, requiredMinor: 10 }], -5).goals[0]!.allocatedMinor).toBe(0);
  });
});
