import { describe, expect, it } from 'vitest';
import { evaluatePurchase, needsCooling, type PurchaseInput } from './purchase';

// Tabela 3.4 do doc. Pluton + regra das 72 h e estado emocional (5.5).

const base: PurchaseInput = {
  priceMinor: 20_000,
  payment: 'cash',
  installments: null,
  monthlyRate: null,
  essential: false,
  urgent: false,
  mood: 'calmo',
  incomeMinor: 500_000,
  limitRemainingMinor: 150_000,
  expectedRestMinor: 50_000,
  topGoal: { name: 'Reserva', monthlyMinor: 60_000 },
  reserveMinor: 1_200_000,
  fixedMinor: 200_000,
  containment: false,
  freeMinor: 50_000,
};

describe('avaliacao de compra', () => {
  it('cabe no limite e nao afeta metas: aprovar com o impacto', () => {
    const r = evaluatePurchase(base);
    expect(r).toMatchObject({ verdict: 'aprovar', reason: 'cabe', monthImpactMinor: 20_000, hold72h: false, reserveMonths: 0.1 });
    expect(r.goalDelayDays).toBe(10);
  });

  it('cabe no limite mas o resto do mes nao: adiar mostrando os dias de atraso', () => {
    const r = evaluatePurchase({ ...base, priceMinor: 120_000, expectedRestMinor: 60_000, incomeMinor: 2_000_000 });
    expect(r).toMatchObject({ verdict: 'adiar', reason: 'atrasa-meta' });
    expect(r.goalDelayDays).toBe(15);
  });

  it('estoura o limite: recusar', () => {
    expect(evaluatePurchase({ ...base, priceMinor: 200_000 })).toMatchObject({ verdict: 'recusar', reason: 'estoura-limite' });
  });

  it('parcelado: pesa so a parcela no mes', () => {
    const r = evaluatePurchase({ ...base, priceMinor: 200_000, payment: 'installments', installments: 10 });
    expect(r).toMatchObject({ monthImpactMinor: 20_000, installmentMinor: 20_000, interestMinor: 0 });
  });

  it('credito com juros e reserva insuficiente: recusar com o custo dos juros', () => {
    const r = evaluatePurchase({ ...base, priceMinor: 100_000, payment: 'financed', installments: 12, monthlyRate: 0.04, reserveMinor: 100_000 });
    expect(r.verdict).toBe('recusar');
    expect(r.reason).toBe('juros-sem-reserva');
    expect(r.interestMinor).toBeGreaterThan(27_000);
  });

  it('urgencia real que nao cabe: usar a reserva com plano de recomposicao', () => {
    const r = evaluatePurchase({ ...base, priceMinor: 300_000, essential: true, urgent: true });
    expect(r).toMatchObject({ verdict: 'aprovar', reason: 'urgencia-reserva', reservePlan: { useMinor: 150_000, months: 3, monthlyMinor: 50_000 } });
  });

  it('contencao: so essenciais', () => {
    expect(evaluatePurchase({ ...base, containment: true })).toMatchObject({ verdict: 'recusar', reason: 'contencao' });
    expect(evaluatePurchase({ ...base, containment: true, essential: true }).verdict).toBe('aprovar');
  });

  it('72 h: desejo acima de 10% da renda ou sob emocao ("eu mereço")', () => {
    expect(evaluatePurchase({ ...base, priceMinor: 60_000, expectedRestMinor: 0 })).toMatchObject({ verdict: 'adiar', reason: 'regra-72h', hold72h: true });
    expect(evaluatePurchase({ ...base, mood: 'recompensa' })).toMatchObject({ verdict: 'adiar', reason: 'regra-72h' });
    expect(evaluatePurchase({ ...base, mood: 'recompensa', cooled: true }).verdict).toBe('aprovar');
    expect(needsCooling(true, 900_000, 500_000, 'estressado')).toBe(false);
    expect(needsCooling(false, 50_000, 500_000, 'calmo')).toBe(false);
  });
});
