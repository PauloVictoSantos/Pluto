# Pluto

Aplicativo de financas pessoais: web (Next.js) + iOS/Android (Capacitor) + API (Fastify) + MongoDB.
Especificacao completa em `Pluto_Documentacao_de_Software.pdf` (v1.0).

## Estrutura

```
apps/
  api/                 Fastify + TypeScript (monolito modular)
  web/                 Next.js (App Router) + Capacitor
packages/
  shared/              tipos, schemas Zod, constantes
  finance-engine/      funcoes financeiras puras (VP, taxa implicita, score...)
infra/                 docker-compose do MongoDB
```

## Requisitos

- Node.js 22+ e pnpm 9 (`npm i -g pnpm@9`)
- MongoDB 8 (via Docker com `pnpm db:up`, ou instalado localmente)
- Mobile: Android Studio (Android) / Mac com Xcode (iOS)

## Primeira configuracao

```bash
pnpm install

# 1. Banco
cp infra/.env.example infra/.env          # troque as senhas
pnpm db:up

# 2. API
cp apps/api/.env.example apps/api/.env
node apps/api/scripts/gen-secrets.mjs     # cole a saida no apps/api/.env
#    ajuste MONGODB_URI com a senha de PLUTO_APP_PASSWORD

# 3. Web
cp apps/web/.env.example apps/web/.env.local

pnpm dev                                   # API em :3333, web em :3000
```

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | API + web em modo desenvolvimento |
| `pnpm test` / `pnpm test:coverage` | Vitest (motor financeiro exige 90% de cobertura) |
| `pnpm typecheck` / `pnpm lint` | TypeScript strict e ESLint |
| `pnpm build` | Build de todos os pacotes |
| `pnpm build:mobile` | Export estatico do Next + `cap sync` |
| `pnpm --filter @pluto/api db:indexes` | Cria os indices da secao 4.4 |

## Mobile (secao 8)

```bash
cd apps/web
npx cap add android     # uma vez
npx cap add ios         # uma vez, somente no Mac
pnpm build:mobile
pnpm cap:android        # ou pnpm cap:ios
```
