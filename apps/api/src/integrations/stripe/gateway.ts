import Stripe from 'stripe';

/**
 * Fronteira com o Stripe (boletos). O resto da API depende so desta interface;
 * os testes usam uma implementacao falsa.
 */
export interface BoletoIssued {
  paymentIntentId: string;
  /** Linha digitavel. */
  number: string | null;
  pdfUrl: string | null;
  voucherUrl: string | null;
}

/** Situacao do boleto no Stripe, ja traduzida. */
export type BoletoStatus = 'OPEN' | 'PAID' | 'EXPIRED' | 'CANCELED';

export interface CreateBoletoInput {
  amountMinor: number;
  description: string;
  /** Dias ate o vencimento (0 a 60), contados em America/Sao_Paulo pelo Stripe. */
  expiresAfterDays: number;
  payer: { name: string; email: string; taxId: string; address: { postalCode: string; line1: string; city: string; state: string } };
  metadata: Record<string, string>;
  /** Mesma parcela nunca gera dois boletos, mesmo com retry. */
  idempotencyKey: string;
}

export interface StripeGateway {
  createBoleto(input: CreateBoletoInput): Promise<BoletoIssued>;
  getStatus(paymentIntentId: string): Promise<BoletoStatus>;
  cancel(paymentIntentId: string): Promise<void>;
  /** Valida a assinatura do webhook e devolve so o ID do pagamento (o estado e reconsultado). */
  parseWebhook(rawBody: Buffer, signature: string): { type: string; paymentIntentId: string | null };
}

export function toBoletoStatus(pi: Pick<Stripe.PaymentIntent, 'status'>): BoletoStatus {
  switch (pi.status) {
    case 'succeeded':
      return 'PAID';
    case 'canceled':
      return 'CANCELED';
    // Boleto vencido sem pagamento volta a pedir meio de pagamento.
    case 'requires_payment_method':
      return 'EXPIRED';
    default:
      // requires_action (aguardando pagamento) e processing (pago, compensando).
      return 'OPEN';
  }
}

export function createStripeGateway(opts: { secretKey: string; webhookSecret?: string }): StripeGateway {
  const stripe = new Stripe(opts.secretKey, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'Pluto' } });

  return {
    async createBoleto(input) {
      const pi = await stripe.paymentIntents.create(
        {
          amount: input.amountMinor,
          currency: 'brl',
          allowed_payment_method_types: ['boleto'],
          payment_method_data: {
            type: 'boleto',
            boleto: { tax_id: input.payer.taxId },
            billing_details: {
              name: input.payer.name,
              email: input.payer.email,
              address: { line1: input.payer.address.line1, city: input.payer.address.city, state: input.payer.address.state, postal_code: input.payer.address.postalCode, country: 'BR' },
            },
          },
          payment_method_options: { boleto: { expires_after_days: input.expiresAfterDays } },
          confirm: true,
          description: input.description.slice(0, 500) || undefined,
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      const d = pi.next_action?.boleto_display_details;
      return { paymentIntentId: pi.id, number: d?.number ?? null, pdfUrl: d?.pdf ?? null, voucherUrl: d?.hosted_voucher_url ?? null };
    },
    async getStatus(id) {
      return toBoletoStatus(await stripe.paymentIntents.retrieve(id));
    },
    async cancel(id) {
      await stripe.paymentIntents.cancel(id);
    },
    parseWebhook(rawBody, signature) {
      if (!opts.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET ausente');
      const event = stripe.webhooks.constructEvent(rawBody, signature, opts.webhookSecret);
      const obj = event.data.object as { object?: string; id?: string };
      return { type: event.type, paymentIntentId: obj.object === 'payment_intent' && obj.id ? obj.id : null };
    },
  };
}
