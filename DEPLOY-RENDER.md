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

## Boletos (Stripe)

1. No Stripe, crie uma **chave restrita** com **PaymentIntents: Write** e **PaymentMethods: Write**, e todo o resto em **None**. Coloque em `STRIPE_SECRET_KEY`. Comece com a de teste (`rk_test_...`). A chave `live` só é aceita com `NODE_ENV=production`.
2. Em **Developers → Webhooks → Add endpoint**, use `https://<seu-serviço>.onrender.com/v1/webhooks/stripe` com os eventos `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled` e `payment_intent.processing`. Copie o **Signing secret** (`whsec_...`) para `STRIPE_WEBHOOK_SECRET`.
3. Sem webhook (ex.: no computador), a situação dos boletos é atualizada pelo botão de atualizar na tela de boleto e pelo job a cada 6 h.

## E-mail dos boletos (Resend)

1. No Resend, crie uma API key com permissão **Sending access** e coloque em `RESEND_API_KEY`.
2. Em **Domains**, verifique um domínio seu (o Resend mostra os registros DNS que você precisa criar). Depois defina `EMAIL_FROM`, por exemplo `Pluto <cobranca@seudominio.com.br>`.
3. Sem domínio verificado, o Resend só envia do endereço de testes (`onboarding@resend.dev`) e **só para o e-mail da sua própria conta Resend**. Isso serve para testar, mas não para mandar boletos a outras pessoas.
4. O pagador recebe e-mail quando você toca em **Enviar e-mail** no boleto, e automaticamente quando um boleto já emitido é cancelado. As respostas ao e-mail vão para o seu e-mail de contato do Pluto.

## Erros comuns

- **`Cannot read properties of null (reading 'useContext')` no `/_global-error` durante o build:** o `NODE_ENV` do serviço não é `production`. Isso costuma acontecer quando se copia o `.env` local, que tem `NODE_ENV=development`.
- **Não copie `HOST` nem `PORT` do `.env` local.** O Render define a porta do site, e o script de inicialização define a da API (3333). Com `PORT=3333` no painel, os dois disputariam a mesma porta.
- **`bad auth : Authentication failed`:** usuário ou senha errados na `MONGODB_URI`. Senhas com `@ : / ? # [ ] %` precisam ser codificadas; prefira senhas só com letras e números.
- **Banco usado:** a API usa sempre o banco `pluto` (variável `MONGODB_DB`, padrão `pluto`), mesmo que a URI não tenha `/pluto`. Antes dessa correção, uma URI sem o nome caía no banco `test`.
- **Usuário do banco só com `readWrite`:** as migrações da inicialização funcionam sem permissão de admin. O `pnpm --filter @pluto/api db:setup`, que atualiza os validadores, exige um usuário com `dbAdmin`.
- **`ALLOWED_ORIGINS` deve ser o endereço público** (`https://...onrender.com`), não `localhost`. Caso contrário o login responde "origem não permitida".

## Observações

- **Login atrás do proxy:** a API confia só no salto local (`trustProxy: 'loopback'`) e usa o IP que o proxy do Render acrescenta ao `X-Forwarded-For`. Com isso o limite de tentativas de login é por visitante. Para conferir, veja nos logs do Render se `remoteAddress` é o seu IP real e não `127.0.0.1`.
- **Endereço da API gravado no build:** o destino do rewrite `/v1` fica no build do Next (`API_PROXY_TARGET`, padrão `http://127.0.0.1:3333`). Não defina essa variável no Render.
- **Logs:** a API registra cada requisição, sem tokens nem cookies. Erros do provedor (Pluggy/Gemini) aparecem sem dados financeiros.
- **Memória:** site + API cabem nos 512 MB do starter. Se o Render acusar falta de memória, suba para o plano standard.
