/** Desconta um valor futuro por `periods` meses a uma taxa mensal `rate`. */
export function presentValue(futureValue: number, rate: number, periods: number): number {
  if (rate <= -1) throw new RangeError('Taxa deve ser maior que -100%');
  return futureValue / Math.pow(1 + rate, periods);
}
