import { describe, expect, it } from 'vitest';
import { alertScore, inQuietHours, pUseful, pickPush, threshold, trainLogistic } from './alerts';

describe('pontuacao e envio de alertas', () => {
  it('A = P(evento) x impacto x prioridade x P(util)', () => {
    expect(alertScore(0.5, 20_000, 1, 0.5)).toBe(50);
  });

  it('P(util) comeca em 0,5 e aprende com os botoes', () => {
    expect(pUseful(null, { type: 'x', hour: 9, group: 'lifestyle', amountMinor: 0 })).toBe(0.5);
    const samples = [
      ...Array.from({ length: 6 }, () => ({ x: { type: 'bill_due', hour: 7, group: 'essential', amountMinor: 30_000 }, useful: true })),
      ...Array.from({ length: 6 }, () => ({ x: { type: 'category_anomaly', hour: 7, group: 'lifestyle', amountMinor: 3_000 }, useful: false })),
    ];
    const m = trainLogistic(samples);
    expect(pUseful(m, samples[0]!.x)).toBeGreaterThan(0.7);
    expect(pUseful(m, samples[6]!.x)).toBeLessThan(0.3);
  });

  it('tau sobe com muitos "nao util"', () => {
    expect(threshold(20, [true, false])).toBe(20);
    expect(threshold(20, [false, false, true, true, true])).toBe(30);
    expect(threshold(20, [true, true, true, true, false])).toBe(20);
  });

  it('silencio atravessa a meia-noite', () => {
    expect(inQuietHours('23:10', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('06:59', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('07:00', '22:00', '07:00')).toBe(false);
    expect(inQuietHours('13:00', '12:00', '14:00')).toBe(true);
  });

  it('no maximo 3 por dia, acima de tau; no silencio so vencimento do dia (RN-A01)', () => {
    const c = [
      { type: 'a', target: '1', score: 100 },
      { type: 'b', target: '2', score: 90 },
      { type: 'c', target: '3', score: 80 },
      { type: 'd', target: '4', score: 70 },
      { type: 'e', target: '5', score: 5 },
      { type: 'bill_due', target: '6', score: 50, dueToday: true },
    ];
    expect(pickPush(c, { tau: 20, sentToday: 0, quiet: false }).map((x) => x.type)).toEqual(['a', 'b', 'c']);
    expect(pickPush(c, { tau: 20, sentToday: 2, quiet: false }).map((x) => x.type)).toEqual(['a']);
    expect(pickPush(c, { tau: 20, sentToday: 0, quiet: true }).map((x) => x.type)).toEqual(['bill_due']);
  });
});
