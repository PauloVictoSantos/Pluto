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
