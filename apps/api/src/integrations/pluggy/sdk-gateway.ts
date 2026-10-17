import { PluggyClient, type PageResponse } from 'pluggy-sdk';
import type { PluggyGateway } from './gateway';

const PAGE_SIZE = 500; // maximo suportado pelo Pluggy

async function allPages<T>(fetchPage: (page: number) => Promise<PageResponse<T>>): Promise<T[]> {
  const first = await fetchPage(1);
  const out = [...first.results];
  for (let page = 2; page <= first.totalPages; page++) out.push(...(await fetchPage(page)).results);
  return out;
}

/**
 * Implementacao com o SDK oficial. clientId/clientSecret ficam so no servidor;
 * o SDK obtem e renova a apiKey de curta duracao internamente (secao 6.5).
 */
export function createPluggyGateway(opts: { clientId: string; clientSecret: string }): PluggyGateway {
  const client = new PluggyClient({ clientId: opts.clientId, clientSecret: opts.clientSecret });

  return {
    async createConnectToken({ clientUserId, itemId }) {
      const { accessToken } = await client.createConnectToken(itemId, { clientUserId, avoidDuplicates: true });
      return accessToken;
    },
    fetchItem: (itemId) => client.fetchItem(itemId),
    updateItem: (itemId) => client.updateItem(itemId),
    deleteItem: (itemId) => client.deleteItem(itemId),
    async fetchAccounts(itemId) {
      return (await client.fetchAccounts(itemId)).results;
    },
    fetchTransactions: (accountId, dateFrom) => client.fetchAllTransactions(accountId, dateFrom ? { dateFrom } : {}),
    fetchInvestments: (itemId) => allPages((page) => client.fetchInvestments(itemId, undefined, { page, pageSize: PAGE_SIZE })),
    fetchCreditCardBills: (accountId) => allPages((page) => client.fetchCreditCardBills(accountId, { page, pageSize: PAGE_SIZE })),
  };
}
