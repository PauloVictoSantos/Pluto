import { cv, median } from './stats';

// Recorrencias (assinaturas, contas fixas, salario) e parcelas (doc. "Recorrencias e parcelas").

const DAY = 86_400_000;
/** Periodos reconhecidos, em dias. */
export const PERIODS = [7, 14, 30, 365] as const;
export type Period = (typeof PERIODS)[number];

export interface Occurrence {
  date: Date;
  amountMinor: number;
}

export interface Recurrence {
  period: Period;
  /** Valor tipico (mediana), com sinal. */
  amountMinor: number;
  count: number;
  lastDate: Date;
  nextDate: Date;
}

/** Periodo mais proximo da mediana dos intervalos, se estiver a ate 25% dele. */
function nearestPeriod(days: number): Period | null {
  const p = PERIODS.reduce((best, x) => (Math.abs(x - days) < Math.abs(best - days) ? x : best));
  return Math.abs(p - days) <= p * 0.25 ? p : null;
}

/**
 * Uma serie e recorrente quando: n >= 3, CV dos intervalos < 0,15 e CV dos valores < 0,10.
 * A proxima data e a ultima mais o periodo. Ocorrencias no mesmo dia contam como uma so.
 */
export function detectRecurrence(occ: readonly Occurrence[]): Recurrence | null {
  const byDay = new Map<number, number>();
  for (const o of occ) {
    const d = Math.floor(o.date.getTime() / DAY);
    byDay.set(d, (byDay.get(d) ?? 0) + o.amountMinor);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  if (days.length < 3) return null;
  const gaps = days.slice(1).map((d, i) => d - days[i]!);
  const amounts = days.map((d) => byDay.get(d)!);
  if (cv(gaps) >= 0.15 || cv(amounts) >= 0.1) return null;
  const period = nearestPeriod(median(gaps));
  if (!period) return null;
  const last = days[days.length - 1]!;
  return {
    period,
    amountMinor: Math.round(median(amounts)),
    count: days.length,
    lastDate: new Date(last * DAY),
    nextDate: new Date((last + period) * DAY),
  };
}

export const PARC_RE = /PARC(?:ELA)?\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})/i;

/** "SHOPEE *SHPSTEPARC07/09" -> { n: 7, total: 9 }. Ignora 1/1 e numeros incoerentes. */
export function parseInstallment(description: string): { n: number; total: number } | null {
  const m = PARC_RE.exec(description);
  if (!m) return null;
  const n = Number(m[1]), total = Number(m[2]);
  return n >= 1 && total > 1 && n <= total ? { n, total } : null;
}

/** Parcelas que ainda vao cair depois da parcela n (entram na projecao como gasto certo). */
export const remainingInstallments = (i: { n: number; total: number }) => Math.max(0, i.total - i.n);

/** Semelhanca de Jaccard entre os conjuntos de palavras de dois textos ja normalizados. */
export function textSimilarity(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean)), B = new Set(b.split(' ').filter(Boolean));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface DedupCandidate {
  id: string;
  date: Date;
  amountMinor: number;
  text: string;
}

/**
 * Pendente que reaparece liquidada com outro id: mesmo valor, data a ate 2 dias e texto parecido
 * (Jaccard >= 0,5). Cada liquidada absorve no maximo uma pendente. Retorna pares [pendente, liquidada].
 */
export function findPendingDuplicates(pending: readonly DedupCandidate[], posted: readonly DedupCandidate[]): [string, string][] {
  const used = new Set<string>();
  const out: [string, string][] = [];
  for (const p of pending) {
    let best: { id: string; score: number } | null = null;
    for (const q of posted) {
      if (used.has(q.id) || q.amountMinor !== p.amountMinor) continue;
      if (Math.abs(q.date.getTime() - p.date.getTime()) > 2 * DAY) continue;
      const score = textSimilarity(p.text, q.text);
      if (score >= 0.5 && (!best || score > best.score)) best = { id: q.id, score };
    }
    if (best) {
      used.add(best.id);
      out.push([p.id, best.id]);
    }
  }
  return out;
}

/**
 * O horario e real? Transacoes que so tem data chegam com hora redonda (00:00, 03:00 UTC, 23:00...).
 * Uma compra de verdade quase nunca cai exatamente em HH:00:00.000.
 */
export const hasRealTime = (d: Date) => d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0;
