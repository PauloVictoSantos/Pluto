// Dinheiro e sempre inteiro em centavos (minor units). Ver secao 3.9 e glossario.

export type Minor = number;

export function assertMinor(value: number): asserts value is Minor {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Valor monetario deve ser inteiro em centavos, recebido: ${value}`);
  }
}

/** Converte reais (ex.: 12.34) para centavos (1234), arredondando meio-para-cima. */
export function toMinor(reais: number): Minor {
  return Math.round(reais * 100);
}

/** Converte centavos para reais. Use apenas para exibicao. */
export function fromMinor(minor: Minor): number {
  return minor / 100;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(minor: Minor): string {
  return brl.format(fromMinor(minor));
}
