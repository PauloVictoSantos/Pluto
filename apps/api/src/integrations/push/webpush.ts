import webpush from 'web-push';

/**
 * Web Push (doc. "Notificacoes": service worker nativo + web-push, sem servico pago). O resto da API
 * depende so desta interface; os testes usam uma falsa. A chave privada VAPID fica so no servidor.
 */
export interface PushMessage {
  /** Texto da tela bloqueada: sem valor nem nome de estabelecimento (RN-A03). */
  body: string;
  url: string;
  /** Vencimento do dia: urgencia alta. */
  urgent?: boolean;
}

export interface Pusher {
  publicKey: string;
  /** gone: a inscricao expirou ou foi revogada (remover). */
  send(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, msg: PushMessage): Promise<'ok' | 'gone' | 'error'>;
}

export function createPusher(opts: { publicKey: string; privateKey: string; subject: string }): Pusher {
  return {
    publicKey: opts.publicKey,
    async send(sub, msg) {
      try {
        await webpush.sendNotification(sub, JSON.stringify({ title: 'Pluto', body: msg.body, url: msg.url }), {
          vapidDetails: { subject: opts.subject, publicKey: opts.publicKey, privateKey: opts.privateKey },
          TTL: 24 * 3600,
          urgency: msg.urgent ? 'high' : 'normal',
          timeout: 10_000,
        });
        return 'ok';
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? 'gone' : 'error';
      }
    },
  };
}
