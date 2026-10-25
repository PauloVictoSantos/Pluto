import type { SyncResult } from '@pluto/shared';
import type { AnyBulkWriteOperation, ObjectId } from 'mongodb';
import type { AccountDoc, Collections, ConnectionDoc, TransactionDoc } from '../../db/collections';
import type { Llm } from '../../integrations/llm/gemini';
import type { FieldCrypto } from '../../lib/crypto';
import type { PluggyGateway } from '../../integrations/pluggy/gateway';
import { USER_SOURCES, applyUserRules } from '../categories/rules';
import { counterpartyKindOf, counterpartyRef, institutionFromAccounts, mapAccount, mapBill, mapInvestment, mapItem, mapTransaction } from '../../integrations/pluggy/mappers';
import { autoCategorize } from '../analytics/categorizer';
import { groupMerchants } from '../merchants/service';
import { classifyUncertain } from '../categories/classify';
import { dedupPending, refreshRecurrences } from '../analytics/service';

export interface SyncDeps {
  col: Collections;
  pluggy: PluggyGateway;
  crypto: FieldCrypto;
  /** Gemini para agrupar estabelecimentos (opcional: sem ele, so similaridade local). */
  llm?: Llm | null;
  now?: () => Date;
  log?: { warn: (obj: object, msg: string) => void };
}

const LOCK_MS = 10 * 60_000;
/** Reimporta uma janela para pegar transacoes pendentes que foram liquidadas (RN-02). */
const OVERLAP_DAYS = 30;
const DAY = 86_400_000;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const month = (d: Date) => d.toISOString().slice(0, 7);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * Sincroniza uma conexao com o Pluggy. Idempotente: pode rodar quantas vezes for preciso.
 * - RN-01: upsert por (connectionId, pluggyTransactionId)
 * - RN-02: PENDING vira POSTED; valor e data finais prevalecem
 * - RN-03: item que exige acao do usuario nao e importado
 * - RN-04: consentimento vencido desativa a conexao e mantem o historico
 * - RN-05: falha em uma conta nao aborta as demais
 */
