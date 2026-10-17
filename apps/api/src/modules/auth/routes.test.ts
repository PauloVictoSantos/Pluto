import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ITEM_ID, fakeAccount, fakeItem } from '../../integrations/pluggy/fixtures';
import { base32Decode, hotp, stepAt } from '../../lib/totp';
import { startHarness, type Harness } from '../../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

const ORIGIN = { origin: 'http://localhost:3000' };
type User = Awaited<ReturnType<Harness['createUser']>>;

const post = (url: string, payload?: object, headers: Record<string, string> = ORIGIN) => h.app.inject({ method: 'POST', url, payload, headers });
const cookieOf = (res: { cookies: { name: string; value: string; maxAge?: number }[] }) => res.cookies.find((c) => c.name === '__Host-pluto_rt');

async function loginWeb(u: User, remember = true) {
  const { mfaToken } = (await post('/v1/auth/login', { email: u.email, password: u.password })).json();
  const res = await post('/v1/auth/2fa/verify', { mfaToken, code: await u.code(), remember });
  return { res, accessToken: res.json().accessToken as string, refresh: cookieOf(res)!.value };
}

describe('login', () => {
  it('senha errada e e-mail inexistente dao a mesma resposta', async () => {
    const u = await h.createUser();
    const a = await post('/v1/auth/login', { email: u.email, password: 'errada' });
    const b = await post('/v1/auth/login', { email: 'ninguem@x.com', password: 'errada' });
    expect(a.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
    expect(a.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('e-mail e normalizado', async () => {
    const u = await h.createUser();
    const res = await post('/v1/auth/login', { email: '  DONO@Pluto.TEST ', password: u.password });
    expect(res.json().mfaRequired).toBe(true);
  });

  it('web: senha + TOTP geram access token e cookie HttpOnly Secure SameSite=Strict', async () => {
    const u = await h.createUser();
    const { res, accessToken } = await loginWeb(u);
    expect(res.statusCode).toBe(200);
    expect(res.json().refreshToken).toBeUndefined();
    const c = cookieOf(res)!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(c.maxAge).toBe(30 * 86_400);
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(me.json()).toMatchObject({ email: u.email, name: 'Marina Souza', settings: { timezone: 'America/Manaus' } });
  });

  it('sem "lembrar de mim" o cookie e de sessao', async () => {
    const u = await h.createUser();
    const { res } = await loginWeb(u, false);
    expect(cookieOf(res)!.maxAge).toBeUndefined();
  });

  it('mobile recebe o refresh no corpo e nao recebe cookie', async () => {
    const u = await h.createUser();
    const { mfaToken } = (await post('/v1/auth/login', { email: u.email, password: u.password }, {})).json();
    const res = await post('/v1/auth/2fa/verify', { mfaToken, code: await u.code() }, { 'x-pluto-client': 'mobile' });
    expect(res.json().refreshToken).toMatch(/^[\w-]{43}$/);
    expect(cookieOf(res)).toBeUndefined();
  });

  it('web exige Origin permitida (CSRF)', async () => {
    const u = await h.createUser();
    const { mfaToken } = (await post('/v1/auth/login', { email: u.email, password: u.password })).json();
    const res = await post('/v1/auth/2fa/verify', { mfaToken, code: await u.code() }, { origin: 'https://evil.example' });
    expect(res.json().error.code).toBe('BAD_ORIGIN');
  });

  it('o token de etapa MFA nao serve como access token', async () => {
    const u = await h.createUser();
    const { mfaToken } = (await post('/v1/auth/login', { email: u.email, password: u.password })).json();
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${mfaToken}` } })).statusCode).toBe(401);
  });
});

describe('segundo fator', () => {
  it('o mesmo codigo nao pode ser reutilizado', async () => {
    const u = await h.createUser();
    const code = await u.code();
    const t1 = (await post('/v1/auth/login', { email: u.email, password: u.password })).json().mfaToken;
    expect((await post('/v1/auth/2fa/verify', { mfaToken: t1, code })).statusCode).toBe(200);
    const t2 = (await post('/v1/auth/login', { email: u.email, password: u.password })).json().mfaToken;
    expect((await post('/v1/auth/2fa/verify', { mfaToken: t2, code })).json().error.code).toBe('INVALID_CODE');
  });

  it('codigo de recuperacao funciona uma unica vez', async () => {
    const u = await h.createUser();
    const rc = u.recoveryCodes[0]!.toUpperCase();
    const t1 = (await post('/v1/auth/login', { email: u.email, password: u.password })).json().mfaToken;
    expect((await post('/v1/auth/2fa/verify', { mfaToken: t1, code: rc })).statusCode).toBe(200);
    const t2 = (await post('/v1/auth/login', { email: u.email, password: u.password })).json().mfaToken;
    expect((await post('/v1/auth/2fa/verify', { mfaToken: t2, code: rc })).statusCode).toBe(401);
    expect(await h.ctx.col.auditLogs.countDocuments({ event: '2fa.recovery_code_used' })).toBe(1);
  });

  it('bloqueio progressivo apos 5 falhas', async () => {
    const u = await h.createUser();
    for (let i = 0; i < 5; i++) await post('/v1/auth/login', { email: u.email, password: 'errada' });
    const res = await post('/v1/auth/login', { email: u.email, password: u.password });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('sessao', () => {
  it('refresh rotaciona o token; reuso apos a janela revoga toda a familia', async () => {
    const u = await h.createUser();
    const { refresh: r1, accessToken: a1 } = await loginWeb(u);
    const cookie = (v: string) => ({ ...ORIGIN, cookie: `__Host-pluto_rt=${v}` });

    const res2 = await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: cookie(r1) });
    expect(res2.statusCode).toBe(200);
    const r2 = cookieOf(res2)!.value;
    expect(r2).not.toBe(r1);

    // Reuso imediato (duas abas): nao revoga.
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: cookie(r1) })).json().error.code).toBe('REFRESH_RACE');
    // Reuso depois da janela: tratado como roubo.
    await h.ctx.col.sessions.updateMany({ rotatedAt: { $ne: null } }, { $set: { rotatedAt: new Date(Date.now() - 60_000) } });
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: cookie(r1) })).json().error.code).toBe('INVALID_SESSION');
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: cookie(r2) })).statusCode).toBe(401);
    // O access token da familia revogada para de funcionar na hora.
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${a1}` } })).statusCode).toBe(401);
    expect(await h.ctx.col.auditLogs.countDocuments({ event: 'session.reuse_detected' })).toBe(1);
  });

  it('refresh com cookie exige Origin', async () => {
    const u = await h.createUser();
    const { refresh } = await loginWeb(u);
    const res = await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { cookie: `__Host-pluto_rt=${refresh}` } });
    expect(res.json().error.code).toBe('BAD_ORIGIN');
  });

  it('logout revoga a sessao e limpa o cookie', async () => {
    const u = await h.createUser();
    const { refresh, accessToken } = await loginWeb(u);
    const res = await h.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { ...ORIGIN, cookie: `__Host-pluto_rt=${refresh}` } });
    expect(res.statusCode).toBe(204);
    expect(cookieOf(res)!.value).toBe('');
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } })).statusCode).toBe(401);
  });
});

