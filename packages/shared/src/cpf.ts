// CPF: identificador de login. Guardado so como hash (busca) e cifrado (exibicao mascarada).

/** So os digitos: "123.456.789-09" -> "12345678909". */
export const normalizeCpf = (s: string) => s.replace(/\D/g, '');

/** Valida os dois digitos verificadores; rejeita sequencias repetidas (111.111.111-11). */
export function isValidCpf(input: string): boolean {
  const cpf = normalizeCpf(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += +cpf[i]! * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === +cpf[9]! && digit(10) === +cpf[10]!;
}

/** "12345678909" -> "123.456.789-09" (aceita digitacao parcial, para mascara de campo). */
export function formatCpf(input: string): string {
  const d = normalizeCpf(input).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

/** Exibicao no app: "***.456.789-**". */
export const maskCpf = (input: string) => {
  const d = normalizeCpf(input);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '';
};
