# Pluto Mobile (Expo)

App iOS/Android do Pluto em React Native + Expo (SDK 58). Consome a mesma API do site
(`/v1`); nao calcula limite, meta ou veredito: tudo vem do backend.

## Rodar no celular (Expo Go)

```bash
cp apps/mobile/.env.example apps/mobile/.env   # EXPO_PUBLIC_API_URL
pnpm install
pnpm --filter @pluto/mobile start               # escaneie o QR com o app Expo Go
```

Pacotes com codigo nativo: sempre `npx expo install <pacote>` dentro de `apps/mobile` (escolhe a
versao compativel com o SDK). Antes de cada build: `pnpm --filter @pluto/mobile doctor`.

## Sessao

- O app manda `x-pluto-client: mobile`: o login (`/v1/auth/login` -> `/v1/auth/2fa/verify`) e o
  `/v1/auth/refresh` devolvem os tokens no corpo, em vez de cookie.
- Access token so em memoria; refresh token (rotativo) so no Keychain/Keystore via
  `expo-secure-store`, acessivel apenas com o aparelho desbloqueado e fora de backups.
- `src/api/client.ts` nao depende do Expo e e testado no Vitest (`pnpm test`).

## Estrutura

```text
src/
  app/          rotas (Expo Router): cada arquivo e uma tela
  api/          cliente da API (client.ts), SecureStore (secure-store.ts), instancia (index.ts)
  lib/          formatacao (moeda, CPF)
```
