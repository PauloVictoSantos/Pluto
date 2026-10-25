// Categoria pelo texto do Pix/boleto (doc. Melhorias, passo 8), sem sair do servidor: palavras que
// dizem o que foi pago ("Pix ESCOLA FUTURO" -> Educacao). Forte = 0,85; fraca = 0,72. Abaixo de 0,70
// a transacao vai para "Revisar".

const COMBINING = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const norm = (s: string) => ` ${s.toLowerCase().normalize('NFD').replace(COMBINING, '').replace(/[^a-z0-9]+/g, ' ')} `;

const STRONG: [RegExp, string][] = [
  [/ (escola|colegio|faculdade|universidade|educacional|ensino|curso|cursos|idiomas|creche|mensalidade escolar|uni[a-z]+ ltda) /, 'educacao'],
  [/ (supermercado|mercado|atacadao|atacarejo|assai|carrefour|hortifruti|acougue|mercearia|sacolao) /, 'mercado'],
  [/ (farmacia|drogaria|droga raia|drogasil|pague menos|hospital|clinica|laboratorio|odonto|dentista|psicolog[a-z]*|fisioterapia|unimed|hapvida) /, 'saude'],
  [/ (academia|smart fit|bluefit|crossfit) /, 'saude'],
  [/ (posto|combustivel|auto posto|shell|ipiranga|petrobras br) /, 'combustivel'],
  [/ (restaurante|lanchonete|pizzaria|padaria|churrascaria|hamburgueria|sorveteria|cafeteria|bar e) /, 'restaurantes'],
  [/ (ifood|rappi|ze delivery) /, 'delivery'],
  [/ (uber|99app|99 pop|cabify|indrive) /, 'transporte-app'],
  [/ (aluguel|imobiliaria|condominio|administradora) /, 'moradia'],
  [/ (energia|eletricidade|saneamento|agua e esgoto|companhia de gas|comgas|enel|equatorial|cemig|copel|sabesp|cosanpa|aguas de) /, 'contas-casa'],
  [/ (vivo|claro|tim|oi fibra|telecom|internet|provedor) /, 'telefone'],
  [/ (seguro|seguradora|porto seguro) /, 'seguros'],
  [/ (estacionamento|pedagio|oficina|autopecas|detran|ipva) /, 'transporte'],
  [/ (cinema|ingresso|teatro|show) /, 'lazer'],
  [/ (hotel|pousada|airbnb|passagem|cia aerea|latam|gol linhas|azul linhas) /, 'viagem'],
];
const WEAK: [RegExp, string][] = [
  [/ (loja|magazine|comercio|store) /, 'compras'],
  [/ (pet|petshop|veterinari[a-z]*) /, 'outros'],
];

export function categoryFromText(text: string): { key: string; confidence: number } | null {
  const t = norm(text);
  const s = STRONG.find(([re]) => re.test(t));
  if (s) return { key: s[1], confidence: 0.85 };
  const w = WEAK.find(([re]) => re.test(t));
  return w ? { key: w[1], confidence: 0.72 } : null;
}
