import { categoryOf, type Budget, type Spending } from '@pluto/shared';
import { money } from './queries';

// Dicas da Pluto geradas por regras sobre os dados reais (secao 5.7: numeros saem do codigo,
// a IA so reescreveria o texto). Nunca recomendam produtos financeiros (secao 5.4).

/** Proxima data de vencimento a partir do dia do vencimento do cartao. */
export function nextDue(dueDay: number, todayYmd: string): string {
  const y = +todayYmd.slice(0, 4), m = +todayYmd.slice(5, 7), d = +todayYmd.slice(8, 10);
  const clamp = (yy: number, mm: number) => Math.min(dueDay, new Date(Date.UTC(yy, mm, 0)).getUTCDate());
  if (d <= clamp(y, m)) return `${y}-${String(m).padStart(2, '0')}-${String(clamp(y, m)).padStart(2, '0')}`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(clamp(ny, nm)).padStart(2, '0')}`;
}

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
