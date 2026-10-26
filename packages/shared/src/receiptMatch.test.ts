import { describe, expect, it } from 'vitest';
import { cleanItemName, matchesItem } from './receiptMatch';

describe('lista x cupom (doc. Melhorias, passo 10)', () => {
  it('nome da lista casa com a linha do cupom', () => {
    expect(matchesItem('Café', 'CAFE PILAO TRAD 500G')).toBe(true);
    expect(matchesItem('refri', 'REFRIG COCA COLA 2L')).toBe(true);
    expect(matchesItem('Refrigerante', 'REFRI GUARANA 2L')).toBe(true);
    expect(matchesItem('Leite integral', 'LEITE UHT INTEGRAL PIRACANJUBA 1L')).toBe(true);
    expect(matchesItem('Bananas', 'BANANA PRATA KG')).toBe(true);
    expect(matchesItem('Feijão', 'FEIJ CARIOCA CAMIL 1KG')).toBe(true);
  });
  it('nao casa item diferente', () => {
    expect(matchesItem('Café', 'CAFETEIRA ELETRICA')).toBe(false);
    expect(matchesItem('Leite condensado', 'LEITE UHT INTEGRAL 1L')).toBe(false);
    expect(matchesItem('Arroz', 'FEIJAO CARIOCA')).toBe(false);
  });
  it('nome limpo para o catalogo', () => {
    expect(cleanItemName('CAFE PILAO 500G')).toBe('Cafe pilao');
    expect(cleanItemName('LEITE UHT INTEGRAL 1L')).toBe('Leite uht');
  });
});
