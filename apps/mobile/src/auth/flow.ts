import { MfaChallengeSchema, TokensSchema } from '@pluto/shared';
import { ApiError, type Api } from '../api/client';
import { onlyDigits } from '../lib/format';

// Login do app (guia mobile, secoes 5 e 7) sem nada de React Native: testavel no Vitest.
// O Pluto exige dois fatores: CPF + senha geram um desafio; o codigo do autenticador fecha o login.

/** Volta do segundo plano depois disto: pede biometria de novo. */
export const LOCK_AFTER_MS = 60_000;

export const shouldLock = (backgroundAt: number | null, now: number) => backgroundAt !== null && now - backgroundAt >= LOCK_AFTER_MS;

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export function createLoginFlow(api: Api) {
  let mfaToken: string | null = null;
  return {
    /** Passo 1: CPF (so digitos) e senha. O CPF nunca e guardado no aparelho. */
    async start(cpf: string, password: string) {
      const r = await api.request('/auth/login', post({ cpf: onlyDigits(cpf), password }), MfaChallengeSchema);
      mfaToken = r.mfaToken;
    },
    /** Passo 2: codigo do autenticador (ou de recuperacao). Guarda a sessao. */
    async verify(code: string) {
      if (!mfaToken) throw new ApiError(400, 'NO_CHALLENGE', 'Entre com CPF e senha de novo.');
      const t = await api.request('/auth/2fa/verify', post({ mfaToken, code: code.trim(), remember: true }), TokensSchema);
      await api.setTokens(t);
      mfaToken = null;
    },
    get waitingCode() {
      return mfaToken !== null;
    },
    reset() {
      mfaToken = null;
    },
  };
}

export type BiometricCheck = { hasHardware: boolean; enrolled: boolean };

/** Sem leitor ou sem digital/rosto cadastrado, o app segue com a sessao (guia, secao 7). */
export const needsBiometric = (b: BiometricCheck) => b.hasHardware && b.enrolled;
