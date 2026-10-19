import { detectRecurrence, findPendingDuplicates, remainingInstallments } from '@pluto/finance-engine';
import type { Commitments } from '@pluto/shared';
import type { AnyBulkWriteOperation, ObjectId } from 'mongodb';
import type { Collections, RecurrenceDoc, TransactionDoc } from '../../db/collections';
import { directionOf, ruleKeyOf } from '../categories/rules';

const DAY = 86_400_000;
/** Janela das recorrencias: pega assinaturas anuais com pelo menos 3 ocorrencias so com historico longo. */
const RECURRENCE_WINDOW_DAYS = 400;

/**
 * Pendente que voltou liquidada com outro id: marca como duplicada da liquidada e tira das contas.
 * Nao apaga nada (RN-G07); a transacao do Pluggy continua guardada, so marcada.
 */
export async function dedupPending(col: Collections, accountId: ObjectId, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 60 * DAY);
  const proj = { projection: { date: 1, amountMinor: 1, descriptionNorm: 1, status: 1 } };
  const docs = await col.transactions.find({ accountId, deletedAt: null, date: { $gte: since } }, proj).toArray();
  const cand = (t: Pick<TransactionDoc, '_id' | 'date' | 'amountMinor' | 'descriptionNorm'>) => ({
    id: t._id.toHexString(),
    date: t.date,
    amountMinor: t.amountMinor,
    text: t.descriptionNorm,
  });
  const pairs = findPendingDuplicates(
    docs.filter((t) => t.status === 'PENDING').map(cand),
    docs.filter((t) => t.status === 'POSTED').map(cand),
  );
  if (!pairs.length) return 0;
  const byId = new Map(docs.map((t) => [t._id.toHexString(), t._id]));
  await col.transactions.bulkWrite(
    pairs.map(([p, q]) => ({
      updateOne: { filter: { _id: byId.get(p)! }, update: { $set: { deletedAt: now, duplicateOf: byId.get(q)!, updatedAt: now } } },
    })),
  );
  return pairs.length;
}

/**
 * Recalcula as series recorrentes do usuario. Parcelas ficam de fora (ja tem prazo conhecido), assim
 * como transferencias entre contas proprias, fatura e investimento (RN-G05).
 */
export async function refreshRecurrences(col: Collections, userId: ObjectId, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - RECURRENCE_WINDOW_DAYS * DAY);
  const txs = await col.transactions
    .find(
      { userId, deletedAt: null, installment: null, type: { $in: ['INCOME', 'EXPENSE'] }, date: { $gte: since } },
      { projection: { date: 1, amountMinor: 1, matchKey: 1, counterpartyKey: 1, descriptionNorm: 1, merchant: 1, description: 1, categoryKey: 1 } },
    )
    .toArray();

  const groups = new Map<string, TransactionDoc[]>();
  for (const t of txs) {
    const g = `${directionOf(t.amountMinor)}|${ruleKeyOf(t)}`;
    groups.set(g, [...(groups.get(g) ?? []), t as TransactionDoc]);
  }

  const ops: AnyBulkWriteOperation<RecurrenceDoc>[] = [];
  const keep: string[] = [];
  for (const [g, list] of groups) {
    const r = detectRecurrence(list);
    if (!r) continue;
    const [direction, key] = [g.slice(0, g.indexOf('|')) as 'in' | 'out', g.slice(g.indexOf('|') + 1)];
    const last = list.reduce((a, b) => (b.date > a.date ? b : a));
    keep.push(g);
    ops.push({
      updateOne: {
        filter: { userId, key, direction },
        update: {
          $set: {
            label: last.merchant ?? (last.matchKey || last.description),
            categoryKey: last.categoryKey,
            period: r.period,
            amountMinor: r.amountMinor,
            count: r.count,
            lastDate: r.lastDate,
            nextDate: r.nextDate,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    });
  }
  if (ops.length) await col.recurrences.bulkWrite(ops, { ordered: false });
  // Series que deixaram de ser recorrentes (cancelou a assinatura, mudou o valor) saem.
  const stale = await col.recurrences.find({ userId }, { projection: { key: 1, direction: 1 } }).toArray();
  const gone = stale.filter((d) => !keep.includes(`${d.direction}|${d.key}`)).map((d) => d._id);
  if (gone.length) await col.recurrences.deleteMany({ _id: { $in: gone } });
  return ops.length;
}

/** Chaves recorrentes do usuario, para marcar "recorrente" na lista de transacoes. */
export async function recurringKeys(col: Collections, userId: ObjectId): Promise<Set<string>> {
  const docs = await col.recurrences.find({ userId }, { projection: { key: 1, direction: 1 } }).toArray();
  return new Set(docs.map((d) => `${d.direction}|${d.key}`));
}

/**
 * Compromissos ja conhecidos: series recorrentes e parcelas que ainda vao cair. Entram na projecao
 * do saldo como gasto/receita certos (fase 3).
 */
export async function commitments(col: Collections, userId: ObjectId, now = new Date()): Promise<Commitments> {
  const recurring = await col.recurrences.find({ userId }).sort({ nextDate: 1 }).toArray();

  // Ultima parcela vista de cada compra parcelada.
  const since = new Date(now.getTime() - 70 * DAY);
  const inst = await col.transactions
    .aggregate<{ _id: string; n: number; total: number; amountMinor: number; label: string; categoryKey: string; date: Date }>([
      { $match: { userId, deletedAt: null, 'installment.groupId': { $exists: true }, date: { $gte: since } } },
      { $sort: { 'installment.n': -1, date: -1 } },
      {
        $group: {
          _id: '$installment.groupId',
          n: { $first: '$installment.n' },
          total: { $first: '$installment.total' },
          amountMinor: { $first: '$amountMinor' },
          label: { $first: { $ifNull: ['$merchant', '$description'] } },
          categoryKey: { $first: '$categoryKey' },
          date: { $first: '$date' },
        },
      },
    ])
    .toArray();
  const installments = inst
    .map((i) => ({ ...i, remaining: remainingInstallments(i) }))
    .filter((i) => i.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)
    .map((i) => ({
      groupId: i._id,
      label: i.label,
      categoryKey: i.categoryKey,
      n: i.n,
      total: i.total,
      remaining: i.remaining,
      amountMinor: i.amountMinor,
      remainingMinor: i.amountMinor * i.remaining,
      lastDate: i.date,
    }));

  return {
    recurring: recurring.map((r) => ({
      key: r.key.startsWith('cp:') ? 'destinatario' : 'descricao',
      direction: r.direction,
      label: r.label,
      categoryKey: r.categoryKey,
      period: r.period,
      amountMinor: r.amountMinor,
      count: r.count,
      lastDate: r.lastDate,
      nextDate: r.nextDate,
    })),
    installments,
  };
}
