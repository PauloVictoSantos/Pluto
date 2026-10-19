import { cv, median, quantile, rng } from './stats';

// Previsao, orcamento, metas e boletos (doc. "Previsao, metas e boletos"). Funcoes puras.
// Toda previsao sai como faixa (P10, P50, P90) e probabilidade, nunca valor unico (RN-M05).

export interface Range {
  p10: number;
  p50: number;
  p90: number;
}

const range = (xs: number[]): Range => ({ p10: quantile(xs, 0.1), p50: quantile(xs, 0.5), p90: quantile(xs, 0.9) });

/**
 * Gasto variavel do resto do mes por bootstrap em blocos semanais: cada bloco de 7 dias restantes
 * recebe uma semana inteira sorteada do historico e usa o gasto do mesmo dia da semana, preservando
 * o habito de fim de semana. weeks[w][dow] = gasto do dia (positivo), dow 0 = domingo.
 */
export function simulateVariable(weeks: readonly (readonly number[])[], remainingDows: readonly number[], sims = 10_000, seed = 1): number[] {
  if (!weeks.length || !remainingDows.length) return Array(sims).fill(0);
  const rand = rng(seed);
  const out = new Array<number>(sims);
  for (let s = 0; s < sims; s++) {
    let total = 0, week = weeks[0]!;
    for (let i = 0; i < remainingDows.length; i++) {
      if (i % 7 === 0) week = weeks[Math.floor(rand() * weeks.length)]!;
      total += week[remainingDows[i]!]!;
    }
    out[s] = total;
  }
  return out;
}

export interface MonthEndInput {
  /** Saldo atual das contas (corrente + poupanca). */
  balance: number;
  /** Conhecido ate o fim do mes: receitas previstas - boletos/faturas - parcelas - fixas. */
  knownNet: number;
  weeks: readonly (readonly number[])[];
  remainingDows: readonly number[];
  sims?: number;
  seed?: number;
}

export interface MonthEnd extends Range {
  /** P(saldo final >= 0). */
  probPositive: number;
  variable: Range;
}

/** S_fim = S_d + conhecido - variavel (Monte Carlo). */
export function monthEnd(i: MonthEndInput): MonthEnd {
  const v = simulateVariable(i.weeks, i.remainingDows, i.sims, i.seed);
  const ends = v.map((x) => i.balance + i.knownNet - x);
  return { ...range(ends), probPositive: ends.filter((x) => x >= 0).length / ends.length, variable: range(v) };
}

/**
 * Perfil do mes: fracao acumulada tipica do gasto ate cada dia (mediana dos meses). months[m][d-1] =
 * gasto do dia d. Retorna F(d) para d = 1..31.
 */
export function monthProfile(months: readonly (readonly number[])[]): number[] {
  const fracs = months
    .map((days) => {
      const total = days.reduce((s, x) => s + x, 0);
      if (total <= 0) return null;
      let acc = 0;
      return Array.from({ length: 31 }, (_, d) => ((acc += days[d] ?? 0), acc / total));
    })
    .filter((f): f is number[] => !!f);
  return Array.from({ length: 31 }, (_, d) => (fracs.length ? median(fracs.map((f) => f[d]!)) : (d + 1) / 31));
}

/** Controle cruzado: total do mes estimado pelo perfil, S_gasto(d) / F(d). */
export const profileEstimate = (spentSoFar: number, fractionAtDay: number) => (fractionAtDay > 0.02 ? spentSoFar / fractionAtDay : null);

/** As duas estimativas divergem mais de 25%? Entao o alerta usa a mais conservadora. */
export const diverges = (a: number, b: number) => Math.abs(a - b) > 0.25 * Math.max(Math.abs(a), Math.abs(b), 1);

// ---------------------------------------------------------------------------------------------
// Orcamento sugerido

export interface CategoryHabit {
  key: string;
  /** Totais mensais da categoria (meses fechados). */
  monthly: readonly number[];
}

