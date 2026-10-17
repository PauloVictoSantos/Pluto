// Confere credenciais do Pluggy e um Item ID do Meu Pluggy, sem gravar nada no banco.
// Uso: pnpm --filter @pluto/api pluggy:check <itemId>
// Mostra so dados nao sensiveis: instituicao, status e contagens (nada de numeros de conta ou valores).
import { createPluggyGateway } from '../src/integrations/pluggy/sdk-gateway';
import { mapAccountType, mapItem } from '../src/integrations/pluggy/mappers';

const itemId = process.argv[2]?.trim();
const { PLUGGY_CLIENT_ID: clientId, PLUGGY_CLIENT_SECRET: clientSecret } = process.env;

if (!clientId || !clientSecret) {
  console.error('Preencha PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no apps/api/.env');
  process.exit(1);
}
const pluggy = createPluggyGateway({ clientId, clientSecret });

try {
  await pluggy.createConnectToken({ clientUserId: 'pluggy-check' });
  console.log('✓ Credenciais válidas');
} catch (e) {
  console.error('✗ Credenciais recusadas pelo Pluggy:', (e as Error).message);
  process.exit(1);
}

if (!itemId) {
  console.log('Informe um Item ID para testar a conexão: pnpm --filter @pluto/api pluggy:check <itemId>');
  process.exit(0);
}

try {
  const item = mapItem(await pluggy.fetchItem(itemId));
  console.log(`✓ Item encontrado: ${item.institutionName} · status ${item.status}${item.needsAction ? ' (precisa de ação no Meu Pluggy)' : ''}`);
  if (item.consentExpiresAt) console.log(`  Consentimento até ${item.consentExpiresAt.toISOString().slice(0, 10)}`);
  const accounts = await pluggy.fetchAccounts(itemId);
  const byType = accounts.reduce<Record<string, number>>((acc, a) => ((acc[mapAccountType(a)] = (acc[mapAccountType(a)] ?? 0) + 1), acc), {});
  console.log(`✓ ${accounts.length} conta(s):`, byType);
  let txs = 0;
  for (const a of accounts) txs += (await pluggy.fetchTransactions(a.id)).length;
  console.log(`✓ ${txs} transação(ões) disponíveis`);
  console.log(`✓ ${(await pluggy.fetchInvestments(itemId)).length} investimento(s)`);
} catch (e) {
  console.error('✗ Não foi possível ler o item:', (e as Error).message);
  process.exit(1);
}
