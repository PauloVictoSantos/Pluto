import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, createApi, type TokenStore } from '../api/client';
import { LOCK_AFTER_MS, createLoginFlow, needsBiometric, shouldLock } from './flow';

// Login em dois fatores pelo app e regras de bloqueio.

let refresh: string | null;
let bodies: Record<string, unknown>[];
const store: TokenStore = { getRefresh: async () => refresh, setRefresh: async (t) => void (refresh = t), clear: async () => void (refresh = null) };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchFn: typeof fetch = async (input, init) => {
  const path = String(input).replace('https://api.test/v1', '');
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  bodies.push({ path, ...body });
  if (path === '/auth/login') return body.password === 'certa' ? json(200, { mfaRequired: true, mfaToken: 'mfa-token-123' }) : json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'CPF ou senha inválidos' } });
  if (path === '/auth/2fa/verify')
    return body.code === '123456' ? json(200, { accessToken: 'a1', expiresIn: 900, refreshToken: 'r1' }) : json(401, { error: { code: 'INVALID_CODE', message: 'Código inválido' } });
  return json(404, {});
};

beforeEach(() => {
  refresh = null;
  bodies = [];
});

describe('login do app', () => {
  it('CPF so com digitos, senha, depois o codigo: guarda a sessao', async () => {
    const flow = createLoginFlow(createApi({ baseUrl: 'https://api.test/v1', store, fetchFn }));
    await flow.start('123.456.789-09', 'certa');
    expect(bodies[0]).toEqual({ path: '/auth/login', cpf: '12345678909', password: 'certa' });
    expect(flow.waitingCode).toBe(true);
    await flow.verify(' 123456 ');
    expect(bodies[1]).toEqual({ path: '/auth/2fa/verify', mfaToken: 'mfa-token-123', code: '123456', remember: true });
    expect(refresh).toBe('r1');
    expect(flow.waitingCode).toBe(false);
  });

  it('erros da API chegam com a mensagem; codigo sem desafio pede o login de novo', async () => {
    const flow = createLoginFlow(createApi({ baseUrl: 'https://api.test/v1', store, fetchFn }));
    await expect(flow.start('12345678909', 'errada')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'CPF ou senha inválidos' });
    await expect(flow.verify('123456')).rejects.toBeInstanceOf(ApiError);
    await flow.start('12345678909', 'certa');
    await expect(flow.verify('000000')).rejects.toMatchObject({ code: 'INVALID_CODE' });
    expect(refresh).toBeNull();
    flow.reset();
    expect(flow.waitingCode).toBe(false);
  });

  it('bloqueio: so depois de 1 minuto em segundo plano; biometria so se houver e estiver cadastrada', () => {
    expect(shouldLock(null, 10_000)).toBe(false);
    expect(shouldLock(0, LOCK_AFTER_MS - 1)).toBe(false);
    expect(shouldLock(0, LOCK_AFTER_MS)).toBe(true);
    expect(needsBiometric({ hasHardware: true, enrolled: true })).toBe(true);
    expect(needsBiometric({ hasHardware: true, enrolled: false })).toBe(false);
    expect(needsBiometric({ hasHardware: false, enrolled: false })).toBe(false);
  });
});
