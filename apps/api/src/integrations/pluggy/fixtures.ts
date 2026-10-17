// Objetos Pluggy minimos para testes (formato do pluggy-sdk 0.92).
import type { PluggyAccount, PluggyBill, PluggyInvestment, PluggyItem, PluggyTransaction } from './gateway';

export const ITEM_ID = '7d9b8f6a-1c2e-4f3a-9b4d-5e6f7a8b9c0d';

export function fakeItem(over: Partial<PluggyItem> = {}): PluggyItem {
  return {
    id: ITEM_ID,
    connector: { id: 212, name: 'Nubank', imageUrl: 'https://cdn.pluggy.ai/nubank.svg', primaryColor: '820AD1' },
    status: 'UPDATED',
    statusDetail: null,
    error: null,
    executionStatus: 'SUCCESS',
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-16T12:00:00Z'),
    lastUpdatedAt: new Date('2026-10-16T12:00:00Z'),
    parameter: null,
    webhookUrl: null,
    clientUserId: null,
    userAction: null,
    consecutiveFailedLoginAttempts: 0,
    nextAutoSyncAt: null,
    consentExpiresAt: new Date('2027-10-01T00:00:00Z'),
    resourcesCollectedAt: null,
    hasResourcesPendingAuthorization: null,
    ...over,
  } as PluggyItem;
}

export function fakeAccount(over: Partial<PluggyAccount> = {}): PluggyAccount {
  return {
    id: 'acc-checking',
    itemId: ITEM_ID,
    type: 'BANK',
    subtype: 'CHECKING_ACCOUNT',
    number: '0001/1234567-8',
    balance: 8420.35,
    name: 'Conta Corrente',
    marketingName: null,
    owner: null,
    taxNumber: null,
    currencyCode: 'BRL',
    bankData: null,
    creditData: null,
    ...over,
  } as PluggyAccount;
}

export function fakeCard(over: Partial<PluggyAccount> = {}): PluggyAccount {
  return fakeAccount({
    id: 'acc-card',
    type: 'CREDIT',
    subtype: 'CREDIT_CARD',
    number: '4821',
    balance: 2340.1,
    name: 'Mastercard Black',
    marketingName: 'Nubank Ultravioleta',
    creditData: {
      level: 'BLACK', brand: 'MASTERCARD', balanceCloseDate: new Date('2026-10-18T00:00:00Z'), balanceDueDate: new Date('2026-10-25T00:00:00Z'),
      availableCreditLimit: 12659.9, balanceForeignCurrency: null, minimumPayment: null, creditLimit: 15000, isLimitFlexible: false,
      status: 'ACTIVE', holderType: 'MAIN',
    },
    ...over,
  });
}

export function fakeTx(over: Partial<PluggyTransaction> = {}): PluggyTransaction {
  return {
    id: 'tx-1',
    accountId: 'acc-checking',
    date: new Date('2026-10-15T23:42:00Z'),
    description: 'MERCADO CENTRAL 0123',
    descriptionRaw: null,
    type: 'DEBIT',
    amount: -187.34,
    amountInAccountCurrency: null,
    balance: 0,
    currencyCode: 'BRL',
    category: 'Groceries',
    status: 'POSTED',
    creditCardMetadata: null,
    categoryId: '01010000',
    operationType: null,
    operationTypeAdditionalInfo: null,
    providerId: null,
    createdAt: new Date('2026-10-15T23:50:00Z'),
    updatedAt: new Date('2026-10-15T23:50:00Z'),
    ...over,
  } as PluggyTransaction;
}

export function fakeInvestment(over: Partial<PluggyInvestment> = {}): PluggyInvestment {
  return {
    id: 'inv-1', code: null, issuerCNPJ: null, number: null, isin: null, itemId: ITEM_ID, type: 'FIXED_INCOME', subtype: 'CDB',
    name: 'CDB Banco X', currencyCode: 'BRL', date: null, value: null, quantity: 1, taxes: null, taxes2: null, balance: 10500.55,
    amount: null, amountWithdrawal: null, amountProfit: null, amountOriginal: 10000, dueDate: new Date('2028-01-15T00:00:00Z'),
    issuer: null, issueDate: null, purchaseDate: null, rate: 110, rateType: 'CDI', fixedAnnualRate: null, lastMonthRate: null,
    annualRate: null, lastTwelveMonthsRate: null, status: 'ACTIVE', transactions: null, metadata: null, owner: null, institution: null,
    ...over,
  } as PluggyInvestment;
}

export function fakeBill(over: Partial<PluggyBill> = {}): PluggyBill {
  return {
    id: 'bill-1', dueDate: new Date('2026-10-25T00:00:00Z'), billClosingDate: new Date('2026-10-18T00:00:00Z'), totalAmount: 2340.1,
    totalAmountCurrencyCode: 'BRL', minimumPaymentAmount: null, allowsInstallments: null, financeCharges: [], payments: [],
    createdAt: new Date('2026-10-18T00:00:00Z'), updatedAt: new Date('2026-10-18T00:00:00Z'),
    ...over,
  } as PluggyBill;
}