describe('reautenticacao e perfil', () => {
  it('reauth libera acao sensivel numa sessao antiga', async () => {
    const u = await h.createUser();
    const { accessToken } = await loginWeb(u);
    // Envelhece a sessao: simula login ha mais de 10 minutos.
    const oldAuth = await h.token(u.id, { authAgeSec: 3600 });
    h.pluggy.items.set(ITEM_ID, fakeItem({ clientUserId: 'meu-pluggy' }));
    h.pluggy.accounts.set(ITEM_ID, [fakeAccount()]);
    const imp = () => h.app.inject({ method: 'POST', url: '/v1/connections/import', headers: { authorization: `Bearer ${oldAuth}` }, payload: { itemId: ITEM_ID } });
    expect((await imp()).json().error.code).toBe('REAUTH_REQUIRED');

    const bad = await h.app.inject({ method: 'POST', url: '/v1/auth/reauth', headers: { authorization: `Bearer ${accessToken}` }, payload: { password: 'errada', code: '000000' } });
    expect(bad.statusCode).toBe(401);
    const ok = await h.app.inject({ method: 'POST', url: '/v1/auth/reauth', headers: { authorization: `Bearer ${accessToken}` }, payload: { password: u.password, code: await u.code() } });
    const fresh = ok.json().accessToken;
    const res = await h.app.inject({ method: 'POST', url: '/v1/connections/import', headers: { authorization: `Bearer ${fresh}` }, payload: { itemId: ITEM_ID } });
    expect(res.statusCode).toBe(201);
  });

  it('atualiza nome e telefone; trocar e-mail exige reautenticacao recente', async () => {
    const u = await h.createUser();
    const auth = { authorization: `Bearer ${await h.token(u.id)}` };
    const res = await h.app.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { name: 'Marina S.', phone: '(11) 90000-0000' } });
    expect(res.json()).toMatchObject({ name: 'Marina S.', phone: '(11) 90000-0000' });
    const old = { authorization: `Bearer ${await h.token(u.id, { authAgeSec: 3600 })}` };
    const email = await h.app.inject({ method: 'PATCH', url: '/v1/me', headers: old, payload: { email: 'novo@pluto.test' } });
    expect(email.json().error.code).toBe('REAUTH_REQUIRED');
  });
});

it('TOTP do helper corresponde ao segredo', async () => {
  const u = await h.createUser();
  expect(await u.code()).toBe(hotp(base32Decode(u.secret), stepAt(Date.now())));
});
