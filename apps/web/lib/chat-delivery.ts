import { ApiRequestError, OFFLINE } from './api';

// Entrega de mensagem do chat sem mensagem de erro (doc. Melhorias, passo 4): falha passageira vira
// "Estou organizando suas informacoes..." e a mesma mensagem (mesmo clientId) e reenviada sozinha.

/** Esperas entre os reenvios do chat, depois das novas tentativas do cliente da API (~1,6 min no total). */
export const CHAT_RETRY_WAITS = [3_000, 8_000, 15_000, 20_000, 20_000, 30_000];
export const WORKING_TEXT = 'Estou organizando suas informações, só um momento…';
export const PAUSED_TEXT = 'Ainda estou organizando suas informações. Sua mensagem ficou guardada: toque em Reenviar quando quiser.';

/** Respostas da regra de negocio (limite diario, consentimento, IA desligada): viram fala do Plutao. */
const BUSINESS = new Set(['DAILY_LIMIT', 'AI_CONSENT_REQUIRED', 'LLM_NOT_CONFIGURED']);

export function isTransient(e: unknown): boolean {
  if (!(e instanceof ApiRequestError)) return true;
  if (BUSINESS.has(e.code)) return false;
  return e.code === OFFLINE || e.code === 'RATE_LIMITED' || e.code === 'REFRESH_RACE' || e.status >= 500;
}

export type Delivery<T> = { kind: 'ok'; value: T } | { kind: 'notice'; text: string } | { kind: 'paused' } | { kind: 'cancelled' };

export async function deliver<T>(
  send: () => Promise<T>,
  opts: { onRetrying: () => void; cancelled: () => boolean; sleep?: (ms: number) => Promise<void> },
): Promise<Delivery<T>> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      const value = await send();
      return opts.cancelled() ? { kind: 'cancelled' } : { kind: 'ok', value };
    } catch (e) {
      if (opts.cancelled()) return { kind: 'cancelled' };
      if (!isTransient(e)) return { kind: 'notice', text: e instanceof ApiRequestError ? e.message : WORKING_TEXT };
      if (attempt >= CHAT_RETRY_WAITS.length) return { kind: 'paused' };
      opts.onRetrying();
      await sleep(CHAT_RETRY_WAITS[attempt]!);
      if (opts.cancelled()) return { kind: 'cancelled' };
    }
  }
}
