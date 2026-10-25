# Pluto

Aplicativo de financas pessoais: web responsivo (Next.js; celular, tablet e desktop) + API (Fastify) + MongoDB.
Especificacao completa em `Pluto_Documentacao_de_Software.pdf` (v1.0).

## Estrutura

```
apps/
  api/                 Fastify + TypeScript (monolito modular)
  web/                 Next.js (App Router), responsivo
packages/
  shared/              tipos, schemas Zod, constantes
  finance-engine/      funcoes financeiras puras (VP, taxa implicita, score...)
infra/                 docker-compose do MongoDB
```

## Requisitos

- Node.js 22+ e pnpm 9 (`npm i -g pnpm@9`)
- MongoDB: Atlas (em uso) ou local/Docker (`pnpm db:up`)
- Conta no Pluggy (Client ID/Secret) e bancos conectados no Meu Pluggy
- App autenticador no celular (Google Authenticator, Microsoft Authenticator, 1Password...)

## Primeira configuracao

```bash
pnpm install

# 1. API: segredos e banco
cp apps/api/.env.example apps/api/.env
node apps/api/scripts/gen-secrets.mjs      # cole a saida no apps/api/.env
#    preencha MONGODB_URI (.../pluto?...), PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET
pnpm --filter @pluto/api db:setup          # colecoes, validadores e indices

# 2. Seu usuario (senha + autenticador por QR code + codigos de recuperacao)
pnpm --filter @pluto/api user:create

# 3. Conferir o Pluggy (opcional, nao grava nada)
pnpm --filter @pluto/api pluggy:check <itemId>

# 4. Rodar
pnpm dev                                   # API em 127.0.0.1:3333, site em http://localhost:3000
```

Depois de entrar no site, va em **Configuracoes > Importar do Meu Pluggy** e cole o Item ID.
O site chama `/v1` na propria origem e o Next repassa para a API, entao use `http://localhost:3000`
(e nao `127.0.0.1:3000`), que e a origem liberada em `ALLOWED_ORIGINS`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | API + web em modo desenvolvimento |
| `pnpm test` / `pnpm test:coverage` | Vitest (motor financeiro exige 90% de cobertura) |
| `pnpm typecheck` / `pnpm lint` | TypeScript strict e ESLint |
| `pnpm build` | Build de todos os pacotes |
| `pnpm --filter @pluto/api db:indexes` | Cria os indices da secao 4.4 |
