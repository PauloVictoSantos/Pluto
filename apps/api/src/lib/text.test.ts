import { describe, expect, it } from 'vitest';
import { matchKeyOf } from './text';

describe('matchKeyOf', () => {
  it('remove o envelope do Pix e mantem o destinatario', () => {
    expect(matchKeyOf('PIX ENVIADO AMANDA SOUSA BEZERRA COM SALDO')).toBe('amanda sousa bezerra');
    expect(matchKeyOf('PIX ENVIADO AMANDA SOUSA BEZERRA')).toBe('amanda sousa bezerra');
    expect(matchKeyOf('PIX ENVIADO - DES  Amanda Sousa Bezerra  01/08 - DOCTO: 2304262')).toBe('amanda sousa bezerra');
  });

  it('mantem descricoes sem envelope', () => {
    expect(matchKeyOf('Pagamento de boleto')).toBe('pagamento de boleto');
    expect(matchKeyOf('PIX')).toBe('pix');
  });
});
