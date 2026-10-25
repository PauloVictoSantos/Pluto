// Destino da sobra do mes (doc. Melhorias, passo 9): nenhum real parado. Ordem:
// 1. reserva de emergencia ate a meta (3 meses de gastos fixos);
// 2. dividas cujo juro mensal passa do rendimento do dinheiro guardado (maior juro primeiro) -
//    adiantar so compensa quando o juro economizado e maior que o rendimento no mesmo periodo,
//    e nunca antes de completar a reserva;
// 3. metas, pelo prazo mais proximo (ate o aporte mensal de cada uma);
// 4. investimento do restante.
// A soma dos destinos e sempre igual a sobra (R$ 0,00 sem destino).

export interface AllocDebt {
  id: string;
  label: string;
  monthlyRate: number;
  balanceMinor: number;
}
export interface AllocGoal {
  id: string;
  label: string;
  deadline: string | null;
  monthlyMinor: number;
}
export interface Allocation {
  kind: 'reserva' | 'divida' | 'meta' | 'investimento';
  refId: string | null;
  label: string;
  amountMinor: number;
}

export function allocateSurplus(input: {
  surplusMinor: number;
  reserve: { currentMinor: number; targetMinor: number };
  debts: readonly AllocDebt[];
  goals: readonly AllocGoal[];
  /** Rendimento mensal de referencia do dinheiro guardado. */
  referenceRate: number;
}): Allocation[] {
  let left = Math.max(0, Math.round(input.surplusMinor));
  const out: Allocation[] = [];
  const take = (kind: Allocation['kind'], refId: string | null, label: string, want: number) => {
    const amount = Math.max(0, Math.min(left, Math.round(want)));
    if (amount <= 0) return;
    left -= amount;
    out.push({ kind, refId, label, amountMinor: amount });
  };
  take('reserva', null, 'Reserva de emergência', input.reserve.targetMinor - input.reserve.currentMinor);
  const reserveDone = input.reserve.currentMinor + (out[0]?.kind === 'reserva' ? out[0].amountMinor : 0) >= input.reserve.targetMinor;
  if (reserveDone)
    for (const d of [...input.debts].filter((x) => x.monthlyRate > input.referenceRate && x.balanceMinor > 0).sort((a, b) => b.monthlyRate - a.monthlyRate))
      take('divida', d.id, d.label, d.balanceMinor);
  for (const g of [...input.goals].sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))) take('meta', g.id, g.label, g.monthlyMinor);
  take('investimento', null, 'Investimento', left);
  return out;
}
