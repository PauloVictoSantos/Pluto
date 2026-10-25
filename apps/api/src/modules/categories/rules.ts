import type { TransactionType } from '@pluto/shared';
import type { Document, Filter } from 'mongodb';
import type { CategoryRuleDoc, Collections, TransactionDoc } from '../../db/collections';

/** Categoria definida pelo usuario: sincronizacao e migracoes nunca sobrescrevem (RN-12). */
export const USER_SOURCES = ['MANUAL', 'RULE'] as const;

const INTERNAL_TYPE: Record<string, TransactionType> = {
  fatura: 'CARD_PAYMENT',
  'entre-contas': 'TRANSFER',
  investimentos: 'INVESTMENT',
  // Saiu da conta, mas o gasto esta nas partes (uma por compra da divida).
  'pago-dividido': 'TRANSFER',
};

/**
 * Tipo coerente com a categoria: "Entre minhas contas", "Pagamento de fatura" e "Investimentos"
 * saem de receitas/despesas (RN-13/14); as demais seguem o sinal do valor.
 */
export function typeFor(categoryKey: string, amountMinor: number): TransactionType {
  return INTERNAL_TYPE[categoryKey] ?? (amountMinor > 0 ? 'INCOME' : 'EXPENSE');
}

/** O mesmo que typeFor, como expressao de update em pipeline (o sinal varia por documento). */
const typeExpr = (categoryKey: string): Document | string =>
  INTERNAL_TYPE[categoryKey] ?? { $cond: [{ $gt: ['$amountMinor', 0] }, 'INCOME', 'EXPENSE'] };

export const directionOf = (amountMinor: number): 'in' | 'out' => (amountMinor > 0 ? 'in' : 'out');
const amountFilter = (d: 'in' | 'out') => (d === 'in' ? { $gt: 0 } : { $lte: 0 });

/**
 * Chave de regra da transacao: o destinatario (hash do CPF/CNPJ ou da conta) quando o banco informa;
 * senao a descricao sem o envelope do banco. Assim o rotulo de um Pix so passa para Pix ao mesmo
 * destinatario (RN-D02), mesmo que o nome venha escrito de outro jeito.
 */
export const ruleKeyOf = (t: Pick<TransactionDoc, 'counterpartyKey' | 'matchKey' | 'descriptionNorm'>) =>
  t.counterpartyKey ?? t.matchKey ?? t.descriptionNorm;

/** Filtro das transacoes cobertas por uma chave de regra. */
export const ruleKeyFilter = (key: string): Filter<TransactionDoc> => (key.startsWith('cp:') ? { counterpartyKey: key } : { matchKey: key });

/** Aplica a regra nas transacoes que ainda nao tem categoria escolhida pelo usuario. */
export async function applyRule(col: Collections, rule: Pick<CategoryRuleDoc, 'userId' | 'matchKey' | 'direction' | 'categoryKey'>, extra: Filter<TransactionDoc> = {}) {
  const r = await col.transactions.updateMany(
    {
      ...extra,
      userId: rule.userId,
      ...ruleKeyFilter(rule.matchKey),
      amountMinor: amountFilter(rule.direction),
      categorySource: { $nin: [...USER_SOURCES] },
      deletedAt: null,
    },
    [{ $set: { categoryKey: rule.categoryKey, categorySource: 'RULE', type: typeExpr(rule.categoryKey), needsReview: false, updatedAt: '$$NOW' } }],
  );
  return r.modifiedCount;
}

/** Depois de importar transacoes: aplica as regras do usuario nas novas/sem categoria do usuario. */
export async function applyUserRules(col: Collections, userId: TransactionDoc['userId'], extra: Filter<TransactionDoc> = {}) {
  let n = 0;
  for (const rule of await col.categoryRules.find({ userId }).toArray()) n += await applyRule(col, rule, extra);
  return n;
}