export interface BudgetLine {
  key: string;
  q10: number;
  q60: number;
  cv: number;
  weight: number;
  limit: number;
}

/**
 * min sum w_c (L_c - q60_c)^2  s.a.  sum L_c <= disponivel, L_c >= q10_c, com w_c = 1/CV_c.
 * Forma fechada L_c = max(q10_c, q60_c - theta/(2 w_c)); theta por bisseccao. Categorias estaveis
 * (CV baixo, peso alto) sao cortadas pouco; as volateis absorvem o ajuste.
 */
export function suggestBudget(habits: readonly CategoryHabit[], available: number): { lines: BudgetLine[]; fits: boolean } {
  const lines: BudgetLine[] = habits
    .filter((h) => h.monthly.length > 0)
    .map((h) => {
      const c = cv(h.monthly);
      // CV zero (gasto identico todo mes) ou indefinido: peso alto, quase nao corta.
      const weight = Number.isFinite(c) && c > 0.01 ? 1 / c : 100;
      const q10 = quantile(h.monthly, 0.1), q60 = quantile(h.monthly, 0.6);
      return { key: h.key, q10, q60, cv: Number.isFinite(c) ? c : 0, weight, limit: q60 };
    });
  const at = (theta: number) => lines.reduce((s, l) => s + Math.max(l.q10, l.q60 - theta / (2 * l.weight)), 0);
  if (at(0) <= available) return { lines, fits: true };
  const floor = lines.reduce((s, l) => s + l.q10, 0);
  if (floor > available) return { lines: lines.map((l) => ({ ...l, limit: l.q10 })), fits: false };
  let lo = 0, hi = 1;
  while (at(hi) > available) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > available) lo = mid;
    else hi = mid;
  }
  return { lines: lines.map((l) => ({ ...l, limit: Math.max(l.q10, l.q60 - hi / (2 * l.weight)) })), fits: true };
}

// ---------------------------------------------------------------------------------------------
// Metas

/** Aporte mensal para chegar a FV em n meses partindo de PV, com rendimento mensal r. */
export function pmt(fv: number, pv: number, r: number, n: number): number {
  if (n <= 0) return Math.max(0, fv - pv);
  if (r === 0) return Math.max(0, (fv - pv) / n);
  const g = (1 + r) ** n;
  return Math.max(0, ((fv - pv * g) * r) / (g - 1));
}

export interface GoalInput {
  id: string;
  /** Quanto falta. */
  remaining: number;
  /** Meses ate o prazo (inteiro >= 0). */
  months: number;
  /** 1 (mais importante) a 5. */
  priority: number;
}

/**
 * Chance de cada meta cumprir o prazo: bootstrap dos meses observados de sobra; a sobra de cada mes vai
 * para as metas por prioridade (RN-M01). Mes no vermelho nao tira dinheiro de meta (RN-M04).
 * extra: valor a mais guardado por mes (para "com R$ X a menos em lazer").
 */
export function goalChances(goals: readonly GoalInput[], surpluses: readonly number[], opts: { sims?: number; seed?: number; extra?: number } = {}): Map<string, number> {
  const sims = opts.sims ?? 5000, extra = opts.extra ?? 0;
  const order = [...goals].sort((a, b) => a.priority - b.priority || a.months - b.months);
  const horizon = Math.max(0, ...order.map((g) => g.months));
  const hits = new Map(order.map((g) => [g.id, 0]));
  if (!surpluses.length) return new Map(order.map((g) => [g.id, g.remaining <= 0 ? 1 : 0]));
  const rand = rng(opts.seed ?? 7);
  for (let s = 0; s < sims; s++) {
    const left = new Map(order.map((g) => [g.id, g.remaining]));
    for (let m = 0; m < horizon; m++) {
      let free = Math.max(0, surpluses[Math.floor(rand() * surpluses.length)]! + extra);
      for (const g of order) {
        if (m >= g.months || free <= 0) continue;
        const need = left.get(g.id)!;
        const put = Math.min(need, free);
        left.set(g.id, need - put);
        free -= put;
      }
    }
    for (const g of order) if (left.get(g.id)! <= 0) hits.set(g.id, hits.get(g.id)! + 1);
  }
  return new Map([...hits].map(([id, h]) => [id, h / sims]));
}

