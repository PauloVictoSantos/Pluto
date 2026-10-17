/**
 * descriptionNorm (secao 4.3): minusculas, sem acentos e sem ruido (numeros de
 * autorizacao, datas, simbolos). Base para regras de categorizacao e busca.
 */
export function normalizeDescription(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, ' ')
    .replace(/[*#\-_/\\|.,:;()[\]{}]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escapa texto do usuario para uso literal em $regex (sem operadores do usuario). */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Palavras de "envelope" do banco: nao identificam quem recebeu ou pagou.
const ENVELOPE = new Set(['pix', 'enviado', 'enviada', 'recebido', 'recebida', 'transf', 'transferencia', 'ted', 'doc', 'qr', 'code', 'dinamico', 'estatico', 'com', 'saldo', 'des', 'docto', 'agendado', 'agendada']);

/**
 * Chave de agrupamento para regras de categoria: a descricao sem o envelope do banco.
 * "PIX ENVIADO - DES Fulano de Tal 30/09 - DOCTO: 123" e "PIX ENVIADO FULANO DE TAL COM SALDO"
 * viram "fulano de tal".
 */
export function matchKeyOf(description: string): string {
  const norm = normalizeDescription(description);
  const key = norm
    .split(' ')
    .filter((w) => !ENVELOPE.has(w))
    .join(' ');
  return key || norm;
}
