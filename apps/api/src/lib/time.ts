// Fechamento de mes no fuso do usuario (secao 4.1: datas em UTC, conversao na borda).

/** Diferenca (ms) entre o relogio local do fuso e UTC naquele instante. */
export function tzOffsetMs(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** "YYYY-MM" do instante no fuso. */
export function monthOf(at: Date, tz: string): string {
  const local = new Date(at.getTime() + tzOffsetMs(at, tz));
  return local.toISOString().slice(0, 7);
}

/** Inicio do mes "YYYY-MM" no fuso, em UTC. */
export function monthStart(month: string, tz: string): Date {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, 1));
  return new Date(guess.getTime() - tzOffsetMs(guess, tz));
}

export function addMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** [inicio, fim) do mes no fuso. */
export const monthRange = (month: string, tz: string) => ({ from: monthStart(month, tz), to: monthStart(addMonth(month, 1), tz) });
