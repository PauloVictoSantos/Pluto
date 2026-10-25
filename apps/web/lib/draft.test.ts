import { describe, expect, it } from 'vitest';
import { clearDrafts } from './draft';
import { PCT_MASK, VALUE_MASK, fmt, hidePct, setValuesHidden } from './format';

// Ocultar valores (doc. Melhorias, passo 6): reais e porcentagens somem juntos.
describe('ocultar valores', () => {
  it('esconde reais e porcentagens; mostrar volta ao normal', () => {
    setValuesHidden(true);
    expect(fmt(1234.5)).toBe(VALUE_MASK);
    expect(hidePct('+12,5%')).toBe(PCT_MASK);
    setValuesHidden(false);
    expect(fmt(1234.5)).toBe('R$ 1.234,50');
    expect(hidePct('+12,5%')).toBe('+12,5%');
  });

  it('rascunhos podem ser limpos na troca de sessao', () => {
    expect(() => clearDrafts()).not.toThrow();
  });
});