/** Quanto guardar a mais por mes para a meta chegar a chance alvo (bisseccao); null se nem 10x a sobra resolve. */
export function extraForChance(goalId: string, goals: readonly GoalInput[], surpluses: readonly number[], target = 0.85, opts: { sims?: number; seed?: number } = {}): number | null {
  const chance = (extra: number) => goalChances(goals, surpluses, { ...opts, extra }).get(goalId) ?? 0;
  if (chance(0) >= target) return 0;
  const cap = Math.max(...goals.map((g) => g.remaining), 1);
  if (chance(cap) < target) return null;
  let lo = 0, hi = cap;
  for (let i = 0; i < 30 && hi - lo > 100; i++) {
    const mid = (lo + hi) / 2;
    if (chance(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

// ---------------------------------------------------------------------------------------------
// Boletos, faturas e rotativo

export interface DelayTerms {
  /** Juros mensais (rotativo do cartao ou mora do boleto), ex.: 0,14. */
  monthlyRate: number;
  /** Multa fixa sobre o valor, ex.: 0,02. */
  fine: number;
  /** Cobra IOF de pessoa fisica (0,38% + 0,0082% ao dia): rotativo de cartao. */
  iof: boolean;
}

/** C(V, d) = V[(1+i)^(d/30) - 1] + IOF + multa. */
export function delayCost(v: number, days: number, t: DelayTerms): number {
  if (v <= 0 || days <= 0) return 0;
  const interest = v * ((1 + t.monthlyRate) ** (days / 30) - 1);
  const iof = t.iof ? v * (0.0038 + 0.000082 * days) : 0;
  return interest + iof + v * t.fine;
}

export interface Payable {
  id: string;
  amount: number;
  terms: DelayTerms;
}

/**
 * Ordem de pagamento com dinheiro insuficiente: maior custo por real atrasado (30 dias) primeiro
 * (mochila fracionaria: o guloso e otimo). Retorna a ordem e quanto de cada um cabe no disponivel.
 */
export function paymentOrder(items: readonly Payable[], available: number): { id: string; costPerReal: number; pay: number; cost30: number }[] {
  let left = Math.max(0, available);
  return items
    .map((p) => ({ p, costPerReal: p.amount > 0 ? delayCost(p.amount, 30, p.terms) / p.amount : 0 }))
    .sort((a, b) => b.costPerReal - a.costPerReal)
    .map(({ p, costPerReal }) => {
      const pay = Math.min(p.amount, left);
      left -= pay;
      return { id: p.id, costPerReal, pay, cost30: delayCost(p.amount - pay, 30, p.terms) };
    });
}

// ---------------------------------------------------------------------------------------------
// Avaliacao (RN-I04): o modelo so liga se vencer a linha de base no backtest walk-forward.

export interface BacktestPoint {
  actual: number;
  baseline: number;
  model: Range;
}

export function evaluate(points: readonly BacktestPoint[]) {
  if (!points.length) return { n: 0, maeModel: NaN, maeBaseline: NaN, coverage: NaN, beatsBaseline: false };
  const mae = (f: (p: BacktestPoint) => number) => points.reduce((s, p) => s + Math.abs(f(p) - p.actual), 0) / points.length;
  const maeModel = mae((p) => p.model.p50), maeBaseline = mae((p) => p.baseline);
  const coverage = points.filter((p) => p.actual >= p.model.p10 && p.actual <= p.model.p90).length / points.length;
  return { n: points.length, maeModel, maeBaseline, coverage, beatsBaseline: maeModel <= maeBaseline };
}
