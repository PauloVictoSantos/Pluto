import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadEnv } from './config/env';

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

  it('GET /v1/health reporta o banco', async () => {
    const app = await buildApp({ env, pingDb: async () => false });
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'down' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
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
