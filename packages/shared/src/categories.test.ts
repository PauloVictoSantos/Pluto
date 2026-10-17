import { describe, expect, it } from 'vitest';
import { categoryKeyFor } from './categories';

// Categorias reais vistas no Pluggy (Meu Pluggy: Bradesco, Inter, PicPay).
describe('categoryKeyFor', () => {
  it.each([
    ['Taxi and ride-hailing', -1, 'transporte'],
    ['Tax on financial operations', -1, 'taxas'],
    ['Late payment and overdraft costs', -1, 'taxas'],
    ['Interests charged', -1, 'taxas'],
    ['Bank fees', -1, 'taxas'],
    ['Credit card fees', -1, 'taxas'],
    ['Groceries', -1, 'mercado'],
    ['Eating out', -1, 'restaurantes'],
    ['Food and drinks', -1, 'restaurantes'],
    ['Food delivery', -1, 'delivery'],
    ['Shopping', -1, 'compras'],
    ['Online shopping', -1, 'compras'],
    ['Clothing', -1, 'compras'],
    ['Tickets', -1, 'lazer'],
    ['Cinema, theater and concerts', -1, 'lazer'],
    ['University', -1, 'educacao'],
    ['Bookstore', -1, 'educacao'],
    ['Digital services', -1, 'assinaturas'],
    ['Mobile', -1, 'telefone'],
    ['Telecommunications', -1, 'telefone'],
    ['Automotive', -1, 'transporte'],
    ['Housing', -1, 'moradia'],
    ['Water', -1, 'contas-casa'],
    ['Pharmacy', -1, 'saude'],
    ['Transfer - PIX', -1, 'pix-enviado'],
    ['Transfer - PIX', 1, 'entradas'],
    ['Transfer - Bank Slip', -1, 'pix-enviado'],
    ['Salary', 1, 'salario'],
    ['Proceeds interests and dividends', 1, 'rendimentos'],
    ['Government aid', 1, 'entradas'],
    ['Credit card payment', -1, 'fatura'],
    ['Same person transfer', -1, 'entre-contas'],
    [null, -1, 'outros'],
    [null, 1, 'entradas'],
  ])('%s (%i) -> %s', (cat, sign, key) => {
    expect(categoryKeyFor(cat, sign)).toBe(key);
  });
});
