import { SYSTEM_PROMPT } from './prompt';

// Guardrails do Plutao (doc. Pluton 8.1 e 8.3). Tudo deterministico, no backend: o modelo nao
// decide se uma regra vale. Entrada: classificador de escopo e de injecao + mascara de PII.
// Saida: sem links/imagens, sem trechos do prompt, sem PII e sem numero que nao veio de ferramenta.

export type GuardKind = 'injection' | 'other_user' | 'off_topic';

export interface InputVerdict {
  /** Mensagem barrada (resposta padrao, sem chamar o modelo). */
  block: GuardKind | null;
  /** Pedido para gravar sem confirmacao: segue, mas a confirmacao continua obrigatoria. */
  noConfirmRequest: boolean;
  /** Texto ja mascarado e limpo, que pode ir ao modelo e ao historico. */
  text: string;
}

const INJECTION = [
  /ignor[ae]\w*\s+(as\s+|suas\s+|todas\s+as\s+|essas\s+)?(regras|instru[cç][oõ]es|orienta[cç][oõ]es|restri[cç][oõ]es)/i,
  /esque[cç]a\s+(tudo|as\s+regras|suas\s+(regras|instru))/i,
  /(mostre|mostra|revele|revela|repita|imprima|diga|me\s+(d[aê]|passa))\s+(o\s+|seu\s+|teu\s+|as\s+|suas\s+)?(prompt|instru[cç][oõ]es|regras\s+internas|ferramentas)/i,
  /\b(prompt\s+(de|do)\s+sistema|system\s*prompt)\b/i,
  /voc[eê]\s+(agora\s+)?(é|e|ser[aá]|vai\s+ser)\s+(um|uma|o|a)\s+(outr[oa]|nov[oa]|assistente\s+gen|chatgpt|dan)\b/i,
  /\bmodo\s+(desenvolvedor|developer|dev|deus|admin|irrestrito)\b|\bjailbreak\b|\bDAN\b/,
  /\b(eu\s+)?sou\s+(o\s+|a\s+)?(admin|administrador|desenvolvedor|dono\s+do\s+(app|sistema)|suporte|root)\b/i,
  /^\s*(sistema|system|assistant|assistente|developer)\s*:/im,
  /<\/?\s*(dados|system|sistema|instru)/i,
];
const OTHER_USER = [
  /\b(outr[oa]s?|terceir[oa]s?)\s+(usu[aá]rios?|clientes?|contas?\s+do\s+app)\b/i,
  /\b(do|da|dos)\s+usu[aá]ri[oa]\s+\S+/i,
  /\buser_?id\b/i,
];
const OFF_TOPIC =
  /\b(c[oó]digo|python|javascript|typescript|programa[rç]|sql|html|css|receita\s+de|bolo|cozinhar|pol[ií]tica|elei[cç][aã]o|president[ea]|piada|poema|poesia|letra\s+de\s+m[uú]sica|futebol|filme|novela|traduz|tradu[cç][aã]o|hor[oó]scopo|reda[cç][aã]o|li[cç][aã]o\s+de\s+casa|namor)/i;
const FINANCE =
  /\b(gast|compr|meta|limite|renda|sal[aá]ri|d[ií]vida|parcel|fatura|cart[aã]o|reserva|guard|poupa|investi|juros|contas\b|conta\s+(de|do|da|corrente|banc)|boleto|or[cç]amento|dinheiro|r\$|rea(l|is)|pag|empr[eé]stimo|financ|fix[oa]|aluguel|plano|m[eê]s|sobr)/i;
const NO_CONFIRM = /(sem|n[aã]o\s+precisa(\s+de)?|pul[ae]|dispens[ae])\s+(me\s+)?(pedir\s+|perguntar\s+)?(a\s+)?confirma/i;

