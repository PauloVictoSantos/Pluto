import type { MarketRates } from '@pluto/finance-engine';

// Taxas de mercado para projetar rendimento: CDI (serie 4389), Selic meta (432) e IPCA 12 meses
// (13522) do Banco Central (SGS). A API do BC as vezes falha ou demora: guarda por 12 h e, sem
// resposta, usa a referencia do usuario (rendimento do dinheiro guardado) e avisa na tela.

const SGS = (serie: number) => `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`;
const TTL = 12 * 3_600_000;
let cache: { at: number; rates: MarketRates } | null = null;

async function last(serie: number, fetchImpl: typeof fetch): Promise<number> {
  const res = await fetchImpl(SGS(serie), { signal: AbortSignal.timeout(6_000) });
  if (!res.ok) throw new Error(`BCB ${res.status}`);
  const [row] = (await res.json()) as { valor: string }[];
  const v = Number(String(row?.valor).replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0 || v > 100) throw new Error('BCB valor invalido');
  return v / 100;
}

export async function marketRates(referenceMonthly: number, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<MarketRates & { source: 'bcb' | 'referencia'; at: string }> {
  if (cache && now - cache.at < TTL) return { ...cache.rates, source: 'bcb', at: new Date(cache.at).toISOString() };
  try {
    const [cdi, selic, ipca] = await Promise.all([last(4389, fetchImpl), last(432, fetchImpl), last(13522, fetchImpl)]);
    cache = { at: now, rates: { cdi, selic, ipca } };
    return { cdi, selic, ipca, source: 'bcb', at: new Date(now).toISOString() };
  } catch {
    const annual = Math.pow(1 + referenceMonthly, 12) - 1;
    return { cdi: annual, selic: annual, ipca: 0.045, source: 'referencia', at: new Date(now).toISOString() };
  }
}

/** So para testes. */
export const resetMarketRates = () => void (cache = null);
