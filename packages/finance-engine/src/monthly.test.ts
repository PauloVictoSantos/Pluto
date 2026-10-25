import { describe, expect, it } from 'vitest';
import { detectMonthlyCharge } from './recurrence';

// Sugestao de gasto fixo pelo extrato (doc. Melhorias, passo 7): >= 3 meses, +-10%, +-3 dias.
const o = (ymd: string, amountMinor: number) => ({ ymd, amountMinor });

describe('detectMonthlyCharge', () => {
  it('internet todo dia ~10 com valor parecido vira sugestao (media e dia provavel)', () => {
    expect(detectMonthlyCharge([o('2026-07-10', -9990), o('2026-08-11', -9990), o('2026-09-09', -10490)])).toEqual({ months: 3, meanMinor: 10157, day: 10, lastYmd: '2026-09-09' });
  });
  it('virada de mes conta como perto (30, 1, 31)', () => {
    expect(detectMonthlyCharge([o('2026-06-30', -5000), o('2026-08-01', -5000), o('2026-08-31', -5000)])).toBeNull(); // dois em agosto
    expect(detectMonthlyCharge([o('2026-06-30', -5000), o('2026-07-31', -5000), o('2026-09-01', -5000)])?.months).toBe(3);
  });
  it('fora do criterio nao sugere', () => {
    expect(detectMonthlyCharge([o('2026-08-10', -9990), o('2026-09-10', -9990)])).toBeNull(); // so 2 meses
    expect(detectMonthlyCharge([o('2026-07-10', -10000), o('2026-08-10', -10000), o('2026-09-10', -11500)])).toBeNull(); // +15%
    expect(detectMonthlyCharge([o('2026-07-05', -10000), o('2026-08-12', -10000), o('2026-09-05', -10000)])).toBeNull(); // dia 12
    expect(detectMonthlyCharge([o('2026-07-05', -2000), o('2026-07-20', -2000), o('2026-08-05', -2000), o('2026-09-05', -2000)])).toBeNull(); // 2x no mes
  });
});
