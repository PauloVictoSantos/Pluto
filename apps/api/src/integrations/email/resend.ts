/**
 * Envio de e-mail (Resend). O resto da API depende so desta interface; os testes usam uma falsa.
 * A chave fica so no servidor; o conteudo nunca vai para o log.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  /** Mesmo envio repetido (retry, clique duplo) nao gera dois e-mails. */
  idempotencyKey: string;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

export function createResendMailer(opts: { apiKey: string; from: string; timeoutMs?: number }): Mailer {
  return {
    async send(email) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': email.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from: opts.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      // A mensagem do Resend explica o problema (ex.: dominio nao verificado) e nao contem segredo.
      if (!res.ok || !data.id) throw new Error(`Resend ${res.status}: ${data.message ?? 'falha no envio'}`);
      return { id: data.id };
    },
  };
}
