import { categoryOf } from './categories';

// Icone de gasto fixo (doc. Melhorias, passo 7): pelo nome quando ele diz o que e (Aluguel -> casa,
// Internet -> wifi, Energia -> raio, Streaming -> tv, Academia -> haltere); senao, o da categoria.
// Servicos conhecidos (Netflix, Spotify...) usam o logo da marca no app (brandOf + MerchantLogo).

const COMBINING = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(COMBINING, '');

const RULES: [RegExp, string][] = [
  [/\b(aluguel|financiamento (da )?casa|moradia|iptu)\b/, 'house'],
  [/\bcondominio\b/, 'building'],
  [/\b(internet|wi-?fi|fibra|banda larga)\b/, 'wifi'],
  [/\b(energia|luz|eletric|enel|cemig|copel|light|equatorial|amazonas energia)/, 'zap'],
  [/\b(agua|saneamento|sabesp|cedae|copasa|aguas)\b/, 'droplet'],
  [/\b(gas|comgas|botijao)\b/, 'flame'],
  [/\b(celular|telefone|plano (de )?celular|vivo|claro|tim|oi)\b/, 'smartphone'],
  [/\b(streaming|netflix|prime video|disney|globoplay|hbo|max|youtube|tv)\b/, 'tv'],
  [/\b(academia|gym|smart ?fit|bluefit|crossfit|personal|pilates)\b/, 'dumbbell'],
  [/\b(escola|faculdade|curso|mensalidade escolar|ingles|universidade|colegio)\b/, 'graduation-cap'],
  [/\b(plano de saude|unimed|amil|hapvida|bradesco saude|sulamerica|odonto|dentista|terapia|psicolog)/, 'heart-pulse'],
  [/\b(seguro)\b/, 'shield'],
  [/\b(carro|ipva|estacionamento|garagem)\b/, 'car'],
  [/\b(combustivel|gasolina)\b/, 'fuel'],
  [/\b(diarista|faxina|empregada|babá|baba)\b/, 'house'],
  [/\b(spotify|deezer|musica)\b/, 'tv'],
];

export function fixedIconOf(name: string, categoryKey?: string | null): string {
  const n = norm(name);
  return RULES.find(([re]) => re.test(n))?.[1] ?? categoryOf(categoryKey).icon;
}
