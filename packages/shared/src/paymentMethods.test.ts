import { describe, expect, it } from 'vitest';
import { paymentMethodOf } from './paymentMethods';
import { categoryFromText } from './textCategory';

describe('forma de pagamento e categoria pelo texto (doc. Melhorias, passo 8)', () => {
  it('forma de pagamento', () => {
    expect(paymentMethodOf({ description: 'PIX ENVIADO ESCOLA', accountType: 'CHECKING' })).toBe('pix');
    expect(paymentMethodOf({ description: 'QUALQUER', accountType: 'CREDIT_CARD' })).toBe('credito');
    expect(paymentMethodOf({ description: 'PAGTO BOLETO LUZ', accountType: 'CHECKING' })).toBe('boleto');
    expect(paymentMethodOf({ description: 'SAQUE 24H', accountType: 'CHECKING' })).toBe('dinheiro');
    expect(paymentMethodOf({ description: 'X', accountType: 'CHECKING', providerMethod: 'TED' })).toBe('transferencia');
    expect(paymentMethodOf({ description: 'COMPRA PADARIA', accountType: 'CHECKING' })).toBe('debito');
  });

  it('categoria pelo texto', () => {
    expect(categoryFromText('PIX ENVIADO COLÉGIO ALFA')).toEqual({ key: 'educacao', confidence: 0.85 });
    expect(categoryFromText('PIX DROGARIA SAO PAULO')?.key).toBe('saude');
    expect(categoryFromText('PIX MARIA DA SILVA')).toBeNull();
  });
});
