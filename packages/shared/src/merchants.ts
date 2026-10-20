// Nomes faceis das descricoes do banco ("MP *GUICHEWEB" -> "Ingresso"). Busca por palavra-chave, sem
// diferenciar maiusculas, acentos ou simbolos. A ordem importa: o primeiro que casar vence (os mais
// especificos primeiro). O logo de cada marca fica no app web (lib/merchants.tsx), nunca desenhado.

export interface MerchantBrand {
  /** Identificador do logo: simple-icons, /public/banks ou /public/logos/<slug>.svg. */
  slug: string;
  name: string;
  /** Categoria sugerida (padrao "Automatica" na compra manual). */
  categoryKey: string;
  /** Palavras-chave na descricao normalizada (sem espacos e sem acento). */
  keys: string[];
  /** Cor oficial da marca, usada no circulo quando nao ha logo. */
  color: string;
}

export const MERCHANT_BRANDS: MerchantBrand[] = [
  { slug: 'fatura', name: 'Pagamento de fatura', categoryKey: 'fatura', keys: ['pagamentofatura', 'pagamentoefetuado', 'pagtofatura', 'pgtofatura'], color: '#16A34A' },
  { slug: 'iof', name: 'IOF e juros', categoryKey: 'taxas', keys: ['iof', 'juros', 'encargos'], color: '#EF4444' },
  { slug: 'ubereats', name: 'Uber Eats', categoryKey: 'delivery', keys: ['ubereats'], color: '#06C167' },
  { slug: 'uber', name: 'Uber', categoryKey: 'transporte-app', keys: ['uber'], color: '#000000' },
  { slug: '99', name: '99', categoryKey: 'transporte-app', keys: ['99pop', '99app', '99taxi', '99moto', '99tecnologia'], color: '#FFDD00' },
  { slug: 'ifood', name: 'iFood', categoryKey: 'delivery', keys: ['ifood'], color: '#EA1D2C' },
  { slug: 'shopee', name: 'Shopee', categoryKey: 'compras', keys: ['shopee', 'shpste'], color: '#EE4D2D' },
  { slug: 'shein', name: 'Shein', categoryKey: 'compras', keys: ['shein'], color: '#000000' },
  { slug: 'amazon', name: 'Amazon', categoryKey: 'compras', keys: ['amazon', 'amzn', 'amazonprime'], color: '#FF9900' },
  { slug: 'aliexpress', name: 'AliExpress', categoryKey: 'compras', keys: ['aliexpress'], color: '#FF4747' },
  { slug: 'mercadolivre', name: 'Mercado Livre', categoryKey: 'compras', keys: ['mercadolivre', 'mercadolibre', 'mlivre'], color: '#FFE600' },
  { slug: 'sporty', name: 'Sporty', categoryKey: 'lazer', keys: ['sporty'], color: '#0EA5E9' },
  { slug: 'ingresso', name: 'Ingresso', categoryKey: 'lazer', keys: ['guicheweb', 'ingresso', 'sympla', 'eventim', 'ticketmaster'], color: '#7C3AED' },
  { slug: 'aliancasmanaus', name: 'Alianças Manaus', categoryKey: 'compras', keys: ['aliancasmanaus'], color: '#B45309' },
  { slug: 'netflix', name: 'Netflix', categoryKey: 'assinaturas', keys: ['netflix'], color: '#E50914' },
  { slug: 'spotify', name: 'Spotify', categoryKey: 'assinaturas', keys: ['spotify'], color: '#1DB954' },
  { slug: 'youtube', name: 'YouTube', categoryKey: 'assinaturas', keys: ['youtube', 'googleyoutube'], color: '#FF0000' },
  { slug: 'max', name: 'Max', categoryKey: 'assinaturas', keys: ['hbomax', 'maxcom'], color: '#002BE7' },
  { slug: 'paramountplus', name: 'Paramount+', categoryKey: 'assinaturas', keys: ['paramount'], color: '#0064FF' },
  { slug: 'crunchyroll', name: 'Crunchyroll', categoryKey: 'assinaturas', keys: ['crunchyroll'], color: '#F47521' },
  { slug: 'deezer', name: 'Deezer', categoryKey: 'assinaturas', keys: ['deezer'], color: '#A238FF' },
  { slug: 'steam', name: 'Steam', categoryKey: 'lazer', keys: ['steam', 'valvesteam'], color: '#000000' },
  { slug: 'playstation', name: 'PlayStation', categoryKey: 'lazer', keys: ['playstation', 'sonyinteractive'], color: '#0070D1' },
  { slug: 'mcdonalds', name: "McDonald's", categoryKey: 'restaurantes', keys: ['mcdonalds', 'arcosdourados'], color: '#FBC817' },
  { slug: 'burgerking', name: 'Burger King', categoryKey: 'restaurantes', keys: ['burgerking'], color: '#D62300' },
  { slug: 'kfc', name: 'KFC', categoryKey: 'restaurantes', keys: ['kfc'], color: '#F40027' },
  { slug: 'starbucks', name: 'Starbucks', categoryKey: 'restaurantes', keys: ['starbucks'], color: '#006241' },
  { slug: 'mercadopago', name: 'Mercado Pago', categoryKey: 'outros', keys: ['mercadopago'], color: '#00B1EA' },
  // Genericos por ultimo: so quando nenhuma marca casou.
  { slug: 'restaurante', name: 'Restaurante', categoryKey: 'restaurantes', keys: ['restaurante', 'churrasc', 'pizzaria', 'lanchonete', 'hamburgueria'], color: '#F59E0B' },
];

/** Minusculas, sem acento e sem nada alem de letras e numeros: "MP *GUICHE WEB" -> "mpguicheweb". */
export const compactText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Marca da descricao do banco, ou null (a tela mostra a descricao original). */
export function brandOf(description: string): MerchantBrand | null {
  const t = compactText(description);
  // Chave curta ("iof", "uber", "kfc") so como palavra inteira: "BIOFARMA" nao e IOF, "UBERLANDIA" nao e Uber.
  const words = new Set(
    description
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/),
  );
  return MERCHANT_BRANDS.find((b) => b.keys.some((k) => (k.length <= 4 ? words.has(k) : t.includes(k)))) ?? null;
}

/** Palavras-chave das marcas cujo nome casa com o termo buscado ("ingresso" -> guicheweb, sympla...). */
export function brandKeysFor(term: string): string[] {
  const t = compactText(term);
  if (t.length < 2) return [];
  return MERCHANT_BRANDS.filter((b) => compactText(b.name).includes(t)).flatMap((b) => b.keys);
}
