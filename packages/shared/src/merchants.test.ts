import { describe, expect, it } from 'vitest';
import { brandKeysFor, brandOf } from './merchants';

describe('nomes faceis das descricoes', () => {
  it('casos reais do extrato', () => {
    expect(brandOf('MP *GUICHEWEB')?.name).toBe('Ingresso');
    expect(brandOf('SHOPEE *SHPSTEPARC07/09')?.name).toBe('Shopee');
    expect(brandOf('MP *ALIANCASMANAUS')?.name).toBe('Alianças Manaus');
    expect(brandOf('UBER *TRIP HELP.UBER.COM')?.name).toBe('Uber');
    expect(brandOf('UBER EATS')?.name).toBe('Uber Eats');
    expect(brandOf('AMZN Mktp BR')?.name).toBe('Amazon');
    expect(brandOf('Pagamento efetuado')?.categoryKey).toBe('fatura');
    expect(brandOf('IOF COMPRA INTERNACIONAL')?.categoryKey).toBe('taxas');
    expect(brandOf('CHURRASCARIA GAUCHA')?.name).toBe('Restaurante');
  });

  it('nao confunde palavra curta dentro de outra', () => {
    expect(brandOf('BIOFARMA LTDA')).toBeNull();
    expect(brandOf('POSTO UBERLANDIA')).toBeNull();
    expect(brandOf('PADARIA PAO QUENTE')).toBeNull();
  });

  it('busca pelo nome facil acha a descricao original', () => {
    expect(brandKeysFor('ingresso')).toContain('guicheweb');
    expect(brandKeysFor('x')).toEqual([]);
  });
});
