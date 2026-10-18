import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A criptografia do WebAuthn e da biblioteca (testada por ela); aqui se testa o fluxo ao redor:
// desafio de uso unico, dono da credencial, autenticacao recente, bloqueio, contador e sessao.
const lib = vi.hoisted(() => ({
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async (o: { rpID: string }) => ({ challenge: `reg-${Math.random()}`, rp: { id: o.rpID, name: 'Pluto' } })),
  generateAuthenticationOptions: vi.fn(async (o: { rpID: string }) => ({ challenge: `login-${Math.random()}`, rpId: o.rpID })),
  ...lib,
}));

const { startHarness } = await import('../../test/harness');
type Harness = Awaited<ReturnType<typeof startHarness>>;
type User = Awaited<ReturnType<Harness['createUser']>>;

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());
beforeEach(async () => {
  await h.reset();
  lib.verifyRegistrationResponse.mockImplementation(async () => ({
    verified: true,
    registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'singleDevice' },
  }));
  lib.verifyAuthenticationResponse.mockImplementation(async () => ({ verified: true, authenticationInfo: { newCounter: 7 } }));
});

const ORIGIN = 'http://localhost:3000';
const fakeResponse = (id = 'cred-1') => ({ id, rawId: id, type: 'public-key', response: { clientDataJSON: 'x' } });
const auth = async (u: User, authAgeSec = 0) => ({ authorization: `Bearer ${await h.token(u.id, { authAgeSec })}` });
const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload?: object) =>
  h.app.inject({ method, url, headers: { origin: ORIGIN, ...headers }, payload });

async function register(u: User) {
  const opts = (await req('POST', '/v1/auth/passkeys/register/options', await auth(u))).json();
  return req('POST', '/v1/auth/passkeys/register/verify', await auth(u), { challengeId: opts.challengeId, response: fakeResponse(), name: 'Meu celular' });
}

async function loginWithPasskey(id = 'cred-1') {
  const { challengeId } = (await req('POST', '/v1/auth/passkeys/login/options', {})).json();
  return req('POST', '/v1/auth/passkeys/login/verify', {}, { challengeId, response: fakeResponse(id), remember: true });
}

describe('passkeys', () => {
  it('cadastrar exige autenticacao recente', async () => {
    const u = await h.createUser();
    const res = await req('POST', '/v1/auth/passkeys/register/options', await auth(u, 3600));
    expect(res.json().error.code).toBe('REAUTH_REQUIRED');
  });

  it('cadastra com biometria obrigatoria no dominio do site e lista', async () => {
    const u = await h.createUser();
    const res = await register(u);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Meu celular', lastUsedAt: null });
    expect(lib.verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRPID: 'localhost', expectedOrigin: [ORIGIN], requireUserVerification: true }),
    );
    const list = (await req('GET', '/v1/auth/passkeys', await auth(u))).json();
    expect(list).toHaveLength(1);
  });

  it('entra com a passkey: sessao criada, contador salvo, desafio nao serve duas vezes', async () => {
    const u = await h.createUser();
    await register(u);
    const { challengeId } = (await req('POST', '/v1/auth/passkeys/login/options', {})).json();
    const res = await req('POST', '/v1/auth/passkeys/login/verify', {}, { challengeId, response: fakeResponse(), remember: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();
    expect(res.cookies.find((c) => c.name === '__Host-pluto_rt')).toBeTruthy();
    expect(lib.verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({ requireUserVerification: true }));
    expect((await h.ctx.col.passkeys.findOne({ userId: u.id }))!.counter).toBe(7);

    const again = await req('POST', '/v1/auth/passkeys/login/verify', {}, { challengeId, response: fakeResponse(), remember: true });
    expect(again.json().error.code).toBe('CHALLENGE_EXPIRED');
  });

  it('recusa credencial desconhecida, assinatura invalida, origem estranha e conta bloqueada', async () => {
    const u = await h.createUser();
    await register(u);
    expect((await loginWithPasskey('cred-de-outro')).json().error.code).toBe('PASSKEY_FAILED');

    lib.verifyAuthenticationResponse.mockImplementationOnce(async () => ({ verified: false }));
    expect((await loginWithPasskey()).json().error.code).toBe('PASSKEY_FAILED');

    const { challengeId } = (await req('POST', '/v1/auth/passkeys/login/options', {})).json();
    const evil = await h.app.inject({ method: 'POST', url: '/v1/auth/passkeys/login/verify', headers: { origin: 'https://evil.example' }, payload: { challengeId, response: fakeResponse(), remember: true } });
    expect(evil.json().error.code).toBe('BAD_ORIGIN');

    await h.ctx.col.users.updateOne({ _id: u.id }, { $set: { lockedUntil: new Date(Date.now() + 60_000) } });
    expect((await loginWithPasskey()).json().error.code).toBe('ACCOUNT_LOCKED');
  });

  it('remover exige autenticacao recente e so o dono remove', async () => {
    const [a, b] = [await h.createUser({ email: 'a@pluto.test' }), await h.createUser({ email: 'b@pluto.test' })];
    const { id } = (await register(a)).json();
    expect((await req('DELETE', `/v1/auth/passkeys/${id}`, await auth(a, 3600))).json().error.code).toBe('REAUTH_REQUIRED');
    expect((await req('DELETE', `/v1/auth/passkeys/${id}`, await auth(b))).statusCode).toBe(404);
    expect((await req('DELETE', `/v1/auth/passkeys/${id}`, await auth(a))).statusCode).toBe(204);
    expect(await h.ctx.col.passkeys.countDocuments({})).toBe(0);
  });
});

describe('CPF no perfil', () => {
  it('trocar o CPF exige autenticacao recente e nao pode repetir o de outra conta', async () => {
    const [a, b] = [await h.createUser({ email: 'a@pluto.test' }), await h.createUser({ email: 'b@pluto.test' })];
    const patch = async (u: User, cpf: string, age = 0) => req('PATCH', '/v1/me', await auth(u, age), { cpf });
    expect((await patch(a, '529.982.247-25', 3600)).json().error.code).toBe('REAUTH_REQUIRED');
    expect((await patch(a, b.cpf)).json().error.code).toBe('CPF_IN_USE');
    const ok = await patch(a, '529.982.247-25');
    expect(ok.json().cpfMasked).toBe('***.982.247-**');
    const login = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { cpf: '52998224725', password: a.password } });
    expect(login.json().mfaRequired).toBe(true);
  });
});
