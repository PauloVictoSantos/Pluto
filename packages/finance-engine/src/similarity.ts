// Similaridade de texto entre descricoes de estabelecimento (agrupamento "UBER *TRIP SP" ~ "UBER TRIP").

/** Ruido comum das descricoes de cartao que nao identifica o estabelecimento. */
const NOISE = new Set(['trip', 'help', 'com', 'www', 'br', 'sp', 'rj', 'mg', 'pr', 'sc', 'rs', 'ba', 'df', 'go', 'am', 'pe', 'ce', 'pa', 'brasil', 'ltda', 'me', 'sa', 'pagamento', 'pag', 'compra', 'online', 'app']);

/** Texto do estabelecimento sem ruido: "uber uber trip help uber com" -> "uber". */
export function brandKey(text: string): string {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !NOISE.has(w));
  return [...new Set(words)].join(' ') || text.toLowerCase().trim();
}

/** Trigramas de caracteres (com bordas): robustos a abreviacao e erro de digitacao. */
export function trigrams(s: string): Set<string> {
  const t = ` ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

/** Grupo mais parecido acima do limite (comparando com todos os textos ja agrupados), ou null. */
export function bestGroup(key: string, groups: readonly { id: string; keys: readonly string[] }[], threshold = 0.6): { id: string; score: number } | null {
  const k = brandKey(key);
  let best: { id: string; score: number } | null = null;
  for (const g of groups)
    for (const other of g.keys) {
      const score = trigramSimilarity(k, brandKey(other));
      if (score >= threshold && (!best || score > best.score)) best = { id: g.id, score };
    }
  return best;
}