/** Mascara PII (8.3): CPF, e-mail, telefone, cartao/conta. Valores em reais ficam. */
export function maskPII(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[cartão]')
    .replace(/(\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
    .replace(/\b(ag[eê]ncia|ag\.?|conta|cc|c\/c)\s*:?\s*\d[\d.-]{3,}\b/gi, '$1 [número]');
}

/** Limpa caracteres de controle e invisiveis (sanitizacao de entrada). */
const INVISIBLE = new RegExp(
  `[${[[0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]].map(([x, y]) => `${String.fromCharCode(x!)}-${String.fromCharCode(y!)}`).join('')}]`,
  'g',
);
const clean = (s: string) => s.replace(INVISIBLE, '').replace(/\s{3,}/g, '  ').trim();

export function classifyInput(raw: string): InputVerdict {
  const text = maskPII(clean(raw));
  const block: GuardKind | null = INJECTION.some((r) => r.test(text))
    ? 'injection'
    : OTHER_USER.some((r) => r.test(text))
      ? 'other_user'
      : OFF_TOPIC.test(text) && !FINANCE.test(text)
        ? 'off_topic'
        : null;
  return { block, noConfirmRequest: NO_CONFIRM.test(text), text };
}

/** Resposta padrao para o que foi barrado: curta e de volta ao plano. */
export const REFUSAL: Record<GuardKind, string> = {
  injection: 'Não mudo minhas regras nem mostro como funciono por dentro. As regras do plano valem do mesmo jeito para todo mundo. Voltando ao seu plano: quer ver como está o mês?',
  other_user: 'Só trabalho com os seus dados. De outras pessoas, nada. Quer ver os seus gastos do mês?',
  off_topic: 'Isso está fora do que eu faço. Voltando ao seu plano: tem alguma compra ou meta para avaliar?',
};

/** Dados de ferramenta: so estrutura; texto livre nao carrega marcacao que pareca instrucao. */
export function asData<T>(v: T): T {
  if (typeof v === 'string') return v.replace(/[<>]/g, '').slice(0, 500) as T;
  if (Array.isArray(v)) return v.map(asData) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, asData(x)])) as T;
  return v;
}

const COMBINING = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
// Trechos do prompt: qualquer sequencia de 7 palavras igual ao prompt bloqueia a resposta.
const words = (s: string) => s.toLowerCase().normalize('NFD').replace(COMBINING, '').match(/[a-z0-9]+/g) ?? [];
const PROMPT_GRAMS = (() => {
  const w = words(SYSTEM_PROMPT), set = new Set<string>();
  for (let i = 0; i + 7 <= w.length; i++) set.add(w.slice(i, i + 7).join(' '));
  return set;
})();
export function leaksPrompt(text: string): boolean {
  const w = words(text);
  for (let i = 0; i + 7 <= w.length; i++) if (PROMPT_GRAMS.has(w.slice(i, i + 7).join(' '))) return true;
  return /REGRAS ABSOLUTAS/.test(text);
}

/** Guardrail de saida: sem prompt, links, imagens, markdown pesado, IDs internos nem PII. */
export function sanitizeReply(text: string): string {
  if (leaksPrompt(text)) return 'Isso eu não compartilho. Voltando ao seu plano: em que posso ajudar?';
  return maskPII(
    text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/https?:\/\/\S+|www\.\S+|\b[\w-]+\.(com|net|org|io|br|xyz|ru|ly)(\/\S*)?\b/gi, '[link removido]')
      .replace(/\b[a-f0-9]{24}\b/gi, '[id]')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, ''),
  ).trim();
}

/** "R$ 1.234,56" -> 1234.56; "R$ 5 mil" -> 5000. */
const MONEY = /R\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(\s?mil\b)?/gi;
const toNumber = (n: string, mil?: string) => Number(n.replace(/\./g, '').replace(',', '.')) * (mil ? 1000 : 1);

export function moneyIn(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => toNumber(m[1]!, m[2]));
}

/** Numeros soltos (em reais) que o usuario escreveu: "1500", "1.500,00", "5 mil". */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(\s?mil\b)?/gi)].map((m) => toNumber(m[1]!, m[2]));
}

/** Todos os numeros de uma resposta de ferramenta (recursivo). */
export function numbersOf(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number') out.push(v);
  else if (typeof v === 'string') out.push(...moneyIn(v));
  else if (Array.isArray(v)) v.forEach((x) => numbersOf(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => numbersOf(x, out));
  return out;
}

/** Valores em R$ da resposta que nao batem com nenhum numero conhecido (tolerancia de arredondamento). */
export function unverifiedMoney(reply: string, known: number[]): number[] {
  return moneyIn(reply).filter((v) => !known.some((k) => Math.abs(k - v) <= Math.max(0.01, Math.abs(k) * 0.01)));
}

/** Tira as frases com valores nao conferidos. */
export function dropSentencesWith(reply: string, values: number[]): string {
  const bad = new Set(values);
  const kept = reply.split(/(?<=[.!?])\s+/).filter((s) => !moneyIn(s).some((v) => bad.has(v)));
  return `${kept.join(' ').trim()} (Tirei valores que não consegui conferir nas suas contas.)`.trim();
}
