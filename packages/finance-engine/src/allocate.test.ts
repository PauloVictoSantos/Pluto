import { describe, expect, it } from 'vitest';
import { allocateSurplus } from './allocate';

const debts = [
  { id: 'rot', label: 'Rotativo', monthlyRate: 0.12, balanceMinor: 50_000 },
  { id: 'cons', label: 'Consignado', monthlyRate: 0.005, balanceMinor: 1_000_000 },
];
const goals = [
  { id: 'v', label: 'Viagem', deadline: '2027-06-01', monthlyMinor: 30_000 },
  { id: 'c', label: 'Carro', deadline: '2027-01-01', monthlyMinor: 40_000 },
];
const sum = (a: { amountMinor: number }[]) => a.reduce((t, x) => t + x.amountMinor, 0);

describe('allocateSurplus (destino da sobra)', () => {
  it('reserva primeiro; sem reserva completa, nao adianta divida', () => {
    const a = allocateSurplus({ surplusMinor: 100_000, reserve: { currentMinor: 0, targetMinor: 300_000 }, debts, goals, referenceRate: 0.008 });
    expect(a).toEqual([{ kind: 'reserva', refId: null, label: 'Reserva de emergência', amountMinor: 100_000 }]);
  });

  it('reserva completa: divida cara (juro > rendimento), metas pelo prazo e o resto investido; soma fecha', () => {
    const a = allocateSurplus({ surplusMinor: 200_000, reserve: { currentMinor: 300_000, targetMinor: 300_000 }, debts, goals, referenceRate: 0.008 });
    expect(a.map((x) => [x.kind, x.refId, x.amountMinor])).toEqual([
      ['divida', 'rot', 50_000], // consignado (0,5%) rende menos que o investimento: nao adianta
      ['meta', 'c', 40_000],
      ['meta', 'v', 30_000],
      ['investimento', null, 80_000],
    ]);
    expect(sum(a)).toBe(200_000);
  });

  it('completa a reserva e segue no mesmo mes; sobra zero nao gera destino', () => {
    const a = allocateSurplus({ surplusMinor: 120_000, reserve: { currentMinor: 250_000, targetMinor: 300_000 }, debts: [], goals, referenceRate: 0.008 });
    expect(a.map((x) => [x.kind, x.amountMinor])).toEqual([['reserva', 50_000], ['meta', 40_000], ['meta', 30_000]]);
    expect(sum(a)).toBe(120_000);
    expect(allocateSurplus({ surplusMinor: 0, reserve: { currentMinor: 0, targetMinor: 1 }, debts, goals, referenceRate: 0 })).toEqual([]);
  });
});
