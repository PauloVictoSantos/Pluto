// Cria (ou redefine) o usuario do Pluto. Uso: pnpm --filter @pluto/api user:create
// Interativo: senha digitada sem eco (aparece •), autenticador configurado por QR code,
// codigos de recuperacao mostrados uma unica vez. Nada sensivel e gravado em claro.
import QRCode from 'qrcode';
import { CpfSchema, EmailSchema } from '@pluto/shared';
import { loadEnv } from '../src/config/env';
import { connectDatabase } from '../src/db/client';
import { collections } from '../src/db/collections';
import { ensureIndexes } from '../src/db/indexes';
import { cpfHash } from '../src/modules/auth/service';
import { buildUser } from '../src/modules/auth/users';
import { createFieldCrypto } from '../src/lib/crypto';
import { passwordProblems, pwnedCount } from '../src/lib/password';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../src/lib/totp';
import { ask } from './prompt';

const env = loadEnv();
const database = await connectDatabase(env.MONGODB_URI, env.MONGODB_DB);
const col = collections(database.db);
const crypto = createFieldCrypto(env.FIELD_ENCRYPTION_KEY);

try {
  await ensureIndexes(database.db);
  console.log('\n🐱 Pluto · criar usuário\n');

  const name = (await ask('Seu nome: ')) || 'Proprietário';
  let cpf = '';
  for (;;) {
    const r = CpfSchema.safeParse(await ask('CPF (é o seu login): '));
    if (r.success) {
      cpf = r.data;
      break;
    }
    console.log('  CPF inválido.');
  }
  let email = '';
  for (;;) {
    const r = EmailSchema.safeParse(await ask('E-mail de contato: '));
    if (r.success) {
      email = r.data;
      break;
    }
    console.log('  E-mail inválido.');
  }

  // Usuario ja existente: pelo CPF ou, se ainda nao tinha CPF, pelo e-mail.
  const existing = (await col.users.findOne({ cpfHash: cpfHash(crypto, cpf) })) ?? (await col.users.findOne({ email }));
  if (existing) {
    const ok = (await ask('Este usuário já existe. Redefinir senha e autenticador? (s/N) ')).toLowerCase() === 's';
    if (!ok) process.exit(0);
  }

  console.log('\nA senha não aparece na tela: cada tecla vira •.');
  let password = '';
  for (;;) {
    password = await ask('Senha (mínimo 12 caracteres): ', { hidden: true });
    const problem = passwordProblems(password);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    // Secao 6.2: rejeitar senhas que aparecem em vazamentos conhecidos (so o prefixo do hash sai daqui).
    const pwned = await pwnedCount(password);
    if (pwned) {
      console.log(`  Esta senha já apareceu ${pwned.toLocaleString('pt-BR')} vezes em vazamentos. Escolha outra.`);
      continue;
    }
    if (pwned === null) console.log('  (Não consegui consultar a base de senhas vazadas; seguindo assim mesmo.)');
    if ((await ask('Repita a senha: ', { hidden: true })) !== password) {
      console.log('  As senhas não conferem. Vamos de novo.');
      continue;
    }
    break;
  }

  const secret = generateTotpSecret();
  const uri = otpauthUri(secret, email);
  console.log('\nAbra seu app autenticador (Google Authenticator, Microsoft Authenticator, 1Password...) e leia o QR code:\n');
  console.log(await QRCode.toString(uri, { type: 'terminal', small: true }));
  console.log(`Ou digite a chave manualmente: ${secret.match(/.{1,4}/g)!.join(' ')}\n`);

  for (let attempt = 1; ; attempt++) {
    const code = (await ask('Código de 6 dígitos que apareceu no app: ')).replace(/\s/g, '');
    if (verifyTotp(secret, code, Date.now(), null) != null) break;
    if (attempt >= 5) {
      console.log('Muitas tentativas. Rode o comando de novo.');
      process.exit(1);
    }
    console.log('  Código não confere. Verifique se o relógio do computador e do celular estão certos.');
  }

  const { doc, recoveryCodes } = await buildUser(crypto, { name, email, cpf, password, totpSecret: secret });
  if (existing) {
    await col.users.updateOne({ _id: existing._id }, { $set: { ...doc, createdAt: existing.createdAt } });
    // Senha nova: derruba todas as sessoes abertas.
    await col.sessions.updateMany({ userId: existing._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  } else {
    await col.users.insertOne(doc as never);
  }

  console.log('\n✓ Usuário pronto.\n');
  console.log('Códigos de recuperação (cada um funciona UMA vez no lugar do código do app).');
  console.log('Guarde offline, num lugar seguro. Eles não serão mostrados de novo:\n');
  recoveryCodes.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c}`));
  console.log('');
} finally {
  await database.close();
}
process.exit(0);
