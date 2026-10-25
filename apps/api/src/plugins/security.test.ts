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
