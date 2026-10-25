import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, OFFLINE, RETRY_DELAYS, refreshSession, setOnConnecting, setSleep } from './api';

// Servidor acordando (Render) ou rede instavel: o cliente tenta de novo antes de mostrar aviso
// (doc. Melhorias, passo 2).
const html = (status: number) => new Response('<html>Service waking up</html>', { status, headers: { 'content-type': 'text/html' } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let waits: number[];
let connecting: boolean[];
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  waits = [];
  connecting = [];
  setSleep(async (ms) => void waits.push(ms));
  setOnConnecting((on) => connecting.push(on));
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('novas tentativas', () => {
  it('gateway 502/503 sem JSON: espera 1 s, 3 s e tenta de novo; mostra "Preparando" so durante', async () => {
    fetchMock.mockResolvedValueOnce(html(502)).mockResolvedValueOnce(html(503)).mockResolvedValueOnce(json(200, { status: 'ok' }));
    await expect(api.wake()).resolves.toEqual({ status: 'ok' });
    expect(waits).toEqual([1_000, 3_000]);
    expect(connecting).toEqual([true, false]);
  });

  it('falha de rede: 3 novas tentativas (1 s, 3 s, 6 s) e depois aviso sem termo tecnico', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await api.wake().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).code).toBe(OFFLINE);
    expect((err as ApiRequestError).message).not.toMatch(/fetch|servidor|erro/i);
    expect(fetchMock).toHaveBeenCalledTimes(RETRY_DELAYS.length + 1);
    expect(waits).toEqual(RETRY_DELAYS);
  });

  it('login tenta de novo; erro da propria API (JSON) nao repete', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(200, { mfaRequired: true, mfaToken: 't' }));
    await expect(api.login('12345678909', 'senha')).resolves.toMatchObject({ mfaToken: 't' });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(json(503, { error: { code: 'LLM_NOT_CONFIGURED', message: 'Ative a IA.' } }));
    await expect(api.agentChat()).rejects.toMatchObject({ code: 'LLM_NOT_CONFIGURED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('escrita comum (POST) nao repete sozinha', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.createBill({ payee: 'Luz' })).rejects.toMatchObject({ code: OFFLINE });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('chat repete com o mesmo clientId e sem a tela de "Preparando"', async () => {
    const state = { messages: [], pending: null, available: true, consent: true };
    fetchMock.mockResolvedValueOnce(html(502)).mockResolvedValueOnce(json(200, state));
    await api.sendAgentMessage('oi', 'id-12345678');
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init!.body)));
    expect(bodies).toEqual([{ message: 'oi', clientId: 'id-12345678' }, { message: 'oi', clientId: 'id-12345678' }]);
    expect(connecting).toEqual([]);
  });

  it('sem rede, a renovacao da sessao nao desloga: avisa que esta offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(refreshSession()).rejects.toMatchObject({ code: OFFLINE });
    fetchMock.mockReset();
    await new Promise((r) => setTimeout(r, 0));
    fetchMock.mockResolvedValue(json(401, { error: { code: 'INVALID_SESSION', message: 'Sessão expirada.' } }));
    await expect(refreshSession()).resolves.toBe(false);
  });
});
