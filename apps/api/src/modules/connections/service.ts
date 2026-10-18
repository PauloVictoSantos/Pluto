import type { Connection, ConnectionSource } from '@pluto/shared';
import { MongoServerError, ObjectId } from 'mongodb';
import { pluggyOf, type AppContext } from '../../context';
import type { ConnectionDoc } from '../../db/collections';
import { mapItem } from '../../integrations/pluggy/mappers';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';

export function toConnectionDTO(c: ConnectionDoc): Connection {
  return {
    id: c._id.toHexString(),
    source: c.source,
    institutionName: c.institutionName,
    connectorId: c.connectorId,
    imageUrl: c.imageUrl,
    primaryColor: c.primaryColor,
    status: c.status,
    needsAction: c.needsAction,
    active: c.active,
    consentExpiresAt: c.consentExpiresAt,
    lastSyncAt: c.lastSyncAt,
    lastError: c.lastError,
    createdAt: c.createdAt,
  };
}

export async function findOwnConnection(ctx: AppContext, userId: ObjectId, id: string): Promise<ConnectionDoc> {
  const c = await ctx.col.connections.findOne({ _id: new ObjectId(id), userId, removedAt: null });
  if (!c) throw notFound('Conexão');
  return c;
}

/**
 * Connect token para o widget (secao 3.7, passo 1). Com connectionId, abre o widget em modo
 * de reconexao/atualizacao daquele item (RN-03).
 */
export async function createConnectToken(ctx: AppContext, userId: ObjectId, connectionId?: string) {
  const pluggy = pluggyOf(ctx);
  let itemId: string | undefined;
  if (connectionId) {
    const conn = await findOwnConnection(ctx, userId, connectionId);
    if (conn.source === 'MEU_PLUGGY') throw reconnectInMeuPluggy();
    itemId = ctx.crypto.decrypt(conn.pluggyItemIdEnc);
  }
  return pluggy.createConnectToken({ clientUserId: userId.toHexString(), itemId });
}

const reconnectInMeuPluggy = () =>
  new AppError(400, 'MANAGED_BY_MEU_PLUGGY', 'Esta conexão é gerenciada no Meu Pluggy. Reconecte em meu.pluggy.ai.');

/**
 * Registra um item no Pluto, validando junto ao Pluggy antes de gravar (secao 3.7, passo 3).
 * - WIDGET: o item precisa ter sido criado com um connect token deste usuario.
 * - MEU_PLUGGY: o item foi criado em meu.pluggy.ai; basta estar visivel com as credenciais da API.
 * Em ambos, um item pertence a um unico usuario do Pluto.
 */
export async function registerConnection(
  ctx: AppContext,
  userId: ObjectId,
  rawItemId: string,
  ip: string | null,
  source: ConnectionSource = 'WIDGET',
) {
  const pluggy = pluggyOf(ctx);
  // Forma canonica antes de buscar, cifrar e gerar o hash: maiusculas nao criam outra chave.
  const itemId = rawItemId.trim().toLowerCase();
  let item;
  try {
    item = await pluggy.fetchItem(itemId);
  } catch {
    throw new AppError(400, 'INVALID_ITEM', 'Conexão não encontrada no Pluggy. Confira o Item ID.');
  }
  const forbidden = () => new AppError(403, 'FORBIDDEN_ITEM', 'Esta conexão não pertence a você');
  // WIDGET: o item tem de ter sido criado com o token deste usuario. MEU_PLUGGY: itens de la vem
  // sem clientUserId; se vier um, tem de ser o deste usuario (item criado pelo widget de outra conta).
  const owner = item.clientUserId ?? null, me = userId.toHexString();
  if (source === 'WIDGET' ? owner !== me : owner !== null && owner !== me) throw forbidden();
  const hash = ctx.crypto.hash(itemId);
  // Checagem com mensagem clara; a garantia de verdade e o indice unico global em pluggyItemIdHash.
  if (await ctx.col.connections.findOne({ pluggyItemIdHash: hash, userId: { $ne: userId } }, { projection: { _id: 1 } })) throw forbidden();

  const now = new Date();
  const meta = mapItem(item);
  const doc = await ctx.col.connections.findOneAndUpdate(
    { userId, pluggyItemIdHash: hash },
    {
      $set: { ...meta, active: true, removedAt: null, updatedAt: now },
      $setOnInsert: {
        userId,
        source,
        pluggyItemIdEnc: ctx.crypto.encrypt(itemId),
        pluggyItemIdHash: hash,
        lastSyncAt: null,
        lastTransactionsSyncAt: null,
        syncingUntil: null,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' },
  ).catch((e: unknown) => {
    // Duas contas importando o mesmo item ao mesmo tempo: o indice unico barra a segunda.
    if (e instanceof MongoServerError && e.code === 11000) throw forbidden();
    throw e;
  });
  await audit(ctx.col, 'connection.created', userId, { connectionId: doc!._id.toHexString(), connectorId: meta.connectorId, source }, ip);
  return doc!;
}

export async function listConnections(ctx: AppContext, userId: ObjectId) {
  return ctx.col.connections.find({ userId, removedAt: null }).sort({ createdAt: 1 }).toArray();
}

/**
 * RN-06: exclui o item no Pluggy; o usuario escolhe manter ou apagar o historico local.
 * Itens do Meu Pluggy nao sao apagados daqui: o consentimento e revogado em meu.pluggy.ai.
 */
export async function removeConnection(ctx: AppContext, userId: ObjectId, id: string, keepHistory: boolean, ip: string | null) {
  const conn = await findOwnConnection(ctx, userId, id);
  if (conn.source === 'WIDGET') {
    try {
      await pluggyOf(ctx).deleteItem(ctx.crypto.decrypt(conn.pluggyItemIdEnc));
    } catch (e) {
      // 404 no Pluggy = item ja removido; qualquer outro erro interrompe para nao deixar o consentimento ativo.
      const status = (e as { response?: { statusCode?: number } }).response?.statusCode;
      if (status !== 404) throw new AppError(502, 'PLUGGY_ERROR', 'Não foi possível remover a conexão no Pluggy. Tente novamente.');
    }
  }

  const { col } = ctx;
  if (keepHistory) {
    await col.connections.updateOne({ _id: conn._id }, { $set: { active: false, removedAt: new Date(), updatedAt: new Date() } });
  } else {
    const accountIds = (await col.accounts.find({ connectionId: conn._id }, { projection: { _id: 1 } }).toArray()).map((a) => a._id);
    const investmentIds = (await col.investments.find({ connectionId: conn._id }, { projection: { _id: 1 } }).toArray()).map((i) => i._id);
    await col.transactions.deleteMany({ connectionId: conn._id });
    await col.invoices.deleteMany({ accountId: { $in: accountIds } });
    await col.investmentSnapshots.deleteMany({ investmentId: { $in: investmentIds } });
    await col.investments.deleteMany({ connectionId: conn._id });
    await col.accounts.deleteMany({ connectionId: conn._id });
    await col.connections.deleteOne({ _id: conn._id });
  }
  await audit(col, 'connection.removed', userId, { connectionId: id, keepHistory }, ip);
}
