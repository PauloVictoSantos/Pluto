# Deploy no Render

Um único serviço web roda a API e o site juntos (`scripts/start-render.mjs`):

- a API escuta em `127.0.0.1:3333` dentro do servidor, invisível de fora;
- o site (`next start`) atende na porta do Render, atrás do HTTPS dele, e repassa `/v1` para a API.

O banco continua no MongoDB Atlas.

## 1. Antes de começar

1. **Publique o repositório no GitHub** (pode ser privado). Confira que nenhum `.env` vai junto: rode `git status` e veja que só aparece o `.env.example`.
2. **Atlas → Database Access:** crie um usuário só para produção, com a função **readWrite no banco `pluto`** (não `atlasAdmin`) e uma senha longa.
3. **Atlas → Network Access:** o Render não tem IP de saída fixo nos planos básicos. Adicione `0.0.0.0/0`. A proteção passa a ser o usuário e a senha do passo anterior.
4. Monte a `MONGODB_URI` de produção com esse usuário novo.

## 2. Criar o serviço

1. No Render: **New → Blueprint** → escolha o repositório. Ele lê o `render.yaml`.
2. Plano: `starter` (US$ 7/mês, sempre ligado). Para só testar, troque por `free` no `render.yaml`. O plano free dorme após 15 min sem uso e a sincronização automática para junto.
3. Preencha as variáveis marcadas como secretas:

| Variável | De onde vem |
|---|---|
| `ALLOWED_ORIGINS` | O endereço do serviço, ex.: `https://pluto.onrender.com` (sem barra no fim). Com domínio próprio, use ele |
| `MONGODB_URI` | A URI de produção do passo 1.4 |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | Os mesmos do `apps/api/.env`, ou novos com `node apps/api/scripts/gen-secrets.mjs` (chaves novas só deslogam as sessões) |
| `FIELD_ENCRYPTION_KEY` | **A mesma do `apps/api/.env`.** Ela decifra os Item IDs das conexões já salvas no Atlas. Se trocar, as conexões param de sincronizar |
| `BACKUP_PASSPHRASE` | Obrigatória em produção. Gere com `gen-secrets.mjs` e guarde num gerenciador de senhas |
| `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | Os mesmos do `.env` |
| `GEMINI_API_KEY` | A mesma do `.env` |

4. O deploy roda o build (`pnpm install` + `pnpm build`) e depois `node scripts/start-render.mjs`. O health check é `/v1/health`: ele passa pelo site e chega na API.

## 3. Depois do primeiro deploy

1. Abra `https://<seu-serviço>.onrender.com` e entre com o seu usuário de sempre. Os usuários ficam no Atlas, então não é preciso criar outro.
2. Domínio próprio (opcional): Render → Settings → Custom Domains. Depois **atualize `ALLOWED_ORIGINS`** para o domínio novo.
3. Confira que a sincronização roda: em Configurações, o "última sincronização" das conexões deve atualizar a cada 6 h.

## Observações

- **Login atrás do proxy:** a API confia só no salto local (`trustProxy: 'loopback'`) e usa o IP que o proxy do Render acrescenta ao `X-Forwarded-For`. Com isso o limite de tentativas de login é por visitante. Para conferir, veja nos logs do Render se `remoteAddress` é o seu IP real e não `127.0.0.1`.
- **Endereço da API gravado no build:** o destino do rewrite `/v1` fica no build do Next (`API_PROXY_TARGET`, padrão `http://127.0.0.1:3333`). Não defina essa variável no Render.
- **Logs:** a API registra cada requisição, sem tokens nem cookies. Erros do provedor (Pluggy/Gemini) aparecem sem dados financeiros.
- **Memória:** site + API cabem nos 512 MB do starter. Se o Render acusar falta de memória, suba para o plano standard.
