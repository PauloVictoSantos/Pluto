import { categoryOf, type Budget, type Spending } from '@pluto/shared';
import { MESES, MESES_LONGOS, money } from './format';

// Datas e textos derivados (mesmas regras de apps/web/lib/datetime, queries e insights). Datas chegam
// em UTC; a conversao para o fuso do usuario acontece aqui, na borda.

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
/** Hora local (0-23) no fuso. */
export const hourIn = (d: Date, tz: string) => +parts(d, tz).hh;

export const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 864e5);

// Meses "YYYY-MM"
export const monthLong = (ym: string) => `${MESES_LONGOS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
export const monthShort = (ym: string) => MESES_LONGOS[+ym.slice(5) - 1]!.slice(0, 3);
export const monthLower = (ym: string) => MESES_LONGOS[+ym.slice(5) - 1]!.toLowerCase();
export const addMonth = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1)).toISOString().slice(0, 7);

/** Dias no mes e dias decorridos (no fuso), para projecoes (RN-21). */
export function monthProgress(ym: string, todayYmd: string) {
  const days = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate();
  const elapsed = todayYmd.slice(0, 7) === ym ? +todayYmd.slice(8) : days;
  return { days, elapsed, left: days - elapsed };
}

/** Variacao percentual com sinal, ou null se nao ha base. */
export const change = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);
export const pctText = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`);

/** Proxima data de vencimento a partir do dia do vencimento do cartao. */
export function nextDue(dueDay: number, todayYmd: string): string {
  const y = +todayYmd.slice(0, 4), m = +todayYmd.slice(5, 7), d = +todayYmd.slice(8, 10);
  const clamp = (yy: number, mm: number) => Math.min(dueDay, new Date(Date.UTC(yy, mm, 0)).getUTCDate());
  if (d <= clamp(y, m)) return `${y}-${String(m).padStart(2, '0')}-${String(clamp(y, m)).padStart(2, '0')}`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(clamp(ny, nm)).padStart(2, '0')}`;
}

/** Dica da Pluto sobre os gastos do mes (regras sobre os dados reais, como no site). */
export function spendingTip(spending: Spending | undefined, budget: Budget | undefined): string | null {
  if (!spending?.categories.length) return null;
  const limits = new Map((budget?.items ?? []).map((b) => [b.categoryKey, b.limitMinor]));
  const over = spending.categories
    .filter((c) => limits.has(c.key) && c.spentMinor > limits.get(c.key)!)
    .map((c) => ({ ...c, over: c.spentMinor - limits.get(c.key)! }))
    .sort((a, b) => b.over - a.over)[0];
  if (over) return `${categoryOf(over.key).label} passou do limite em ${money(over.over)} este mês.`;
  const top = spending.categories[0]!;
  const share = Math.round((top.spentMinor / spending.totalMinor) * 100);
  const tail = budget?.items.length ? '' : ' Defina limites no Planejamento para eu avisar quando algo estourar.';
  return `${categoryOf(top.key).label} é seu maior gasto do mês: ${money(top.spentMinor)} (${share}% do total, em ${top.count} lançamento${top.count > 1 ? 's' : ''}).${tail}`;
}

export const initials = (name: string) =>
  (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
