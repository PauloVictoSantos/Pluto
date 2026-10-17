// Logos dos bancos (public/banks, copiados dos icones de conectores do Pluggy). Ficam no proprio
// app: no Meu Pluggy o conector e sempre "MeuPluggy" e a imagem dele nao identifica o banco.

const BANKS: [RegExp, string, string][] = [
  [/\bitau\b|itau unibanco/, 'itau', '#EC7000'],
  [/bradesco/, 'bradesco', '#CC092F'],
  [/santander/, 'santander', '#EC0000'],
  [/banco do brasil|^bb\b/, 'bb', '#FCFC30'],
  [/nubank|\bnu pagamentos\b|^nu\b/, 'nubank', '#820AD1'],
  [/\bbtg\b/, 'btg', '#001E61'],
  [/\binter\b/, 'inter', '#FF7A00'],
  [/caixa/, 'caixa', '#005CA9'],
  [/mercado ?pago/, 'mercadopago', '#00B1EA'],
  [/\bxp\b/, 'xp', '#000000'],
  [/\bc6\b/, 'c6', '#242424'],
  [/sicredi/, 'sicredi', '#64C832'],
  [/picpay/, 'picpay', '#11C76F'],
  [/\bpan\b/, 'pan', '#FF5200'],
  [/digio/, 'digio', '#202E55'],
  [/\biti\b/, 'iti', '#FF5A70'],
  [/agibank|\bagi\b/, 'agibank', '#3B74E8'],
  [/original/, 'original', '#209425'],
  [/stone/, 'stone', '#00A868'],
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface BankBrand {
  logo: string | null;
  color: string;
  /** Nome curto para exibir ("BANCO INTER" -> "Banco Inter"). */
  label: string;
}

const tidy = (name: string) => {
  const s = name.replace(/\s+(INSTITUI[ÇC][ÃA]O|S\.?A\.?|LTDA).*$/i, '').trim();
  // Nomes todo em maiusculas viram "Titulo" para combinar com o resto da interface.
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : s;
};

export function bankBrand(name: string, fallbackColor?: string | null): BankBrand {
  const n = norm(name);
  const hit = BANKS.find(([re]) => re.test(n));
  return { logo: hit ? `/banks/${hit[1]}.svg` : null, color: hit?.[2] ?? fallbackColor ?? '#7D39EB', label: tidy(name) };
}
