// Formatacao para a tela (o app nao calcula valores: so mostra o que a API devolve).

export const onlyDigits = (v: string) => v.replace(/\D/g, '');

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Mascara de "ocultar valores" (olho do cabecalho, como no site). */
export const VALUE_MASK = 'R$ ••••';
let valuesHidden = false;
export const setValuesHidden = (h: boolean) => void (valuesHidden = h);

/** Centavos -> "R$ 1.234,56", sem mascara (campos de digitacao e respostas pedidas no chat). */
export const brl = (minor: number) => BRL.format(minor / 100);
/** Todo dinheiro mostrado na tela passa por aqui: com valores ocultos, vira R$ ••••. */
export const money = (minor: number) => (valuesHidden ? VALUE_MASK : brl(minor));

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

export const MESES = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
export const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** "2026-10-15..." -> "15 out." */
export const fmtDay = (iso: string) => {
  const [, m, dd] = iso.slice(0, 10).split('-');
  return `${+dd!} ${MESES[+m! - 1]}`;
};
/** "2026-10-15..." -> "15 out. 2026" */
export const fmtDayFull = (iso: string) => {
  const [y, m, dd] = iso.slice(0, 10).split('-');
  return `${+dd!} ${MESES[+m! - 1]} ${y}`;
};
