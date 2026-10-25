import { beforeEach, describe, expect, it, vi } from 'vitest';

// A API e simulada: o teste so olha o que o cliente guarda entre sessoes.
vi.mock('./api', () => ({
  api: {
    logout: vi.fn(async () => {}),
    me: vi.fn(async () => ({ id: 'b', name: 'Bia Teste', email: 'b@pluto.test', phone: null, settings: { timezone: 'America/Manaus' } })),
  },
  refreshSession: vi.fn(async () => false),
  setOnSessionLost: vi.fn(),
  setOnConnecting: vi.fn(),
  ApiRequestError: class extends Error {},
  OFFLINE: 'NETWORK',
}));

const { queryClient } = await import('./query-client');
const store = await import('./store');
const { setOnSessionLost } = await import('./api');
// O store registra o handler ao ser importado; guardado antes de qualquer limpeza de mocks.
const onSessionLost = vi.mocked(setOnSessionLost).mock.calls[0]![0];

const seedAccountA = () => {
  queryClient.setQueryData(['dashboard', 'summary'], { balanceMinor: 123_456, owner: 'A' });
  queryClient.setQueryData(['connections'], [{ id: 'conn-a' }]);
};

describe('cache de dados entre contas', () => {
  beforeEach(() => queryClient.clear());

  it('logout apaga os dados da conta anterior', async () => {
    seedAccountA();
    await store.logout();
    expect(queryClient.getQueryData(['dashboard', 'summary'])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('sessao perdida (refresh falhou) tambem apaga', () => {
    seedAccountA();
    onSessionLost();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('entrar com outra conta comeca com cache vazio', async () => {
    seedAccountA();
    await store.completeLogin();
    expect(queryClient.getQueryData(['connections'])).toBeUndefined();
  });
});
