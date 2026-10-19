import { describe, expect, it } from 'vitest';
import { detectRecurrence, findPendingDuplicates, hasRealTime, parseInstallment, remainingInstallments, textSimilarity } from './recurrence';
import { cv, mad, median, quantile, rng } from './stats';

const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe('estatistica robusta', () => {
  it('mediana, quantil e MAD resistem a um valor extremo', () => {
    const xs = [10, 11, 12, 13, 1000];
    expect(median(xs)).toBe(12);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(mad(xs)).toBe(1);
    expect(cv([5, 5, 5])).toBe(0);
  });

  it('rng com semente e reproduzivel e fica em [0, 1)', () => {
    const a = rng(42), b = rng(42);
    const xs = Array.from({ length: 5 }, a);
    expect(xs).toEqual(Array.from({ length: 5 }, b));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('recorrencias', () => {
  it('detecta assinatura mensal e preve a proxima data', () => {
    const r = detectRecurrence([
      { date: d('2026-06-05'), amountMinor: -3990 },
      { date: d('2026-07-05'), amountMinor: -3990 },
      { date: d('2026-08-04'), amountMinor: -3990 },
      { date: d('2026-09-05'), amountMinor: -4090 },
    ]);
    expect(r).toMatchObject({ period: 30, amountMinor: -3990, count: 4 });
    expect(r!.nextDate.toISOString().slice(0, 10)).toBe('2026-10-05');
  });

  it('nao chama de recorrente com menos de 3 ocorrencias, intervalos irregulares ou valores variados', () => {
    expect(detectRecurrence([{ date: d('2026-06-05'), amountMinor: -100 }, { date: d('2026-07-05'), amountMinor: -100 }])).toBeNull();
    expect(
      detectRecurrence([
        { date: d('2026-06-01'), amountMinor: -100 },
        { date: d('2026-06-09'), amountMinor: -100 },
        { date: d('2026-07-20'), amountMinor: -100 },
      ]),
    ).toBeNull();
    expect(
      detectRecurrence([
        { date: d('2026-06-05'), amountMinor: -100 },
        { date: d('2026-07-05'), amountMinor: -300 },
        { date: d('2026-08-05'), amountMinor: -100 },
      ]),
    ).toBeNull();
  });
});

describe('parcelas', () => {
  it('le PARC07/09 da descricao', () => {
    expect(parseInstallment('SHOPEE *SHPSTEPARC07/09')).toEqual({ n: 7, total: 9 });
    expect(parseInstallment('LOJA X PARCELA 2 DE 10')).toEqual({ n: 2, total: 10 });
    expect(parseInstallment('LOJA PARC 01/01')).toBeNull();
    expect(parseInstallment('PIX ENVIADO')).toBeNull();
    expect(remainingInstallments({ n: 7, total: 9 })).toBe(2);
  });
});

describe('duplicidade pendente -> liquidada', () => {
  it('casa mesmo valor, data proxima e texto parecido; cada liquidada so uma vez', () => {
    const pending = [
      { id: 'p1', date: d('2026-10-01'), amountMinor: -5000, text: 'ifood restaurante' },
      { id: 'p2', date: d('2026-10-01'), amountMinor: -5000, text: 'ifood restaurante' },
      { id: 'p3', date: d('2026-10-01'), amountMinor: -999, text: 'uber trip' },
    ];
    const posted = [
      { id: 'q1', date: d('2026-10-02'), amountMinor: -5000, text: 'ifood restaurante sp' },
      { id: 'q2', date: d('2026-10-09'), amountMinor: -999, text: 'uber trip' },
    ];
    expect(findPendingDuplicates(pending, posted)).toEqual([['p1', 'q1']]);
    expect(textSimilarity('a b', 'c d')).toBe(0);
  });

  it('horario redondo e so data', () => {
    expect(hasRealTime(new Date('2026-10-01T23:00:00.000Z'))).toBe(false);
    expect(hasRealTime(new Date('2026-10-01T03:00:00.000Z'))).toBe(false);
    expect(hasRealTime(new Date('2026-10-01T18:42:13.000Z'))).toBe(true);
  });
});
