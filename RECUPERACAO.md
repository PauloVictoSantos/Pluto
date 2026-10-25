# Plano de recuperação

O que fazer quando o Pluto cair ou perder dados. Responsável: o dono do projeto (quem tem acesso ao Render, ao Atlas e ao GitHub).

## Como ficar sabendo

| Aviso | Configuração |
|---|---|
| **Site fora do ar** | UptimeRobot (grátis): monitor HTTP(s) em `https://<seu-serviço>.onrender.com/v1/health` a cada 5 min, tipo *Keyword*, palavra `"ok"`. Alerta por e-mail ou app |
| **Erros inesperados** | Sentry: crie um projeto Node.js, copie o DSN para `SENTRY_DSN` no Render. Sem a variável, os erros ficam só nos logs do Render. O Sentry não recebe cabeçalhos, cookies, corpo das requisições nem dados do usuário |
| **Backup falhou** | O GitHub envia e-mail quando o workflow **Backup** falha |

## 1. Diagnóstico (5 min)

1. Abra `/v1/health`. `"db":"down"` aponta para o Atlas; sem resposta, para o Render.
2. Render → serviço → **Logs**: procure `erro interno` ou falha ao iniciar.
3. Atlas → **Clusters**: veja se há alerta ou manutenção.
4. Se foi logo depois de um deploy, vá direto para o passo 2.

## 2. Voltar a versão anterior

Render → serviço → **Events** → no deploy anterior que funcionava, **Rollback**. Leva cerca de 1 minuto e não mexe no banco.

As migrações de dados do Pluto são idempotentes e só acrescentam (não apagam campos). Por isso, voltar o código não exige desfazer migração. Se uma migração estragou dados, use o passo 3.

## 3. Restaurar o backup

Os backups são diários (05:00 em Manaus), cifrados com `BACKUP_PASSPHRASE` e ficam 30 dias em GitHub → **Actions → Backup** → execução → **Artifacts**. Cada execução já restaura o arquivo num banco temporário e confere as contagens. Como o repositório é público, outras contas do GitHub conseguem baixar o arquivo: ele só é seguro porque está cifrado. Guarde a frase num gerenciador de senhas e nunca no repositório.

1. Baixe o artefato do dia desejado e descompacte (`pluto-backup-AAAA-MM-DD.enc`).
2. Restaure num banco **novo**, nunca por cima do atual:
   ```bash
   cd apps/api
   MONGODB_URI="<uri com usuário dbAdmin>" MONGODB_DB=pluto_restore BACKUP_PASSPHRASE="<frase>" \
     pnpm restore -- caminho/pluto-backup-AAAA-MM-DD.enc
   ```
3. Confira no Atlas (Browse Collections) que os dados estão certos.
4. No Render, troque `MONGODB_DB` para `pluto_restore` e salve (o serviço reinicia).
5. Depois de estável, o banco antigo pode ser renomeado ou apagado.

O que foi gravado depois do backup se perde. As transações do Pluggy voltam na próxima sincronização.

**Teste manual (1x por mês):** rode os passos 1 a 3 com o backup mais recente. Restaurar no Atlas exige usuário com `dbAdmin` (ou um MongoDB local).

## 4. Vazamento de chave

| Chave | O que fazer |
|---|---|
| `JWT_PRIVATE_KEY` | Gere um par novo (`node apps/api/scripts/gen-secrets.mjs`). Todos são deslogados |
| Senha do Atlas | Atlas → Database Access → **Edit Password**; atualize `MONGODB_URI` no Render e no GitHub |
| `BACKUP_PASSPHRASE` | Gere outra, atualize no Render e no GitHub. Apague os artefatos antigos em Actions |
| Pluggy, Gemini, Stripe, Resend | Revogue no painel do serviço e cadastre a nova no Render |
| `FIELD_ENCRYPTION_KEY` | Não troque sem migrar: ela decifra os dados já salvos. Abra um chamado de manutenção antes |

## 5. Avisar os usuários

Se a falha durar mais de 30 min ou envolver dados, mande e-mail (Resend) ou mensagem para os usuários:

> O Pluto ficou fora do ar entre HH:MM e HH:MM de DD/MM. [Nenhum dado foi perdido / Os lançamentos manuais feitos entre X e Y precisam ser refeitos.] Já está normal. Se notar algo estranho, responda esta mensagem.

Em caso de vazamento de dados pessoais, a LGPD exige comunicar a ANPD e os titulares em prazo razoável.

## Configuração única

1. GitHub → repositório → **Settings → Secrets and variables → Actions**: crie `MONGODB_URI` (usuário só de leitura basta para o backup) e `BACKUP_PASSPHRASE` (a mesma do Render). Opcional: `MONGODB_DB`.
2. Rode **Actions → Backup → Run workflow** uma vez e confira o artefato.
3. UptimeRobot e Sentry, como na tabela do início.
