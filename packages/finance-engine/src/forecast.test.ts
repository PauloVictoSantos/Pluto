import { describe, expect, it } from 'vitest';
import { delayCost, diverges, evaluate, extraForChance, goalChances, monthEnd, monthProfile, paymentOrder, pmt, profileEstimate, simulateVariable, suggestBudget } from './forecast';

describe('saldo no fim do mes (Monte Carlo)', () => {
  it('gasto constante vira faixa estreita no valor certo', () => {
    const weeks = [[10, 10, 10, 10, 10, 10, 10]];
    const r = monthEnd({ balance: 1000, knownNet: -200, weeks, remainingDows: [1, 2, 3, 4, 5], sims: 500 });
    expect(r).toMatchObject({ p10: 750, p50: 750, p90: 750, probPositive: 1 });
  });

  it('preserva o habito de fim de semana (bloco semanal)', () => {
    const weekend = [100, 0, 0, 0, 0, 0, 100];
    const v = simulateVariable([weekend], [6, 0, 1], 10);
    expect(v.every((x) => x === 200)).toBe(true);
  });

  it('faixa larga e probabilidade de ficar no vermelho com gasto incerto', () => {
    const weeks = [Array(7).fill(0), Array(7).fill(100)];
    const r = monthEnd({ balance: 1000, knownNet: 0, weeks, remainingDows: Array.from({ length: 14 }, (_, i) => i % 7), sims: 4000, seed: 3 });
    expect(r.p10).toBeLessThan(r.p90);
    expect(r.probPositive).toBeGreaterThan(0.6);
    expect(r.probPositive).toBeLessThan(0.9);
  });

  it('perfil do mes e controle cruzado', () => {
    const month = Array.from({ length: 30 }, (_, d) => (d < 5 ? 100 : 0));
    const F = monthProfile([month, month]);
    expect(F[4]).toBe(1);
    expect(profileEstimate(250, 0.5)).toBe(500);
    expect(diverges(100, 140)).toBe(true);
    expect(diverges(100, 110)).toBe(false);
  });
});

describe('orcamento sugerido', () => {
  it('sem aperto, limite = percentil 60', () => {
    const { lines, fits } = suggestBudget([{ key: 'mercado', monthly: [100, 110, 120, 130, 140] }], 10_000);
    expect(fits).toBe(true);
    expect(lines[0]!.limit).toBeCloseTo(124);
  });

  it('com aperto, a categoria volatil absorve o corte e o total cabe', () => {
    const habits = [
      { key: 'mercado', monthly: [1000, 1010, 990, 1000, 1005] },
      { key: 'lazer', monthly: [200, 900, 100, 700, 400] },
    ];
    const { lines, fits } = suggestBudget(habits, 1300);
    const m = lines.find((l) => l.key === 'mercado')!, l = lines.find((x) => x.key === 'lazer')!;
    expect(fits).toBe(true);
    expect(m.limit + l.limit).toBeCloseTo(1300, 0);
    expect(m.q60 - m.limit).toBeLessThan(l.q60 - l.limit);
    expect(l.limit).toBeGreaterThanOrEqual(l.q10);
  });

  it('nem o piso cabe: devolve o piso e avisa', () => {
    expect(suggestBudget([{ key: 'a', monthly: [100, 100] }], 50)).toMatchObject({ fits: false });
  });
});

describe('metas', () => {
  it('aporte mensal (PMT)', () => {
    expect(pmt(1200, 0, 0, 12)).toBe(100);
    expect(pmt(1200, 0, 0.01, 12)).toBeCloseTo(94.62, 2);
  });

  it('meta de maior prioridade recebe a sobra primeiro; mais aporte aumenta a chance', () => {
    const goals = [
      { id: 'reserva', remaining: 1000, months: 10, priority: 1 },
      { id: 'viagem', remaining: 1000, months: 10, priority: 2 },
    ];
    const surpluses = [150, 50, 100, -300, 200];
    const c = goalChances(goals, surpluses, { sims: 2000 });
    expect(c.get('reserva')!).toBeGreaterThan(c.get('viagem')!);
    const extra = extraForChance('viagem', goals, surpluses, 0.85, { sims: 1000 });
    expect(extra).not.toBeNull();
    expect(goalChances(goals, surpluses, { sims: 2000, extra: extra! }).get('viagem')!).toBeGreaterThanOrEqual(0.8);
  });
});

describe('boletos e rotativo', () => {
  it('custo do atraso: rotativo com IOF x boleto com multa de 2%', () => {
    const card = delayCost(1000, 30, { monthlyRate: 0.14, fine: 0.02, iof: true });
    expect(card).toBeCloseTo(140 + 3.8 + 2.46 + 20, 1);
    const boleto = delayCost(1000, 30, { monthlyRate: 0.01, fine: 0.02, iof: false });
    expect(boleto).toBeCloseTo(30, 5);
  });

  it('dinheiro curto: paga primeiro o que custa mais por real atrasado', () => {
    const order = paymentOrder(
      [
        { id: 'luz', amount: 300, terms: { monthlyRate: 0.01, fine: 0.02, iof: false } },
        { id: 'cartao', amount: 1000, terms: { monthlyRate: 0.14, fine: 0.02, iof: true } },
      ],
      1000,
    );
    expect(order.map((o) => [o.id, o.pay])).toEqual([
      ['cartao', 1000],
      ['luz', 0],
    ]);
  });
});

describe('avaliacao', () => {
  it('liga o modelo so se o erro for menor que o da linha de base', () => {
    const r = evaluate([
      { actual: 100, baseline: 150, model: { p10: 80, p50: 105, p90: 130 } },
      { actual: 200, baseline: 120, model: { p10: 150, p50: 190, p90: 240 } },
    ]);
    expect(r).toMatchObject({ n: 2, coverage: 1, beatsBaseline: true });
  });
});
