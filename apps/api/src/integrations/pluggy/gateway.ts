import type { Account, CreditCardBills, Investment, Item, Transaction } from 'pluggy-sdk';

/**
 * Fronteira com o Pluggy (secao 9.4: camada isolada para troca futura).
 * O resto da API depende so desta interface; os testes usam uma implementacao falsa.
 */
export interface PluggyGateway {
  /** Token de curta duracao para o widget Pluggy Connect (secao 6.5). */
  createConnectToken(opts: { clientUserId: string; itemId?: string }): Promise<string>;
  fetchItem(itemId: string): Promise<Item>;
  /** Pede ao Pluggy para atualizar o item (POST /connections/:id/sync). */
  updateItem(itemId: string): Promise<Item>;
  deleteItem(itemId: string): Promise<void>;
  fetchAccounts(itemId: string): Promise<Account[]>;
  /** Todas as transacoes da conta, opcionalmente a partir de uma data (YYYY-MM-DD). */
  fetchTransactions(accountId: string, dateFrom?: string): Promise<Transaction[]>;
  fetchInvestments(itemId: string): Promise<Investment[]>;
  fetchCreditCardBills(accountId: string): Promise<CreditCardBills[]>;
}

export type { Account as PluggyAccount, CreditCardBills as PluggyBill, Investment as PluggyInvestment, Item as PluggyItem, Transaction as PluggyTransaction };
