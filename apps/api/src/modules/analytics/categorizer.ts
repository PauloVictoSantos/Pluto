import { f1Macro, predictNB, trainNB, type NBModel } from '@pluto/finance-engine';
import { CATEGORY_BY_KEY } from '@pluto/shared';
import type { AnyBulkWriteOperation, ObjectId } from 'mongodb';
import type { Collections, TransactionDoc } from '../../db/collections';
import { categoryKeyForType } from '../../integrations/pluggy/mappers';
import { directionOf, ruleKeyOf, typeFor } from '../categories/rules';

// Categorizacao aprendida (doc. "Categorizacao aprendida", RN-D01): Naive Bayes multinomial treinado
// com as correcoes do usuario. Ordem da categoria efetiva: correcao do usuario > modelo >= 0,90 >
// Pluggy. Entre 0,60 e 0,90 so sugere. O modelo fica desligado sem F1 macro >= 0,85 (RN-I04).

const APPLY = 0.9;
const SUGGEST = 0.6;
const MIN_F1 = 0.85;
const MIN_EXAMPLES = 20;
const WINDOW_DAYS = 120;

/** Tokens da descricao sem o envelope do banco; o destinatario do Pix (hash) vira um token forte. */
export function tokensOf(t: Pick<TransactionDoc, 'matchKey' | 'descriptionNorm' | 'counterpartyKey'>): string[] {
  const words = (t.matchKey || t.descriptionNorm)
    .split(' ')
    .map((w) => w.replace(/parc(ela)?$/, ''))
    .filter((w) => w.length >= 3);
  return t.counterpartyKey ? [...words, t.counterpartyKey] : words;
}

/** Categorias internas mudam o tipo da transacao (fatura, entre contas): o modelo nunca aplica. */
const learnable = (key: string) => CATEGORY_BY_KEY[key]?.group !== 'internal';

/** Holdout deterministico de 20% (pelo id), para avaliar sem dado que o modelo viu. */
const isTest = (id: ObjectId) => parseInt(id.toHexString().slice(-4), 16) % 5 === 0;

export interface Categorizer {
  enabled: boolean;
  examples: number;
  f1: number | null;
  models: Record<'in' | 'out', NBModel>;
}

/**
 * Exemplos: transacoes que o usuario categorizou (MANUAL) e as das regras dele (RULE), uma por
 * destinatario/descricao para uma regra com muitas transacoes nao dominar o modelo.
 */
export async function buildCategorizer(col: Collections, userId: ObjectId): Promise<Categorizer> {
  const docs = await col.transactions
    .find(
      { userId, deletedAt: null, categorySource: { $in: ['MANUAL', 'RULE'] } },
      { projection: { amountMinor: 1, matchKey: 1, descriptionNorm: 1, counterpartyKey: 1, categoryKey: 1, categorySource: 1 } },
    )
    .toArray();
  const seen = new Set<string>();
  const examples = docs
    .filter((d) => learnable(d.categoryKey))
    .filter((d) => {
      if (d.categorySource === 'MANUAL') return true;
      const k = `${directionOf(d.amountMinor)}|${ruleKeyOf(d)}|${d.categoryKey}`;
      return !seen.has(k) && !!seen.add(k);
    })
    .map((d) => ({ id: d._id, dir: directionOf(d.amountMinor), tokens: tokensOf(d), label: d.categoryKey }))
    .filter((e) => e.tokens.length);

  const byDir = (dir: 'in' | 'out', pick: (e: (typeof examples)[number]) => boolean = () => true) =>
    trainNB(examples.filter((e) => e.dir === dir && pick(e)));

  let f1: number | null = null;
  const test = examples.filter((e) => isTest(e.id));
  if (examples.length >= MIN_EXAMPLES && test.length >= 4) {
    const train = { in: byDir('in', (e) => !isTest(e.id)), out: byDir('out', (e) => !isTest(e.id)) };
    const pairs = test
      .filter((e) => train[e.dir].classes.size)
      .map((e) => ({ truth: e.label, pred: predictNB(train[e.dir], e.tokens)[0]!.label }));
    f1 = pairs.length ? f1Macro(pairs) : null;
  }
  return { enabled: f1 !== null && f1 >= MIN_F1, examples: examples.length, f1, models: { in: byDir('in'), out: byDir('out') } };
}

/**
 * Aplica o modelo nas transacoes recentes sem categoria do usuario. Com o modelo desligado, desfaz o que
 * ele tinha aplicado (volta para a categoria do Pluggy). Nunca toca MANUAL/RULE (RN-12).
 */
export async function autoCategorize(col: Collections, userId: ObjectId, now = new Date()): Promise<{ applied: number; suggested: number; status: Categorizer }> {
  const c = await buildCategorizer(col, userId);
  const txs = await col.transactions
    .find(
      {
        userId,
        deletedAt: null,
        type: { $in: ['INCOME', 'EXPENSE'] },
        categorySource: { $nin: ['MANUAL', 'RULE'] },
        // Estabelecimento agrupado: a categoria vem do grupo (merchants/service).
        merchantGroupId: null,
        date: { $gte: new Date(now.getTime() - WINDOW_DAYS * 86_400_000) },
      },
      { projection: { amountMinor: 1, matchKey: 1, descriptionNorm: 1, counterpartyKey: 1, categoryKey: 1, categorySource: 1, pluggyCategory: 1, type: 1, aiSuggestion: 1 } },
    )
    .toArray();

  const ops: AnyBulkWriteOperation<TransactionDoc>[] = [];
  let applied = 0, suggested = 0;
  for (const t of txs) {
    const model = c.models[directionOf(t.amountMinor)];
    const top = c.enabled && model.classes.size >= 2 ? predictNB(model, tokensOf(t))[0] : undefined;
    const pluggyKey = categoryKeyForType(t.type, t.pluggyCategory, t.amountMinor);
    let set: Partial<TransactionDoc>;
    if (top && top.p >= APPLY) {
      applied++;
      set = { categoryKey: top.label, categorySource: 'AI', categoryConfidence: top.p, type: typeFor(top.label, t.amountMinor), aiSuggestion: null };
    } else {
      // Modelo deixou de ter certeza (ou foi desligado): volta para a categoria do Pluggy.
      const back = t.categorySource === 'AI' ? { categoryKey: pluggyKey, categorySource: null, categoryConfidence: null } : {};
      const suggestion = top && top.p >= SUGGEST && top.label !== (back.categoryKey ?? t.categoryKey) ? { categoryKey: top.label, p: top.p } : null;
      if (suggestion) suggested++;
      set = { ...back, aiSuggestion: suggestion };
    }
    const changed = Object.entries(set).some(([k, v]) => JSON.stringify((t as Record<string, unknown>)[k] ?? null) !== JSON.stringify(v ?? null));
    if (changed) ops.push({ updateOne: { filter: { _id: t._id, categorySource: { $nin: ['MANUAL', 'RULE'] } }, update: { $set: set } } });
  }
  if (ops.length) await col.transactions.bulkWrite(ops, { ordered: false });
  return { applied, suggested, status: c };
}
