import { describe, expect, it } from 'vitest';
import { normalizeDescription } from '../../lib/text';
import { fakeAccount, fakeBill, fakeCard, fakeInvestment, fakeItem, fakeTx } from './fixtures';
import { deriveType, mapAccount, mapBill, mapInvestment, mapItem, mapTransaction, maskNumber } from './mappers';

describe('mapItem', () => {
  it('normaliza cor e marca acao necessaria (RN-03)', () => {
    expect(mapItem(fakeItem())).toMatchObject({ institutionName: 'Nubank', primaryColor: '#820AD1', needsAction: false });
    expect(mapItem(fakeItem({ status: 'LOGIN_ERROR' })).needsAction).toBe(true);
    expect(mapItem(fakeItem({ status: 'WAITING_USER_ACTION' })).needsAction).toBe(true);
    expect(mapItem(fakeItem({ status: 'OUTDATED' })).needsAction).toBe(false);
  });

  it('nao copia a mensagem do provedor para lastError', () => {
    const m = mapItem(fakeItem({ error: { code: 'INVALID_CREDENTIALS', message: 'Senha do CPF 123 invalida' } } as never));
    expect(m.lastError).toBe('Erro do provedor (INVALID_CREDENTIALS)');
  });
});

describe('mapAccount', () => {
  it('conta corrente em centavos com numero mascarado', () => {
    expect(mapAccount(fakeAccount())).toMatchObject({ type: 'CHECKING', balanceMinor: 842035, numberMasked: '5678', creditLimitMinor: null });
  });

  it('cartao com limites e dias de fechamento/vencimento', () => {
    expect(mapAccount(fakeCard())).toMatchObject({
      type: 'CREDIT_CARD', name: 'Nubank Ultravioleta', balanceMinor: 234010, creditLimitMinor: 1500000,
      availableCreditMinor: 1265990, closingDay: 18, dueDay: 25, numberMasked: '4821',
    });
  });

  it('maskNumber', () => {
    expect(maskNumber('0001/1234567-8')).toBe('5678');
    expect(maskNumber(null)).toBeNull();
  });
});

describe('mapTransaction', () => {
  it('sinal vem do tipo, nao do amount (despesa negativa)', () => {
    expect(mapTransaction(fakeTx({ amount: 187.34, type: 'DEBIT' }), 'CREDIT_CARD').amountMinor).toBe(-18734);
    expect(mapTransaction(fakeTx({ amount: -350, type: 'CREDIT' }), 'CHECKING').amountMinor).toBe(35000);
  });

  it('normaliza descricao e define tipo', () => {
    const t = mapTransaction(fakeTx(), 'CHECKING');
    expect(t).toMatchObject({ descriptionNorm: 'mercado central', type: 'EXPENSE', status: 'POSTED', installment: null });
  });

  it('parcelas do mesmo cartao compartilham groupId (RN-15)', () => {
    const meta = (n: number) => ({ installmentNumber: n, totalInstallments: 10, totalAmount: 1200, purchaseDate: new Date('2026-08-01'), billId: 'bill-1' });
    const a = mapTransaction(fakeTx({ id: 'a', accountId: 'acc-card', description: 'LOJA X PARC 01/10', creditCardMetadata: meta(1) }), 'CREDIT_CARD');
    const b = mapTransaction(fakeTx({ id: 'b', accountId: 'acc-card', description: 'LOJA X PARC 02/10', creditCardMetadata: meta(2) }), 'CREDIT_CARD');
    expect(a.installment).toMatchObject({ n: 1, total: 10 });
    expect(a.installment!.groupId).toBe(b.installment!.groupId);
    expect(a.pluggyBillId).toBe('bill-1');
  });
});

describe('deriveType', () => {
  const t = (description: string, type: 'DEBIT' | 'CREDIT', category: string | null = null) => ({ description, type, category });
  it('pagamento de fatura na conta corrente nao e despesa (RN-14)', () => {
    expect(deriveType(t('PAGTO FATURA CARTAO', 'DEBIT'), 'CHECKING')).toBe('CARD_PAYMENT');
    expect(deriveType(t('Pagamento recebido', 'CREDIT'), 'CREDIT_CARD')).toBe('CARD_PAYMENT');
    expect(deriveType(t('Qualquer', 'DEBIT', 'Credit card payment'), 'CHECKING')).toBe('CARD_PAYMENT');
  });
  it('transferencia para mesma titularidade (RN-13)', () => {
    expect(deriveType(t('PIX ENVIADO', 'DEBIT', 'Same person transfer'), 'CHECKING')).toBe('TRANSFER');
  });
  it('padrao por direcao', () => {
    expect(deriveType(t('SALARIO', 'CREDIT'), 'CHECKING')).toBe('INCOME');
    expect(deriveType(t('Estorno compra', 'CREDIT'), 'CREDIT_CARD')).toBe('INCOME');
  });
});

describe('mapInvestment / mapBill', () => {
  it('investimento com aplicado, atual e indexador', () => {
    expect(mapInvestment(fakeInvestment())).toMatchObject({ type: 'FIXED_INCOME', appliedMinor: 1000000, currentValueMinor: 1050055, rateInfo: '110% CDI' });
    expect(mapInvestment(fakeInvestment({ type: 'EQUITY', subtype: 'REAL_ESTATE_FUND' })).type).toBe('FUND');
  });

  it('status da fatura', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    expect(mapBill(fakeBill(), now).status).toBe('CLOSED');
    expect(mapBill(fakeBill(), new Date('2026-10-10')).status).toBe('OPEN');
    expect(mapBill(fakeBill(), new Date('2026-10-30')).status).toBe('OVERDUE');
    const paid = fakeBill({ payments: [{ id: 'p', valueType: 'FULL_PAYMENT', paymentDate: now, paymentMode: 'PIX', amount: 2340.1, currencyCode: 'BRL' }] });
    expect(mapBill(paid, new Date('2026-10-30'))).toMatchObject({ status: 'PAID', paidMinor: 234010 });
  });
});

describe('normalizeDescription', () => {
  it('remove acentos, numeros e simbolos', () => {
    expect(normalizeDescription('PÃO DE AÇÚCAR *123 15/10')).toBe('pao de acucar');
  });
});