export async function syncConnection(deps: SyncDeps, connectionId: ObjectId, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const { col, pluggy, crypto } = deps;
  const now = deps.now?.() ?? new Date();
  const result: SyncResult = { status: 'SYNCED', accounts: 0, transactions: 0, investments: 0, errors: [] };

  // Trava: so uma sincronizacao por conexao por vez (job + botao "sincronizar").
  const conn = await col.connections.findOneAndUpdate(
    { _id: connectionId, removedAt: null, $or: [{ syncingUntil: null }, { syncingUntil: { $lt: now } }] },
    { $set: { syncingUntil: new Date(now.getTime() + LOCK_MS) } },
    { returnDocument: 'after' },
  );
  if (!conn) return { ...result, status: 'SKIPPED' };

  const finish = async (patch: Partial<ConnectionDoc>, r: SyncResult) => {
    await col.connections.updateOne({ _id: connectionId }, { $set: { ...patch, syncingUntil: null, updatedAt: new Date() } });
    return r;
  };

  const itemId = crypto.decrypt(conn.pluggyItemIdEnc);
  let item;
  try {
    // Itens do Meu Pluggy sao atualizados por la; aqui so lemos o estado atual.
    item = opts.force && conn.source !== 'MEU_PLUGGY' ? await pluggy.updateItem(itemId) : await pluggy.fetchItem(itemId);
  } catch (e) {
    deps.log?.warn({ connectionId: String(connectionId), err: errMsg(e) }, 'falha ao consultar item no Pluggy');
    return finish({ lastError: 'Falha ao consultar o Pluggy' }, { ...result, status: 'FAILED', errors: ['item'] });
  }

  const mapped = mapItem(item);
  // No Meu Pluggy o nome do conector e generico; o nome do banco e definido pelas contas, abaixo.
  const { institutionName: connectorName, ...rest } = mapped;
  const base: Partial<ConnectionDoc> & typeof rest = conn.source === 'MEU_PLUGGY' ? rest : mapped;

  if (base.consentExpiresAt && base.consentExpiresAt < now) {
    // TODO(notifications): RN-43 alerta de consentimento vencido.
    return finish({ ...base, active: false }, { ...result, status: 'INACTIVE' });
  }
  if (base.needsAction) {
    // TODO(notifications): RN-43 alerta de conexao que precisa de acao.
    return finish(base, { ...result, status: 'NEEDS_ACTION' });
  }

  // Contas
  let accounts: Awaited<ReturnType<PluggyGateway['fetchAccounts']>>;
  try {
    accounts = await pluggy.fetchAccounts(itemId);
  } catch (e) {
    deps.log?.warn({ connectionId: String(connectionId), err: errMsg(e) }, 'falha ao buscar contas');
    return finish({ ...base, lastError: 'Falha ao buscar contas' }, { ...result, status: 'FAILED', errors: ['accounts'] });
  }
  if (conn.source === 'MEU_PLUGGY') base.institutionName = institutionFromAccounts(accounts) ?? connectorName;

  const dateFrom = conn.lastTransactionsSyncAt ? new Date(conn.lastTransactionsSyncAt.getTime() - OVERLAP_DAYS * DAY) : null;

  for (const pa of accounts) {
    const a = mapAccount(pa);
    const acc = await col.accounts.findOneAndUpdate(
      { connectionId, pluggyAccountId: a.pluggyAccountId },
      {
        $set: { ...a, userId: conn.userId, syncError: null, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
    result.accounts++;
    try {
      result.transactions += await syncTransactions(deps, conn, acc!, pa.id, dateFrom, now);
      if (acc!.type === 'CREDIT_CARD') await syncInvoices(deps, conn, acc!, pa.id, now);
    } catch (e) {
      deps.log?.warn({ accountId: String(acc!._id), err: errMsg(e) }, 'falha ao sincronizar conta');
      await col.accounts.updateOne({ _id: acc!._id }, { $set: { syncError: 'Falha ao sincronizar esta conta' } });
      result.errors.push(`account:${String(acc!._id)}`);
    }
  }

  try {
    result.investments = await syncInvestments(deps, conn, itemId, now);
  } catch (e) {
    deps.log?.warn({ connectionId: String(connectionId), err: errMsg(e) }, 'falha ao sincronizar investimentos');
    result.errors.push('investments');
  }

  // Categorizacao aprendida nas transacoes novas: falha aqui nao invalida a sincronizacao.
  await autoCategorize(col, conn.userId, now).catch((e) =>
    deps.log?.warn({ connectionId: String(connectionId), err: errMsg(e) }, 'falha na categorização aprendida'),
  );

  // Estabelecimentos agrupados (similaridade + IA): a categoria do grupo vale sobre a do modelo.
  await groupMerchants({ col, llm: deps.llm ?? null }, conn.userId, now).catch((e) =>
    deps.log?.warn({ connectionId: String(connectionId), err: errMsg(e) }, 'falha no agrupamento de estabelecimentos'),
  );

  // O que o Pix pagou (doc. Melhorias, passo 8): palavras do texto, IA so para empresa e com consentimento.
  await classifyUncertain({ col, llm: deps.llm ?? null }, conn.userId, now).catch((e) =>
    deps.log?.warn({ connectionId: String(connectionId), err: errMsg(e) }, 'falha na classificação em camadas'),
  );

  // Series recorrentes do usuario: falha aqui nao invalida a sincronizacao.
  await refreshRecurrences(col, conn.userId, now).catch((e) =>
    deps.log?.warn({ connectionId: String(connectionId), err: errMsg(e) }, 'falha ao detectar recorrências'),
  );

  const failedAccounts = result.errors.some((e) => e.startsWith('account:'));
  return finish(
    {
      ...base,
      active: true,
      lastSyncAt: now,
      // Se alguma conta falhou, mantem a janela antiga para nao perder transacoes na proxima.
      ...(failedAccounts ? {} : { lastTransactionsSyncAt: now }),
      lastError: result.errors.length ? 'Sincronização parcial' : base.lastError,
    },
    result,
  );
}

async function syncTransactions(deps: SyncDeps, conn: ConnectionDoc, acc: AccountDoc, pluggyAccountId: string, dateFrom: Date | null, now: Date) {
  const { col, pluggy, crypto } = deps;
  const txs = await pluggy.fetchTransactions(pluggyAccountId, dateFrom ? ymd(dateFrom) : undefined);
  if (txs.length) {
    const ops: AnyBulkWriteOperation<TransactionDoc>[] = txs.flatMap((t) => {
      const { type, categoryKey, ...owned } = mapTransaction(t, acc.type);
      const filter = { connectionId: conn._id, pluggyTransactionId: t.id };
      // RN-D02: so o hash do destinatario e guardado; o CPF/CNPJ e a conta nunca.
      const ref = counterpartyRef(t);
      const counterpartyKey = ref ? `cp:${crypto.hash(ref)}` : null;
      const counterpartyKind = counterpartyKindOf(ref);
      return [
        {
          updateOne: {
            filter,
            update: {
              // Campos do Pluggy: sempre atualizados (RN-02).
              $set: { ...owned, counterpartyKey, counterpartyKind, userId: conn.userId, accountId: acc._id, deletedAt: null, updatedAt: now },
              // Campos derivados ou editaveis pelo usuario: so na criacao.
              $setOnInsert: {
                type, categoryKey, categoryId: null, categorySource: null, categoryConfidence: null, invoiceId: null,
                tags: [], notes: null, hidden: false, createdAt: now,
              },
            },
            upsert: true,
          },
        },
        // Categoria derivada do Pluggy acompanha mudancas do provedor; a escolhida pelo usuario nunca (RN-12).
        // Classificacao em camadas (palavras/IA) tambem fica: so o que veio do Pluggy acompanha o provedor.
        { updateOne: { filter: { ...filter, categorySource: { $nin: [...USER_SOURCES, 'KEYWORD', 'LLM'] } }, update: { $set: { categoryKey } } } },
      ];
    });
    // Sem ordem: se a 2a operacao rodar antes do insert, o $setOnInsert ja grava a categoria.
    await col.transactions.bulkWrite(ops, { ordered: false });
    await applyUserRules(col, conn.userId, { accountId: acc._id });
  }

  // Pendentes que sumiram da janela foram substituidas pela versao liquidada com outro id.
  const seen = txs.map((t) => t.id);
  await col.transactions.updateMany(
    {
      accountId: acc._id,
      status: 'PENDING',
      deletedAt: null,
      pluggyTransactionId: { $nin: seen },
      ...(dateFrom ? { date: { $gte: dateFrom } } : {}),
    },
    { $set: { deletedAt: now, updatedAt: now } },
  );
  // Pendente que ainda aparece, mas ja voltou liquidada com outro id.
  await dedupPending(col, acc._id, now);
  return txs.length;
}

async function syncInvoices(deps: SyncDeps, conn: ConnectionDoc, acc: AccountDoc, pluggyAccountId: string, now: Date) {
  const { col, pluggy } = deps;
  const bills = await pluggy.fetchCreditCardBills(pluggyAccountId);
  for (const b of bills) {
    const inv = mapBill(b, now);
    const doc = await col.invoices.findOneAndUpdate(
      { accountId: acc._id, pluggyBillId: inv.pluggyBillId },
      { $set: { ...inv, userId: conn.userId, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    await col.transactions.updateMany({ accountId: acc._id, pluggyBillId: inv.pluggyBillId, invoiceId: null }, { $set: { invoiceId: doc!._id } });
  }
}

async function syncInvestments(deps: SyncDeps, conn: ConnectionDoc, itemId: string, now: Date) {
  const { col, pluggy } = deps;
  const list = await pluggy.fetchInvestments(itemId);
  for (const pi of list) {
    const i = mapInvestment(pi);
    const doc = await col.investments.findOneAndUpdate(
      { connectionId: conn._id, pluggyInvestmentId: i.pluggyInvestmentId },
      { $set: { ...i, userId: conn.userId, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    // Historico do patrimonio: um registro por mes, sempre com o valor mais recente.
    await col.investmentSnapshots.updateOne(
      { investmentId: doc!._id, month: month(now) },
      { $set: { userId: conn.userId, valueMinor: i.currentValueMinor, updatedAt: now } },
      { upsert: true },
    );
  }
  return list.length;
}

