import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { startHarness, type Harness } from '../test/harness';

// Com NODE_ENV=test o limitador fica desligado (allowList); aqui ele roda de verdade.
let h: Harness;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  h = await startHarness();
  app = await buildApp({ ...h.ctx, env: { ...h.ctx.env, NODE_ENV: 'development', LOG_LEVEL: 'fatal' } });
}, 120_000);
afterAll(async () => {
  await app?.close();
  await h?.close();
});

// Requisicao que chega pelo proxy do Next (mesma maquina) em nome de um cliente.
const viaProxy = (client: string) => ({ remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': client } });

describe('limites por cliente atras do proxy', () => {
  it('um cliente esgotando o login nao bloqueia o login do dono', async () => {
    const owner = await h.createUser({ email: 'dono-rl@pluto.test' });
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/v1/auth/login', payload: {}, ...viaProxy('203.0.113.9') });
    const attacker = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: {}, ...viaProxy('203.0.113.9') });
    expect(attacker.statusCode).toBe(429);

    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { cpf: owner.cpf, password: owner.password }, ...viaProxy('198.51.100.7') });
    expect(res.statusCode).toBe(200);
  });

  it('o cliente nao forja o IP: o proxy de confianca e so o loopback', async () => {
    // Direto na API a partir de outra maquina, o X-Forwarded-For e ignorado: todas contam juntas.
    const direct = (fake: string) => ({ remoteAddress: '192.0.2.50', headers: { 'x-forwarded-for': fake } });
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/v1/auth/login', payload: {}, ...direct(`10.0.0.${i}`) });
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: {}, ...direct('10.0.0.99') })).statusCode).toBe(429);
  });

  it('rotas autenticadas contam por usuario, nao por IP', async () => {
    const [a, b] = [await h.createUser({ email: 'a-rl@pluto.test' }), await h.createUser({ email: 'b-rl@pluto.test' })];
    const ask = async (userId: typeof a.id) =>
      app.inject({
        method: 'POST',
        url: '/v1/assistant/ask',
        payload: { question: 'oi' },
        remoteAddress: '127.0.0.1',
        headers: { authorization: `Bearer ${await h.token(userId)}` },
      });
    // Sem LLM configurado a rota responde 503, mas cada chamada conta no limite (20/min).
    for (let i = 0; i < 20; i++) expect((await ask(a.id)).statusCode).toBe(503);
    expect((await ask(a.id)).statusCode).toBe(429);
    expect((await ask(b.id)).statusCode).toBe(503);
  });
});
