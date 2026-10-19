import { describe, expect, it } from 'vitest';
import { associations, classify, emaPrice, laspeyres, posterior, sampleBeta, weightedMedian } from './shopping';
import { mean, rng } from './stats';

describe('probabilidade de compra (Beta-Binomial)', () => {
  it('item novo nasce com a taxa da categoria, nao com 50%', () => {
    expect(posterior([], 0.8).p).toBeCloseTo(0.8);
  });

  it('comprado sempre vira essencial; nunca comprado sai das sugestoes; meses antigos pesam menos', () => {
    const always = Array.from({ length: 6 }, (_, i) => ({ bought: true, monthsAgo: i }));
    const never = Array.from({ length: 8 }, (_, i) => ({ bought: false, monthsAgo: i }));
    expect(classify(posterior(always, 0.5))).toBe('essential');
    expect(classify(posterior(never, 0.3))).toBe('rarely');
    expect(classify(posterior([{ bought: true, monthsAgo: 0 }], 0.5))).toBe('maybe');

    const recent = posterior([{ bought: true, monthsAgo: 0 }, { bought: false, monthsAgo: 5 }], 0.5);
    const old = posterior([{ bought: false, monthsAgo: 0 }, { bought: true, monthsAgo: 5 }], 0.5);
    expect(recent.p).toBeGreaterThan(old.p);
  });

  it('amostra Beta tem a media esperada', () => {
    const r = rng(7);
    expect(mean(Array.from({ length: 4000 }, () => sampleBeta(3, 1, r)))).toBeCloseTo(0.75, 1);
    expect(mean(Array.from({ length: 4000 }, () => sampleBeta(0.5, 0.5, r)))).toBeCloseTo(0.5, 1);
  });
});

describe('quantidade, preco e cesta', () => {
  it('mediana ponderada da quantidade', () => {
    expect(weightedMedian([{ value: 2, weight: 1 }, { value: 6, weight: 0.2 }, { value: 2, weight: 0.85 }])).toBe(2);
    expect(weightedMedian([])).toBeNull();
  });

  it('preco de referencia por media movel exponencial', () => {
    expect(emaPrice([1000, 2000])).toBe(1300);
    expect(emaPrice([])).toBeNull();
  });

  it('inflacao da cesta separa preco de quantidade', () => {
    const base = new Map([['leite', { price: 500, qty: 6 }], ['arroz', { price: 2000, qty: 1 }]]);
    expect(laspeyres(base, new Map([['leite', 550], ['arroz', 2200]]))).toBeCloseTo(110);
    expect(laspeyres(base, new Map([['cafe', 1]]))).toBeNull();
  });

  it('associacao exige 3 meses juntos e lift > 1,5', () => {
    const b = (...xs: string[]) => new Set(xs);
    const baskets = [b('pao', 'manteiga'), b('pao', 'manteiga'), b('pao', 'manteiga'), b('arroz'), b('arroz'), b('arroz', 'feijao')];
    const rules = associations(baskets);
    expect(rules).toContainEqual(expect.objectContaining({ x: 'pao', y: 'manteiga', together: 3 }));
    expect(rules.some((r) => r.y === 'feijao')).toBe(false);
  });
});
