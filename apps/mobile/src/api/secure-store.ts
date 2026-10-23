import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './client';

// Refresh token no Keychain (iOS) / Keystore (Android). "Este aparelho, desbloqueado": nao vai para
// backup nem para outro aparelho, e so e lido com o celular desbloqueado.
const KEY = 'pluto.refresh';
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const secureTokenStore: TokenStore = {
  getRefresh: () => SecureStore.getItemAsync(KEY, OPTS),
  setRefresh: (token) => SecureStore.setItemAsync(KEY, token, OPTS),
  clear: () => SecureStore.deleteItemAsync(KEY, OPTS),
};
