// Formatacao para a tela (o app nao calcula valores: so mostra o que a API devolve).

export const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** Centavos -> "R$ 1.234,56". */
export const brl = (minor: number) => (minor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Mascara de CPF enquanto digita: 123.456.789-09. */
export function maskCpf(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Campo de dinheiro: digitos viram centavos ("150000" -> R$ 1.500,00). */
export function maskMoney(raw: string): { text: string; minor: number } {
  const d = onlyDigits(raw).slice(0, 11);
  const minor = d ? Number(d) : 0;
  return { text: d ? brl(minor) : '', minor };
}

/** Fracao -> "45%". */
export const pct = (x: number) => `${Math.round(x * 100)}%`;
