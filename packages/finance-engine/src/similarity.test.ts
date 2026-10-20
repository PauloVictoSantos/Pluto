import { describe, expect, it } from 'vitest';
import { bestGroup, brandKey, trigramSimilarity } from './similarity';

describe('similaridade de estabelecimentos', () => {
  it('tira o ruido da descricao do cartao', () => {
    expect(brandKey('uber uber trip help uber com')).toBe('uber');
    expect(brandKey('uber trip sp')).toBe('uber');
    expect(brandKey('ifood ifood com')).toBe('ifood');
  });

  it('casa variacoes do mesmo estabelecimento e separa os diferentes', () => {
    expect(trigramSimilarity(brandKey('uber trip sp'), brandKey('uber uber trip help uber com'))).toBe(1);
    expect(trigramSimilarity('mercado livre', 'mercadolivre')).toBeGreaterThan(0.5);
    expect(trigramSimilarity('uber', 'netflix')).toBeLessThan(0.1);
    const groups = [
      { id: 'uber', keys: ['uber trip sp'] },
      { id: 'ifood', keys: ['ifood restaurante'] },
    ];
    expect(bestGroup('uber uber trip help uber com', groups)).toEqual({ id: 'uber', score: 1 });
    expect(bestGroup('99 pop', groups)).toBeNull();
  });
});
