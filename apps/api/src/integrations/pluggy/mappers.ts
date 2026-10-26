import { createHash } from 'node:crypto';
import { PARC_RE, hasRealTime, parseInstallment } from '@pluto/finance-engine';
import { NEEDS_USER_ACTION, categoryKeyFor, paymentMethodOf, toMinor, type AccountType, type InvestmentType, type InvoiceStatus, type TransactionType } from '@pluto/shared';
import { matchKeyOf, normalizeDescription } from '../../lib/text';
import type { PluggyAccount, PluggyBill, PluggyInvestment, PluggyItem, PluggyTransaction } from './gateway';

// Funcoes puras: Pluggy -> modelo do Pluto. Dinheiro em centavos inteiros (secao 3.9).

const toDate = (d: Date | string | null | undefined) => (d ? new Date(d) : null);
const minorOrNull = (v: number | null | undefined) => (v == null ? null : toMinor(v));

export function mapItem(item: PluggyItem) {
  const status = item.status;
  const color = item.connector.primaryColor?.trim() || null;
  return {
    connectorId: item.connector.id,
    institutionName: item.connector.name,
    imageUrl: item.connector.imageUrl || null,
    primaryColor: color ? (color.startsWith('#') ? color : `#${color}`) : null,
    status,
    needsAction: NEEDS_USER_ACTION.includes(status),
    consentExpiresAt: toDate(item.consentExpiresAt),
    // Mensagem generica: o detalhe do erro do provedor pode conter dados pessoais.
    lastError: item.error ? `Erro do provedor (${item.error.code})` : null,
  };
}

/**
 * No Meu Pluggy o conector e sempre "MeuPluggy"; o banco real vem no nome das contas
 * (ex.: "Banco Bradesco"). Usa o nome mais frequente das contas bancarias.
 */
