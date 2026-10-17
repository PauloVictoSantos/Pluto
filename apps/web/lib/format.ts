// Formatadores de exibicao (pt-BR). Valores aqui sao em reais, apenas para a UI.

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Mascara de 'ocultar valores' (estado global em lib/store, salvo no aparelho). */
export const VALUE_MASK = 'R$ ••••';
let valuesHidden = false;
export const setValuesHidden = (h: boolean) => void (valuesHidden = h);

/** Todo dinheiro da interface passa por aqui: com valores ocultos, vira R$ ••••. */
export const fmt = (v: number) => (valuesHidden ? VALUE_MASK : BRL.format(v));
/** Sem mascara: so para respostas que o usuario pediu explicitamente (chat) e exportacoes. */
export const fmtRaw = (v: number) => BRL.format(v);
export const pct = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + '%';

export const MESES = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
export const MESES_LONGOS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** "2026-10-15T20:42:00-03:00" -> "15 out. 2026, 20:42" (hora local da string, sem conversao de fuso). */
export const fmtDate = (iso: string) => {
  const [d = '', t = ''] = iso.split('T');
  const [y, m, dd] = d.split('-');
  return `${+dd!} ${MESES[+m! - 1]} ${y}, ${t.slice(0, 5)}`;
};
export const fmtDay = (iso: string) => {
  const [, m, dd] = iso.slice(0, 10).split('-');
  return `${+dd!} ${MESES[+m! - 1]}`;
};
export const fmtDayFull = (iso: string) => {
  const [y, m, dd] = iso.slice(0, 10).split('-');
  return `${+dd!} ${MESES[+m! - 1]} ${y}`;
};

export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5);

export const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(y, m - 1 + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

export const maskMoney = (raw: string) => {
  const d = String(raw).replace(/\D/g, '').slice(0, 11);
  return d ? { text: fmt(+d / 100), value: +d / 100 } : { text: '', value: 0 };
};

export const maskDoc = (raw: string) => {
  const d = String(raw).replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11)
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
};

export const maskPhone = (raw: string) => {
  const d = String(raw).replace(/\D/g, '').slice(0, 11);
  if (d.length < 3) return d;
  if (d.length < 8) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
};

export const initials = (name: string) =>
  (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
