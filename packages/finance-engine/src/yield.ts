// Rendimento das caixinhas e investimentos (Investimentos): taxa anual a partir do indice do
// produto (% do CDI, Selic, IPCA + x%, prefixado) e projecao com juros compostos. Bruto, antes do IR.

export interface MarketRates {
  /** Taxas anuais (0,1415 = 14,15% a.a.). */
  cdi: number;
  selic: number;
  ipca: number;
}

export interface RateInput {
  rate?: number | null;
  rateType?: string | null;
  fixedAnnualRate?: number | null;
  lastTwelveMonthsRate?: number | null;
  /** Texto antigo ("100% CDI", "12,5% a.a.") quando os campos estruturados nao existem. */
  rateInfo?: string | null;
}

export interface AnnualRate {
  annual: number;
  label: string;
  /** true: sem taxa informada, vale a referencia (rendimento do dinheiro guardado). */
  estimated: boolean;
}

const pctBr = (v: number, d = 2) => `${(v * 100).toFixed(d).replace('.', ',').replace(/,?0+$/, '')}%`;

/** Taxa anual do produto. fallback: rendimento de referencia anual (quando o banco nao informa). */
export function annualRateOf(i: RateInput, m: MarketRates, fallback: number): AnnualRate {
  let { rate, rateType, fixedAnnualRate } = i;
  if (rate == null && fixedAnnualRate == null && i.rateInfo) {
    const t = /([\d.,]+)\s*%\s*(CDI|SELIC|IPCA|IGPM|a\.a\.|PRE)?/i.exec(i.rateInfo);
    if (t) {
      const v = Number(t[1]!.replace(/\./g, '').replace(',', '.'));
      const kind = (t[2] ?? '').toUpperCase();
      if (kind === 'A.A.' || kind === 'PRE' || !kind) fixedAnnualRate = v;
      else {
        rate = v;
        rateType = kind;
      }
    }
  }
  const type = (rateType ?? '').toUpperCase();
  const fixed = (fixedAnnualRate ?? 0) / 100;
  if (type === 'CDI' && rate != null) return { annual: (m.cdi * rate) / 100 + fixed, label: `${pctBr(rate / 100, 1)} do CDI${fixed ? ` + ${pctBr(fixed)}` : ''}`, estimated: false };
  if (type === 'SELIC' && rate != null) return { annual: (m.selic * rate) / 100 + fixed, label: `${pctBr(rate / 100, 1)} da Selic`, estimated: false };
  if (type === 'IPCA' || type === 'IGPM') {
    // IPCA + x%: (1 + IPCA)(1 + x) - 1. "rate" as vezes traz o spread no lugar do fixo.
    const spread = fixed || (rate != null && rate < 30 ? rate / 100 : 0);
    return { annual: (1 + m.ipca) * (1 + spread) - 1, label: `${type} + ${pctBr(spread)}`, estimated: false };
  }
  if (fixedAnnualRate != null && fixed > 0) return { annual: fixed, label: `${pctBr(fixed)} ao ano`, estimated: false };
  if (i.lastTwelveMonthsRate != null) return { annual: i.lastTwelveMonthsRate / 100, label: `${pctBr(i.lastTwelveMonthsRate / 100)} nos últimos 12 meses`, estimated: true };
  return { annual: fallback, label: `${pctBr(fallback)} ao ano (estimado)`, estimated: true };
}

/** Poupanca: 0,5% ao mes (+TR, ignorada) com Selic acima de 8,5%; senao 70% da Selic. */
export const savingsAnnual = (m: MarketRates) => (m.selic > 0.085 ? Math.pow(1.005, 12) - 1 : m.selic * 0.7);

/** Quanto rende em `months` meses (juros compostos), sem aportes. */
export const growthMinor = (valueMinor: number, annual: number, months: number) => Math.round(valueMinor * (Math.pow(1 + annual, months / 12) - 1));

/** Meses ate chegar ao alvo com o rendimento e o aporte mensal; null se nao chega em 50 anos. */
export function monthsToTarget(valueMinor: number, targetMinor: number, annual: number, monthlyMinor: number): number | null {
  if (valueMinor >= targetMinor) return 0;
  const r = Math.pow(1 + annual, 1 / 12) - 1;
  let v = valueMinor;
  for (let n = 1; n <= 600; n++) {
    v = v * (1 + r) + monthlyMinor;
    if (v >= targetMinor) return n;
  }
  return null;
}
