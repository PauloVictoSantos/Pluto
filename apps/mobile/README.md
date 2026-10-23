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

## Telas e visual

O app reproduz o site no celular (fase "paridade com o site"):

- Mesmo visual: tokens de cor de `apps/web/app/globals.css` (claro e escuro), fonte Geist,
  icones com os mesmos tracos (`@pluto/shared`, `design/icons.ts`), marcas do Pluto.
- Mesma navegacao do site no celular: cabecalho (ocultar valores, tema, notificacoes, conta),
  barra de baixo (Inicio, Extrato, Boleto, Cartoes, Mais), grade do "Mais" e o Plutao no botao
  flutuante (chat em tela cheia, com autorizacao de IA e Sim/Nao para gravar).
- Dados com TanStack Query, mesmas chaves do site; so depois do desbloqueio; nada salvo no
  aparelho. Ocultar valores troca todo dinheiro por "R$ ••••".

Andamento das paginas: Visao geral (provisoria), Gastos fixos e Metas ja no app; as demais
mostram "Chegando no app" ate a etapa em que forem convertidas (B: Visao geral completa;
C: Transacoes e Cartoes; D: Contas, Orcamento, Fixos e Metas completos; E: o restante).

## Build Android (EAS)

Projeto no EAS: `@br.pessoal.pluto/pluto-mobile` (id no `app.json`). Os comandos rodam dentro de
`apps/mobile`. O `eas.json` ja leva a URL publica da API (o `.env` nao vai para a nuvem) e desliga o
download do MongoDB de testes da API. O `.easignore` da raiz define o que NAO sobe para o EAS
(segredos, node_modules, pastas do editor/agente).

```bash
cd apps/mobile
pnpm build:android        # APK de teste (perfil preview); o link sai no terminal e em expo.dev
```

Instalar no celular:

1. Abra o link do build (ou o QR code) no Android e baixe o APK.
2. Permita "instalar apps desconhecidos" para o navegador quando o Android pedir.
3. Instale. Os proximos APKs instalam por cima, mantendo o login.

Keystore: o EAS gerou e guarda a chave de assinatura na conta. Sem ela nao da para atualizar o
app instalado. Faca um backup (fora do projeto e fora do Git):

```bash
npx eas-cli@latest credentials -p android   # Android > preview > Keystore > Download credentials
```

Antes de cada build: `pnpm doctor`.

## Estrutura

```text
src/
  app/          rotas (Expo Router): cada arquivo e uma tela
  api/          cliente da API (client.ts), SecureStore (secure-store.ts), instancia (index.ts)
  auth/         login em dois passos e regras de bloqueio (flow.ts), sessao (session.tsx)
  components/   casco (shell/), kit visual (ui.tsx, T.tsx, Icon.tsx, brand.tsx), bloqueio e privacidade
  lib/          formatacao (moeda, CPF), tema e preferencias (theme.tsx), dados (use-api.ts), navegacao (nav.ts)
```
