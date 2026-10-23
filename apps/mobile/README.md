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

## Login e seguranca

- Dois passos, como no site: CPF + senha (`/v1/auth/login`) e o codigo do autenticador
  (`/v1/auth/2fa/verify`). O CPF nunca fica salvo no aparelho; so o refresh token.
- Biometria ao abrir e ao voltar depois de 1 minuto em segundo plano (`expo-local-authentication`).
  Sem leitor ou sem digital/rosto cadastrado, o app abre direto. Face ID nao funciona no Expo Go:
  teste num build (etapa 5).
- Fora do app: desfoque no seletor de apps do iOS; no Android, FLAG_SECURE (preview em branco nos
  recentes, sem print nem gravacao de tela, como apps de banco); capa roxa enquanto inativo.
- `src/auth/flow.ts` (login e regras de bloqueio) e testado no Vitest.

## Estrutura

```text
src/
  app/          rotas (Expo Router): cada arquivo e uma tela
  api/          cliente da API (client.ts), SecureStore (secure-store.ts), instancia (index.ts)
  auth/         login em dois passos e regras de bloqueio (flow.ts), sessao (session.tsx)
  components/   tela de bloqueio e capa de privacidade
  lib/          formatacao (moeda, CPF)
```
