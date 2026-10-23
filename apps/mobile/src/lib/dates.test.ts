import { describe, expect, it } from 'vitest';
import { addMonth, change, daysBetween, initials, monthLong, monthProgress, nextDue, pctText, ymdIn } from './dates';

// Mesmas regras do site (datas no fuso do usuario, projecoes do mes, vencimentos).
describe('datas', () => {
  it('dia no fuso do usuario', () => {
    expect(ymdIn(new Date('2026-10-01T02:00:00Z'), 'America/Manaus')).toBe('2026-09-30');
    expect(ymdIn(new Date('2026-10-01T05:00:00Z'), 'America/Manaus')).toBe('2026-10-01');
  });
  it('meses, variacao e progresso do mes', () => {
    expect(monthLong('2026-10')).toBe('Outubro 2026');
    expect(addMonth('2026-12', 1)).toBe('2027-01');
    expect(change(150, 100)).toBe(50);
    expect(change(1, 0)).toBeNull();
    expect(pctText(-12.345)).toBe('-12,3%');
    expect(monthProgress('2026-10', '2026-10-23')).toEqual({ days: 31, elapsed: 23, left: 8 });
    expect(daysBetween('2026-10-23', '2026-11-02')).toBe(10);
  });
  it('proximo vencimento respeita o fim do mes', () => {
    expect(nextDue(10, '2026-10-05')).toBe('2026-10-10');
    expect(nextDue(10, '2026-10-23')).toBe('2026-11-10');
    expect(nextDue(31, '2026-11-05')).toBe('2026-11-30');
    expect(nextDue(5, '2026-12-20')).toBe('2027-01-05');
  });
  it('iniciais', () => {
    expect(initials('paulo victor santos')).toBe('PV');
  });
});
