import { createApi } from './client';
import { secureTokenStore } from './secure-store';

export { ApiError } from './client';

/** URL publica da API (EXPO_PUBLIC_API_URL, sem /v1). So https em build de verdade. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://pluto-sfou.onrender.com').replace(/\/+$/, '');

export const api = createApi({ baseUrl: `${API_URL}/v1`, store: secureTokenStore });
