import { describe, expect, it } from 'vitest';
import { fixedIconOf } from './fixedIcons';

describe('fixedIconOf', () => {
  it('icone pelo nome do gasto (doc. Melhorias, passo 7)', () => {
    expect(fixedIconOf('Aluguel', 'moradia')).toBe('house');
    expect(fixedIconOf('Internet Vivo Fibra', 'telefone')).toBe('wifi');
    expect(fixedIconOf('Conta de Energia', 'contas-casa')).toBe('zap');
    expect(fixedIconOf('Água', 'contas-casa')).toBe('droplet');
    expect(fixedIconOf('Streaming', 'assinaturas')).toBe('tv');
    expect(fixedIconOf('Academia Smart Fit', 'saude')).toBe('dumbbell');
    expect(fixedIconOf('Faculdade', 'educacao')).toBe('graduation-cap');
  });
  it('sem pista no nome: icone da categoria', () => {
    expect(fixedIconOf('Diversos', 'mercado')).toBe('shopping-cart');
    expect(fixedIconOf('Coisa', null)).toBeTruthy();
  });
});
