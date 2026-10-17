import { MESES } from './format';

// Datas chegam em UTC; a conversao para o fuso do usuario acontece na borda (secao 4.1).

function parts(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { y: p.year!, m: p.month!, d: p.day!, hh: p.hour!, mm: p.minute! };
}

/** "YYYY-MM-DD" no fuso do usuario. */
export const ymdIn = (d: Date, tz: string) => {
  const p = parts(d, tz);
  return `${p.y}-${p.m}-${p.d}`;
};

/** "15 out. 2026, 20:42" */
export const fmtDateTimeIn = (d: Date, tz: string) => {
  const p = parts(d, tz);
  return `${+p.d} ${MESES[+p.m - 1]} ${p.y}, ${p.hh}:${p.mm}`;
};

/** "20:42" */
export const fmtTimeIn = (d: Date, tz: string) => {
  const p = parts(d, tz);
  return `${p.hh}:${p.mm}`;
};

/** Primeiro instante do mes corrente no fuso do usuario (aproximado pelo deslocamento atual). */
export function startOfMonthIn(now: Date, tz: string): Date {
  const p = parts(now, tz);
  const localMidnightUtc = Date.UTC(+p.y, +p.m - 1, 1);
  const offsetMs = Date.UTC(+p.y, +p.m - 1, +p.d, +p.hh, +p.mm) - Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(localMidnightUtc - offsetMs);
}

export const monthLabelIn = (d: Date, tz: string) => {
  const p = parts(d, tz);
  const name = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: tz }).format(d);
  return `${name[0]!.toUpperCase()}${name.slice(1)} ${p.y}`;
};