export function institutionFromAccounts(accounts: Pick<PluggyAccount, 'type' | 'name'>[]): string | null {
  const names = accounts.filter((a) => a.type === 'BANK').map((a) => a.name.trim()).filter(Boolean);
  if (!names.length) return null;
  const count = new Map<string, number>();
  names.forEach((n) => count.set(n, (count.get(n) ?? 0) + 1));
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

export function mapAccountType(a: Pick<PluggyAccount, 'type' | 'subtype'>): AccountType {
  if (a.type === 'CREDIT' || a.subtype === 'CREDIT_CARD') return 'CREDIT_CARD';
  if (a.subtype === 'SAVINGS_ACCOUNT') return 'SAVINGS';
  return 'CHECKING';
}

/** Mantem apenas os ultimos 4 digitos (secao 6.6). */
export function maskNumber(n: string | null | undefined): string | null {
  const digits = (n ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : null;
}

export function mapAccount(a: PluggyAccount) {
  const cd = a.creditData;
  const day = (d: Date | string | null | undefined) => toDate(d)?.getUTCDate() ?? null;
  return {
    pluggyAccountId: a.id,
    type: mapAccountType(a),
    name: a.marketingName?.trim() || a.name,
    numberMasked: maskNumber(a.number),
    balanceMinor: toMinor(a.balance),
    currency: a.currencyCode,
    creditLimitMinor: minorOrNull(cd?.creditLimit),
    availableCreditMinor: minorOrNull(cd?.availableCreditLimit),
    closingDay: day(cd?.balanceCloseDate),
    dueDay: day(cd?.balanceDueDate),
    brand: cd?.brand?.trim() || null,
  };
}

const CARD_PAYMENT_RE = /\b(pagamento|pagto|pgto|pag)\b.*\bfatura\b|\bfatura\b.*\b(pagamento|pagto|pgto|pag)\b/;
const CARD_CREDIT_PAYMENT_RE = /\b(pagamento|pagto|pgto)\b/;

/**
 * Tipo inicial da transacao. Regras de dedup (RN-13 transferencias proprias, RN-14 pagamento
 * de fatura) sao aplicadas aqui de forma conservadora; o pipeline de categorizacao refina depois.
 */
export function deriveType(t: Pick<PluggyTransaction, 'type' | 'category' | 'description'>, accountType: AccountType): TransactionType {
  const desc = normalizeDescription(t.description);
  const cat = (t.category ?? '').toLowerCase();
  const out = t.type === 'DEBIT';
  if (cat.includes('credit card payment')) return 'CARD_PAYMENT';
  if (accountType !== 'CREDIT_CARD' && out && CARD_PAYMENT_RE.test(desc)) return 'CARD_PAYMENT';
  if (accountType === 'CREDIT_CARD' && !out && CARD_CREDIT_PAYMENT_RE.test(desc)) return 'CARD_PAYMENT';
  if (cat.includes('same person transfer')) return 'TRANSFER';
  if (/^investments?\b/.test(cat)) return 'INVESTMENT';
  return out ? 'EXPENSE' : 'INCOME';
}

/** Identifica todas as parcelas da mesma compra (RN-15). */
function installmentGroupId(accountId: string, t: PluggyTransaction): string {
  const m = t.creditCardMetadata!;
  const base = normalizeDescription(t.description).replace(/\bparc(ela)?\b/g, '').trim();
  const purchase = toDate(m.purchaseDate)?.toISOString().slice(0, 10) ?? '';
  return createHash('sha256').update([accountId, base, m.totalAmount ?? '', purchase].join('|')).digest('hex').slice(0, 24);
}

/** Parcela lida da descricao (PARC07/09) quando o banco nao informa os metadados do cartao. */
function installmentFromText(accountId: string, t: PluggyTransaction, abs: number) {
  const p = parseInstallment(t.description);
  if (!p) return null;
  const base = normalizeDescription(t.description.replace(PARC_RE, ''));
  return { ...p, groupId: createHash('sha256').update([accountId, base, p.total, abs].join('|')).digest('hex').slice(0, 24) };
}

/**
 * Quem recebeu (saida) ou pagou (entrada): CPF/CNPJ, senao agencia+conta. Valor em claro, so para
 * gerar o hash (counterpartyKey) na sincronizacao; nunca e gravado (RN-D02).
 */
export function counterpartyRef(t: Pick<PluggyTransaction, 'type' | 'paymentData'>): string | null {
  const p = t.type === 'DEBIT' ? t.paymentData?.receiver : t.paymentData?.payer;
  const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '');
  const doc = digits(p?.documentNumber?.value);
  if (doc.length === 11 || doc.length === 14) return `doc:${doc}`;
  const acc = digits(p?.accountNumber), branch = digits(p?.branchNumber);
  if (acc && branch) return `acc:${p?.routingNumberISPB ?? p?.routingNumber ?? ''}:${branch}:${acc}`;
  return null;
}

export function mapTransaction(t: PluggyTransaction, accountType: AccountType) {
  const m = t.creditCardMetadata;
  // O sinal vem do tipo (DEBIT = saida), nao do campo amount, que varia entre conta e cartao.
  const abs = Math.abs(toMinor(t.amount));
  const installment =
    m?.installmentNumber && m.totalInstallments && m.totalInstallments > 1
      ? { n: m.installmentNumber, total: m.totalInstallments, groupId: installmentGroupId(t.accountId, t) }
      : installmentFromText(t.accountId, t, abs);
  const amountMinor = t.type === 'DEBIT' ? -abs : abs;
  const type = deriveType(t, accountType);
  return {
    pluggyTransactionId: t.id,
    date: new Date(t.date),
    /** RN-D03: transacao sem horario real fica fora da analise por horario. */
    hasTime: hasRealTime(new Date(t.date)),
    description: t.description,
    descriptionNorm: normalizeDescription(t.description),
    matchKey: matchKeyOf(t.description),
    merchant: t.merchant?.name?.trim() || t.merchant?.businessName?.trim() || null,
    amountMinor,
    currency: t.currencyCode,
    status: t.status === 'PENDING' ? ('PENDING' as const) : ('POSTED' as const),
    pluggyCategory: t.category ?? null,
    pluggyCategoryId: t.categoryId ?? null,
    pluggyBillId: m?.billId ?? null,
    installment,
    type,
    categoryKey: categoryKeyForType(type, t.category, amountMinor),
    paymentMethod: paymentMethodOf({ description: t.description, accountType, providerMethod: t.paymentData?.paymentMethod }),
  };
}

/** Empresa (CNPJ) ou pessoa (CPF) pela referencia de quem recebeu/pagou; null sem documento. */
export const counterpartyKindOf = (ref: string | null): 'pj' | 'pf' | null => (ref?.startsWith('doc:') ? (ref.length - 4 === 14 ? 'pj' : 'pf') : null);

/** Categoria coerente com o tipo: fatura, transferencia propria e investimento nunca viram gasto. */
export function categoryKeyForType(type: TransactionType, providerCategory: string | null | undefined, amountMinor: number): string {
  if (type === 'CARD_PAYMENT') return 'fatura';
  if (type === 'TRANSFER') return 'entre-contas';
  if (type === 'INVESTMENT') return 'investimentos';
  return categoryKeyFor(providerCategory, amountMinor);
}

export function mapInvestmentType(i: Pick<PluggyInvestment, 'type' | 'subtype'>): InvestmentType {
  switch (i.type) {
    case 'FIXED_INCOME':
      return 'FIXED_INCOME';
    case 'MUTUAL_FUND':
      return 'FUND';
    case 'ETF':
      return 'ETF';
    case 'EQUITY':
      if (i.subtype === 'ETF') return 'ETF';
      if (i.subtype === 'REAL_ESTATE_FUND') return 'FUND';
      return 'STOCK';
    default:
      return 'OTHER';
  }
}

function rateInfo(i: PluggyInvestment): string | null {
  const pctFmt = (v: number) => `${String(Math.round(v * 100) / 100).replace('.', ',')}%`;
  if (i.rate != null && i.rateType) return `${pctFmt(i.rate)} ${i.rateType}`;
  if (i.fixedAnnualRate != null) return `${pctFmt(i.fixedAnnualRate)} a.a.`;
  return null;
}

export function mapInvestment(i: PluggyInvestment) {
  return {
    pluggyInvestmentId: i.id,
    type: mapInvestmentType(i),
    subtype: i.subtype ?? null,
    name: i.name,
    quantity: i.quantity ?? null,
    appliedMinor: toMinor(i.amountOriginal ?? i.amount ?? i.balance),
    currentValueMinor: toMinor(i.balance),
    dueDate: toDate(i.dueDate),
    rateInfo: rateInfo(i),
    // Campos da taxa para projetar o rendimento (Investimentos).
    rate: i.rate ?? null,
    rateType: i.rateType ?? null,
    fixedAnnualRate: i.fixedAnnualRate ?? null,
    lastTwelveMonthsRate: i.lastTwelveMonthsRate ?? null,
  };
}

/** Faturas vencidas ha mais que isso sem pagamento informado: o Pluggy nao traz o pagamento de faturas antigas. */
const OVERDUE_WINDOW_MS = 40 * 86_400_000;

export function billStatus(totalMinor: number, paidMinor: number, closingDate: Date | null, dueDate: Date, now: Date): InvoiceStatus {
  if (totalMinor <= 0 || paidMinor >= totalMinor) return 'PAID';
  if (dueDate < now) return now.getTime() - dueDate.getTime() <= OVERDUE_WINDOW_MS ? 'OVERDUE' : 'CLOSED';
  if (closingDate && closingDate <= now) return 'CLOSED';
  return 'OPEN';
}

export function mapBill(b: PluggyBill, now: Date) {
  const totalMinor = toMinor(b.totalAmount);
  const paidMinor = (b.payments ?? []).reduce((s, p) => s + toMinor(p.amount), 0);
  const closingDate = toDate(b.billClosingDate), dueDate = new Date(b.dueDate);
  return { pluggyBillId: b.id, closingDate, dueDate, totalMinor, paidMinor, status: billStatus(totalMinor, paidMinor, closingDate, dueDate, now) };
}
