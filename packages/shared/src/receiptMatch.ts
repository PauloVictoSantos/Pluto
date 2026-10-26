// Pareamento entre o nome na lista de compras e a linha do cupom fiscal (doc. Melhorias, passo 10):
// sem acento, no singular, sem tamanho/embalagem e com sinonimos e abreviacoes de cupom
// ("refri" = "refrigerante" = "REFRIG"; "CAFE PILAO 500G" tem "cafe").

const COMBINING = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/** Abreviacoes comuns em cupom e apelidos -> palavra canonica. */
const SYNONYMS: Record<string, string> = {
  refri: 'refrigerante', refrig: 'refrigerante', refrigerant: 'refrigerante',
  deterg: 'detergente', det: 'detergente',
  feij: 'feijao', acuc: 'acucar', acucar: 'acucar',
  achoc: 'achocolatado', marg: 'margarina', mant: 'manteiga',
  bisc: 'biscoito', biscoit: 'biscoito', bolach: 'biscoito', bolacha: 'biscoito',
  queij: 'queijo', iog: 'iogurte', iogurt: 'iogurte',
  cerv: 'cerveja', sab: 'sabonete', sabon: 'sabonete',
  amac: 'amaciante', desinf: 'desinfetante', hig: 'higienico', papelhig: 'papel higienico',
  frgo: 'frango', frang: 'frango', macarr: 'macarrao', mac: 'macarrao',
  oleo: 'oleo', azeit: 'azeite', tomat: 'tomate', batat: 'batata', cebol: 'cebola',
  banan: 'banana', leit: 'leite', choc: 'chocolate', chocol: 'chocolate', pao: 'pao',
};
/** Tamanho, embalagem e ruido de cupom: nao identificam o item. */
const NOISE = /^(\d+([.,]\d+)?(kg|g|gr|l|lt|ml|un|und|pct|cx|dz|m|cm|x)?|kg|g|gr|l|lt|ml|un|und|pct|cx|dz|pc|c|cx\d+|tp|tradicional|trad|unidade|und|emb|int|integral\d*)$/;

const singular = (w: string) => (w.length > 4 && w.endsWith('es') && !w.endsWith('ces') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/** Palavras que identificam o item. */
export function itemTokens(name: string): string[] {
  const words = name
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/[^a-z0-9.,]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  return words.filter((w) => !NOISE.test(w)).map((w) => SYNONYMS[w] ?? SYNONYMS[singular(w)] ?? singular(w));
}

/** O item da lista ("Café", "Refri") esta nesta linha do cupom? Todas as palavras dele aparecem. */
export function matchesItem(listName: string, receiptName: string): boolean {
  const want = itemTokens(listName).flatMap((w) => w.split(' '));
  if (!want.length) return false;
  const have = new Set(itemTokens(receiptName).flatMap((w) => w.split(' ')));
  return want.every((w) => have.has(w));
}

/** Nome limpo para o catalogo: "CAFE PILAO 500G" -> "Cafe pilao". */
export function cleanItemName(receiptName: string): string {
  const words = receiptName
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w && !NOISE.test(w.normalize('NFD').replace(COMBINING, '')));
  const s = words.slice(0, 4).join(' ');
  return s ? s[0]!.toUpperCase() + s.slice(1) : receiptName.trim();
}
