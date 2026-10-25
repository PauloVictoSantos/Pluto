// Forma de pagamento (doc. Melhorias, passo 8): Pix e como se pagou, nao o que se comprou. Fica num
// campo proprio da transacao; a categoria diz o que foi pago (Educacao, Mercado...).

export const TX_PAYMENT_METHODS = ['pix', 'debito', 'credito', 'boleto', 'dinheiro', 'transferencia'] as const;
export type TxPaymentMethod = (typeof TX_PAYMENT_METHODS)[number];
export const TX_PAYMENT_LABEL: Record<TxPaymentMethod, string> = {
  pix: 'Pix',
  debito: 'Débito',
  credito: 'Crédito',
  boleto: 'Boleto',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
};

/**
 * Forma de pagamento pela informacao do banco (paymentData.paymentMethod do Pluggy), senao pela
 * descricao; cartao de credito e sempre credito.
 */
export function paymentMethodOf(t: { description: string; accountType?: string | null; providerMethod?: string | null }): TxPaymentMethod | null {
  if (t.accountType === 'CREDIT_CARD') return 'credito';
  const m = (t.providerMethod ?? '').toUpperCase();
  if (m === 'PIX') return 'pix';
  if (m === 'BOLETO') return 'boleto';
  if (m === 'TED' || m === 'DOC' || m === 'TEF') return 'transferencia';
  const d = t.description.toUpperCase();
  if (/\bPIX\b/.test(d)) return 'pix';
  if (/\b(BOLETO|PAGTO? (DE )?TITULO|PAG BOLETO|COBRANCA)\b/.test(d)) return 'boleto';
  if (/\b(SAQUE|SAQ\b|ATM)\b/.test(d)) return 'dinheiro';
  if (/\b(TED|DOC|TEF|TRANSF(ERENCIA)?)\b/.test(d)) return 'transferencia';
  if (/\b(COMPRA|DEB(ITO)?|ELO DEBITO|VISA ELECTRON|MAESTRO)\b/.test(d)) return 'debito';
  return t.accountType === 'CHECKING' || t.accountType === 'SAVINGS' ? 'debito' : null;
}
