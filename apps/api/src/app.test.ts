import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { buildApp as build } from './app';
import { loadEnv, type Env } from './config/env';
import { collections } from './db/collections';
import { createFieldCrypto } from './lib/crypto';
import { AppError } from './lib/errors';

// Sem banco: o cliente nunca conecta porque nenhuma rota daqui consulta colecoes.
const buildApp = ({ env, pingDb }: { env: Env; pingDb: () => Promise<boolean> }) =>
  build({
    env,
    pingDb,
    col: collections(new MongoClient('mongodb://127.0.0.1:1').db('x')),
    crypto: createFieldCrypto(env.FIELD_ENCRYPTION_KEY),
    jwt: null,
    pluggy: null,
  });

const baseEnv = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/pluto_test',
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  ALLOWED_ORIGINS: 'http://localhost:3000',
};

describe('env', () => {
  it('aceita configuracao minima de desenvolvimento', () => {
    expect(() => loadEnv(baseEnv)).not.toThrow();
  });

  it('recusa CORS com curinga', () => {
    expect(() => loadEnv({ ...baseEnv, ALLOWED_ORIGINS: '*' })).toThrow(/ALLOWED_ORIGINS/);
  });

  it('recusa escutar em todas as interfaces', () => {
    expect(() => loadEnv({ ...baseEnv, HOST: '0.0.0.0' })).toThrow(/HOST/);
  });

  it('exige segredos e Mongo autenticado em production', () => {
    expect(() => loadEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrow(/JWT_PRIVATE_KEY/);
  });
});

describe('app', () => {
  const env = loadEnv(baseEnv);

  it('GET /v1/health/live responde sem tocar no banco', async () => {
    const app = await buildApp({
      env,
      pingDb: async () => {
        throw new Error('banco nao deveria ser consultado');
      },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /v1/health reporta o banco', async () => {
    const app = await buildApp({ env, pingDb: async () => false });
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'down' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('CORS: origem permitida recebe cabecalho; desconhecida nao (e nao vira erro 500)', async () => {
    const app = await buildApp({ env, pingDb: async () => true });
    const ok = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin: 'http://localhost:3000' } });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const bad = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin: 'https://evil.example' } });
    expect(bad.statusCode).toBe(200);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('erro de negocio 5xx mantem a mensagem; erro inesperado vira "Erro interno"', async () => {
    const app = await buildApp({ env, pingDb: async () => true });
    // Sem Pluggy configurado, mas com rota que exige token: 401 vem antes. Testa direto o handler.
    app.get('/x/app-error', async () => {
      throw new AppError(503, 'PLUGGY_NOT_CONFIGURED', 'Integração com o Pluggy não configurada');
    });
    app.get('/x/crash', async () => {
      throw new Error('detalhe interno com dado sensível');
    });
    expect((await app.inject({ method: 'GET', url: '/x/app-error' })).json()).toEqual({
      error: { code: 'PLUGGY_NOT_CONFIGURED', message: 'Integração com o Pluggy não configurada' },
    });
    const crash = await app.inject({ method: 'GET', url: '/x/crash' });
    expect(crash.statusCode).toBe(500);
    expect(crash.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    await app.close();
  });

  it('404 no formato padrao de erro', async () => {
    const app = await buildApp({ env, pingDb: async () => true });
    const res = await app.inject({ method: 'GET', url: '/v1/nao-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Rota nao encontrada' } });
    await app.close();
  });
});
