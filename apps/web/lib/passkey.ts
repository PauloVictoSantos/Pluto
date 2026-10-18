'use client';

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { ApiRequestError, api } from './api';

// Biometria do aparelho via passkey (WebAuthn): o navegador pede a digital/rosto/PIN e assina o
// desafio da API com uma chave que nunca sai do aparelho.

export const passkeySupported = () => typeof window !== 'undefined' && browserSupportsWebAuthn();

/** O usuario fechou o pedido de biometria (nao e erro para mostrar). */
export const passkeyCancelled = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');

export async function loginWithPasskey(remember: boolean) {
  const { challengeId, options } = await api.passkeyLoginOptions();
  const response = await startAuthentication({ optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON });
  await api.passkeyLogin(challengeId, response, remember);
}

export async function registerPasskey(name?: string) {
  const { challengeId, options } = await api.passkeyRegisterOptions();
  let response;
  try {
    response = await startRegistration({ optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON });
  } catch (e) {
    // excludeCredentials: este aparelho ja tem uma passkey do Pluto.
    if (e instanceof Error && e.name === 'InvalidStateError') throw new ApiRequestError(409, 'PASSKEY_EXISTS', 'Este aparelho já tem a biometria cadastrada.');
    throw e;
  }
  return api.passkeyRegister(challengeId, response, name);
}
