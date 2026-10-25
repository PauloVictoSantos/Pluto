import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../test/harness';

// Cabecalhos de seguranca de que o site depende.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

describe('cabecalhos de seguranca', () => {
  it('respostas da API nao ficam em cache (dados financeiros)', async () => {
    const userId = (await h.createUser()).id;
    const pub = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(pub.headers['cache-control']).toBe('no-store');
    const priv = await h.app.inject({ method: 'GET', url: '/v1/agent/profile', headers: { authorization: `Bearer ${await h.token(userId)}` } });
    expect(priv.statusCode).toBe(200);
    expect(priv.headers['cache-control']).toBe('no-store');
    const err = await h.app.inject({ method: 'GET', url: '/v1/agent/profile' });
    expect(err.statusCode).toBe(401);
    expect(err.headers['cache-control']).toBe('no-store');
    expect(pub.headers['strict-transport-security']).toContain('max-age=63072000');
  });
});

describe('validacao de entrada', () => {
  it('campo extra e tipo errado viram 400 com mensagem clara', async () => {
    const userId = (await h.createUser({ email: 'val@pluto.test' })).id;
    const put = async (payload: object) =>
      h.app.inject({ method: 'PUT', url: '/v1/agent/profile', payload, headers: { authorization: `Bearer ${await h.token(userId)}` } });
    const extra = await put({ safetyMarginPct: 5, isAdmin: true });
    expect(extra.statusCode).toBe(400);
    expect(extra.json().error).toEqual({ code: 'VALIDATION_ERROR', message: 'Campo não permitido: "isAdmin".' });
    const wrong = await put({ safetyMarginPct: 'cinco' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.message).toMatch(/^Dados inválidos em "safetyMarginPct": .*número/);
    // Regras da rota continuam valendo com o modo estrito.
    expect((await put({})).json().error.message).toContain('Nada para atualizar');
    expect((await put({ safetyMarginPct: 5 })).statusCode).toBe(200);
  });
});
