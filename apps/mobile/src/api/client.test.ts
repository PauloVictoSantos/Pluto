import { beforeEach, describe, expect, it } from 'vitest';
import { brl, maskCpf } from '../lib/format';
import { ApiError, createApi, type TokenStore } from './client';

// Cliente do app: cabecalho de cliente mobile, Bearer, renovacao unica com refresh rotativo,
// sessao perdida, erros da API e de rede. fetch e armazenamento falsos.

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}
let calls: Call[];
let refreshStored: string | null;
let routes: Record<string, (c: Call) => { status: number; body?: unknown }>;
const store: TokenStore = {
  getRefresh: async () => refreshStored,
  setRefresh: async (t) => void (refreshStored = t),
  clear: async () => void (refreshStored = null),
};
const fetchFn: typeof fetch = async (input, init) => {
  const c: Call = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined };
  calls.push(c);
  const route = routes[`${c.method} ${c.url.replace('https://api.test/v1', '')}`];
  if (!route) throw new TypeError('Network request failed');
  const r = route(c);
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
const api = () => createApi({ baseUrl: 'https://api.test/v1', store, fetchFn });
const unauthorized = { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Sessão expirada' } } };

beforeEach(() => {
  calls = [];
  refreshStored = null;
  routes = {};
});

describe('cliente da API do app', () => {
  it('envia o cabecalho de cliente mobile e guarda o refresh no aparelho', async () => {
    routes['POST /auth/2fa/verify'] = () => ({ status: 200, body: { accessToken: 'a1', expiresIn: 900, refreshToken: 'r1' } });
    routes['GET /me'] = (c) => ({ status: c.headers.get('authorization') === 'Bearer a1' ? 200 : 401, body: { ok: true } });
    const a = api();
    await a.setTokens(await a.request('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ mfaToken: 'x', code: '123456' }) }));
    expect(refreshStored).toBe('r1');
    expect(await a.request('/me')).toEqual({ ok: true });
    expect(calls.every((c) => c.headers.get('x-pluto-client') === 'mobile')).toBe(true);
    expect(calls[0]!.headers.get('content-type')).toBe('application/json');
  });

  it('app reaberto: renova antes da primeira chamada; refresh rotativo substitui o guardado', async () => {
    refreshStored = 'r-old';
    routes['POST /auth/refresh'] = (c) => ({ status: (c.body as { refreshToken: string }).refreshToken === 'r-old' ? 200 : 401, body: { accessToken: 'a2', expiresIn: 900, refreshToken: 'r-new' } });
    routes['GET /health'] = () => ({ status: 200, body: { ok: true, db: 'up', version: '1' } });
    routes['GET /me'] = (c) => ({ status: c.headers.get('authorization') === 'Bearer a2' ? 200 : 401, body: { id: 'u' } });
    const a = api();
    expect(await a.request('/me')).toEqual({ id: 'u' });
    expect(refreshStored).toBe('r-new');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST https://api.test/v1/auth/refresh', 'GET https://api.test/v1/me']);
  });

  it('access vencido: varias chamadas juntas fazem uma renovacao so e repetem', async () => {
    refreshStored = 'r1';
    let n = 0;
    routes['POST /auth/refresh'] = () => ({ status: 200, body: { accessToken: `a${++n}`, expiresIn: 900, refreshToken: `r${n + 1}` } });
    const a = api();
    await a.refresh(); // sessao com a1
    // a1 venceu no servidor: so a2 em diante vale.
    routes['GET /x'] = (c) => (c.headers.get('authorization') === 'Bearer a1' ? unauthorized : { status: 200, body: { v: 1 } });
    expect(await Promise.all([a.request('/x'), a.request('/x'), a.request('/x')])).toEqual([{ v: 1 }, { v: 1 }, { v: 1 }]);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(2);
    expect(refreshStored).toBe('r3');
  });

  it('refresh recusado: apaga a sessao do aparelho e avisa o app', async () => {
    refreshStored = 'r-revogado';
    routes['POST /auth/refresh'] = () => unauthorized;
    const a = api();
    let lost = 0;
    a.setOnSessionLost(() => lost++);
    routes['GET /me'] = () => unauthorized;
    const e = await a.request('/me').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe('SESSION_LOST');
    expect(refreshStored).toBeNull();
    expect(lost).toBe(1);
  });

  it('erros: mensagem da API, falha de rede sem derrubar a sessao, logout mesmo offline', async () => {
    refreshStored = 'r1';
    routes['POST /auth/refresh'] = () => ({ status: 200, body: { accessToken: 'a1', expiresIn: 900, refreshToken: 'r1' } });
    routes['POST /agent/fixed-expenses'] = () => ({ status: 400, body: { error: { code: 'VALIDATION', message: 'Dê um nome ao gasto' } } });
    const a = api();
    const e = (await a.request('/agent/fixed-expenses', { method: 'POST', body: '{}' }).catch((x: unknown) => x)) as ApiError;
    expect([e.status, e.code, e.message]).toEqual([400, 'VALIDATION', 'Dê um nome ao gasto']);
    const net = (await a.request('/sem-rota').catch((x: unknown) => x)) as ApiError;
    expect(net.code).toBe('NETWORK');
    expect(refreshStored).toBe('r1');
    await a.logout();
    expect(refreshStored).toBeNull();
    expect(await a.hasSession()).toBe(false);
  });

  it('formatacao', () => {
    expect(maskCpf('12345678909')).toBe('123.456.789-09');
    expect(maskCpf('1234')).toBe('123.4');
    expect(brl(123456)).toMatch(/^R\$\s1\.234,56$/);
  });
});
