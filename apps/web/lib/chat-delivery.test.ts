import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, OFFLINE } from './api';
import { CHAT_RETRY_WAITS, deliver } from './chat-delivery';

// Chat sem mensagem de erro (doc. Melhorias, passo 4): falha passageira reenvia sozinha.
const run = <T,>(send: () => Promise<T>, cancelled = () => false) => {
  const waits: number[] = [];
  const onRetrying = vi.fn();
  const p = deliver(send, { onRetrying, cancelled, sleep: async (ms) => void waits.push(ms) });
  return { p, waits, onRetrying };
};

describe('entrega da mensagem do chat', () => {
  it('falha passageira (sem rede, IA instavel, 5xx) reenvia em silencio ate dar certo', async () => {
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiRequestError(0, OFFLINE, 'x'))
      .mockRejectedValueOnce(new ApiRequestError(502, 'LLM_FAILED', 'O Plutão não respondeu agora.'))
      .mockResolvedValueOnce('ok');
    const { p, waits, onRetrying } = run(send);
    expect(await p).toEqual({ kind: 'ok', value: 'ok' });
    expect(waits).toEqual(CHAT_RETRY_WAITS.slice(0, 2));
    expect(onRetrying).toHaveBeenCalledTimes(2);
  });

  it('regra de negocio (limite do dia) vira fala do Plutao, sem reenviar', async () => {
    const send = vi.fn<() => Promise<string>>().mockRejectedValue(new ApiRequestError(429, 'DAILY_LIMIT', 'Você chegou ao limite de 500 mensagens por dia.'));
    const { p, waits } = run(send);
    expect(await p).toEqual({ kind: 'notice', text: 'Você chegou ao limite de 500 mensagens por dia.' });
    expect(waits).toEqual([]);
  });

  it('esgotadas as tentativas: pausa (texto neutro + Reenviar), nunca erro', async () => {
    const send = vi.fn<() => Promise<string>>().mockRejectedValue(new ApiRequestError(0, OFFLINE, 'x'));
    const { p } = run(send);
    expect(await p).toEqual({ kind: 'paused' });
    expect(send).toHaveBeenCalledTimes(CHAT_RETRY_WAITS.length + 1);
  });

  it('nova conversa no meio cancela o reenvio', async () => {
    let cancel = false;
    const send = vi.fn<() => Promise<string>>().mockImplementation(async () => {
      cancel = true;
      throw new ApiRequestError(0, OFFLINE, 'x');
    });
    const { p } = run(send, () => cancel);
    expect(await p).toEqual({ kind: 'cancelled' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
