import type { Db } from 'mongodb';
import { categoryKeyForType } from '../integrations/pluggy/mappers';
import { matchKeyOf } from '../lib/text';

/**
 * Migracoes de dados idempotentes, executadas na inicializacao da API e no db:setup.
 * Cada passo so mexe em documentos que ainda precisam da mudanca.
 */
export async function runMigrations(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  const tx = db.collection('transactions');
  // Documentos antigos fora do schema atual nao devem travar a atualizacao, entao tenta com
  // bypassDocumentValidation. Em producao o usuario da API so tem readWrite (essa acao exige papel
  // de admin no Atlas): sem permissao, refaz sem o bypass.
  let opts: { bypassDocumentValidation?: boolean } = { bypassDocumentValidation: true };
  const write = async <T>(op: (o: typeof opts) => Promise<T>): Promise<T> => {
    try {
      return await op(opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!opts.bypassDocumentValidation || !(/bypassDocumentValidation/.test(msg) || (e as { code?: number }).code === 13)) throw e;
      opts = {};
      return op(opts);
    }
  };

  // 0. Indice antigo de orcamentos por categoryId (substituido por categoryKey). Unico e sobre um
  //    campo ausente, ele impediria mais de um orcamento por mes.
  const budgetIdx = await db.collection('budgets').indexes().catch(() => []);
  if (budgetIdx.some((i) => i.name === 'userId_1_month_1_categoryId_1')) {
    await db.collection('budgets').dropIndex('userId_1_month_1_categoryId_1');
    log('índice antigo de orçamentos removido');
  }

  // 0b. Unicidade do item do Pluggy passou de por usuario para global (um item, um dono).
  const connIdx = await db.collection('connections').indexes().catch(() => []);
  if (connIdx.some((i) => i.name === 'userId_1_pluggyItemIdHash_1')) {
    await db.collection('connections').dropIndex('userId_1_pluggyItemIdHash_1');
    log('índice antigo de conexões por usuário removido');
  }

  // 1. categoryKey derivado da categoria do Pluggy: preenche os que faltam e recalcula quando as
  //    regras mudam. Categoria definida pelo usuario (categorySource MANUAL/RULE) nunca e tocada (RN-12).
  const groups = await tx
    .aggregate<{ _id: { type: string; cat: string | null; sign: number }; keys: (string | null)[] }>([
      { $match: { categorySource: { $nin: ['MANUAL', 'RULE'] } } },
      {
        $group: {
          _id: { type: '$type', cat: '$pluggyCategory', sign: { $cond: [{ $gt: ['$amountMinor', 0] }, 1, -1] } },
          keys: { $addToSet: { $ifNull: ['$categoryKey', null] } },
        },
      },
    ])
    .toArray();
  let changed = 0;
  for (const { _id, keys } of groups) {
    const key = categoryKeyForType(_id.type as never, _id.cat, _id.sign);
    if (keys.length === 1 && keys[0] === key) continue;
    const r = await write((o) =>
      tx.updateMany(
        {
          categorySource: { $nin: ['MANUAL', 'RULE'] },
          type: _id.type,
          pluggyCategory: _id.cat,
          amountMinor: _id.sign > 0 ? { $gt: 0 } : { $lte: 0 },
          categoryKey: { $ne: key },
        },
        { $set: { categoryKey: key } },
        o,
      ),
    );
    changed += r.modifiedCount;
  }
  if (changed) log(`categoria recalculada em ${changed} transações`);

  // 2. matchKey (base das regras de categoria) nas transacoes importadas antes dele existir.
  let keyed = 0;
  for (;;) {
    const batch = await tx.find({ matchKey: { $exists: false } }, { projection: { description: 1 } }).limit(1000).toArray();
    if (!batch.length) break;
    await write((o) =>
      tx.bulkWrite(
        batch.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { matchKey: matchKeyOf(String(d.description ?? '')) } } } })),
        o,
      ),
    );
    keyed += batch.length;
  }
  if (keyed) log(`chave de agrupamento gravada em ${keyed} transações`);

  // 3. Faturas antigas sem pagamento informado pelo Pluggy nao sao "atrasadas" (o Pluggy nao traz o pagamento).
  const cutoff = new Date(Date.now() - 40 * 86_400_000);
  const r = await write((o) => db.collection('invoices').updateMany({ status: 'OVERDUE', dueDate: { $lt: cutoff } }, { $set: { status: 'CLOSED', updatedAt: new Date() } }, o));
  if (r.modifiedCount) log(`${r.modifiedCount} faturas antigas reclassificadas de OVERDUE para CLOSED`);

  // 4. RN-D03: horario real ou so data (hora redonda) nas transacoes importadas antes do campo.
  const isRound = { $and: [{ $eq: [{ $minute: '$date' }, 0] }, { $eq: [{ $second: '$date' }, 0] }, { $eq: [{ $millisecond: '$date' }, 0] }] };
  const timed = await write((o) => tx.updateMany({ hasTime: { $exists: false } }, [{ $set: { hasTime: { $not: [isRound] } } }], o));
  if (timed.modifiedCount) log(`horário real/só data marcado em ${timed.modifiedCount} transações`);

  // 5. Destinatario do Pix (RN-D02) e parcelas pela descricao so chegam reimportando: uma vez por
  //    conexao, a proxima sincronizacao busca o historico inteiro (upsert idempotente, RN-01).
  const backfill = await write((o) =>
    db
      .collection('connections')
      .updateMany({ analyticsBackfillAt: { $exists: false }, removedAt: null }, { $set: { lastTransactionsSyncAt: null, analyticsBackfillAt: new Date() } }, o),
  );
  if (backfill.modifiedCount) log(`${backfill.modifiedCount} conexões vão reimportar o histórico (destinatário e parcelas)`);
}
