import { describe, expect, it } from 'vitest';
import { bandOf, benjaminiHochberg, cusumShift, f1Macro, heatmap, holtForecast, isAnomaly, modifiedZ, poissonUpper, predictNB, trainNB } from './patterns';

describe('testes estatisticos', () => {
  it('cauda da Poisson', () => {
    expect(poissonUpper(0, 3)).toBe(1);
    expect(poissonUpper(1, 2)).toBeCloseTo(1 - Math.exp(-2));
    expect(poissonUpper(10, 1)).toBeLessThan(1e-6);
  });

  it('Benjamini-Hochberg controla falsas descobertas', () => {
    expect(benjaminiHochberg([0.001, 0.04, 0.03, 0.2])).toEqual([true, false, false, false]);
    expect(benjaminiHochberg([0.01, 0.02, 0.03, 0.04])).toEqual([true, true, true, true]);
  });
});

describe('mapa dia x horario', () => {
  it('chama de pico so a celula com muito mais compras que a media', () => {
    const events = [
      ...Array.from({ length: 40 }, () => ({ dow: 5, band: bandOf(19), amount: 5000 })),
      ...Array.from({ length: 42 }, (_, i) => ({ dow: Math.floor(i / 6), band: i % 6, amount: 1000 })),
    ];
    const cells = heatmap(events, 10);
    const friday = cells.find((c) => c.dow === 5 && c.band === 4)!;
    expect(friday).toMatchObject({ count: 41, peak: true });
    expect(friday.rate).toBeCloseTo(4.1);
    expect(cells.filter((c) => c.peak)).toHaveLength(1);
  });

  it('duas compras num horario nao viram "pico"', () => {
    const cells = heatmap([{ dow: 5, band: 4, amount: 100 }, { dow: 5, band: 4, amount: 100 }, { dow: 1, band: 2, amount: 100 }], 10);
    expect(cells.some((c) => c.peak)).toBe(false);
  });
});

describe('anomalias e patamar', () => {
  it('z-score modificado pega o gasto isolado fora do normal', () => {
    const ref = [50, 55, 60, 52, 58, 61, 49, 57, 54, 60];
    expect(isAnomaly(modifiedZ(450, ref))).toBe(true);
    expect(isAnomaly(modifiedZ(62, ref))).toBe(false);
    expect(modifiedZ(10, [1, 2])).toBeNull();
  });

  it('CUSUM detecta a subida de patamar e quando comecou', () => {
    const weekly = [...Array(12).fill(100).map((v, i) => v + (i % 3) * 5), 105, 100, 102, 180, 190, 185, 175, 182];
    const s = cusumShift(weekly);
    expect(s).not.toBeNull();
    expect(s!.weeksAgo).toBe(4);
    expect(s!.recent).toBeGreaterThan(170);
    expect(cusumShift([...Array(20).fill(100)])).toBeNull();
  });
});

describe('categorizacao aprendida', () => {
  it('Naive Bayes aprende com as correcoes', () => {
    const m = trainNB([
      { tokens: ['faculdade', 'norte'], label: 'educacao' },
      { tokens: ['faculdade', 'mensalidade'], label: 'educacao' },
      { tokens: ['ifood', 'restaurante'], label: 'delivery' },
      { tokens: ['ifood'], label: 'delivery' },
    ]);
    const [top] = predictNB(m, ['faculdade']);
    expect(top!.label).toBe('educacao');
    expect(top!.p).toBeGreaterThan(0.6);
    expect(f1Macro([{ truth: 'a', pred: 'a' }, { truth: 'b', pred: 'a' }])).toBeCloseTo(1 / 3);
  });
});

describe('tendencia (Holt)', () => {
  it('segue a tendencia e vence "igual ao mes passado" numa serie com crescimento', () => {
    const r = holtForecast([100, 110, 120, 130, 140, 150])!;
    expect(r.forecast).toBeCloseTo(160, 0);
    expect(r.mase).toBeLessThan(1);
  });

  it('ruido puro: nao vence a linha de base', () => {
    const r = holtForecast([100, 300, 100, 300, 100, 300])!;
    expect(r.mase).toBeGreaterThanOrEqual(0.5);
    expect(holtForecast([1, 2])).toBeNull();
  });
});
