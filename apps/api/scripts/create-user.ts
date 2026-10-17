// Cria (ou redefine) o usuario do Pluto. Uso: pnpm --filter @pluto/api user:create
// Interativo: senha digitada sem eco, autenticador configurado por QR code, codigos de
// recuperacao mostrados uma unica vez. Nada sensivel e gravado em claro.
import { createInterface } from 'node:readline/promises';
import QRCode from 'qrcode';
import { EmailSchema } from '@pluto/shared';
import { loadEnv } from '../src/config/env';
import { connectDatabase } from '../src/db/client';
import { collections } from '../src/db/collections';
import { ensureIndexes } from '../src/db/indexes';
import { buildUser } from '../src/modules/auth/users';
import { createFieldCrypto } from '../src/lib/crypto';
import { passwordProblems, pwnedCount } from '../src/lib/password';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../src/lib/totp';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q: string) => (await rl.question(q)).trim();

/** Le sem mostrar o que e digitado. */
function askHidden(q: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(q);
    rl.pause();
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = '';
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.off('data', onData);
          process.stdout.write('\n');
          rl.resume();
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const env = loadEnv();
const database = await connectDatabase(env.MONGODB_URI);
const col = collections(database.db);
const crypto = createFieldCrypto(env.FIELD_ENCRYPTION_KEY);

try {
  await ensureIndexes(database.db);
  console.log('\n🐱 Pluto · criar usuário\n');

  const name = (await ask('Seu nome: ')) || 'Proprietário';
  let email = '';
  for (;;) {
    const r = EmailSchema.safeParse(await ask('E-mail de login: '));
    if (r.success) {
      email = r.data;
      break;
    }
    console.log('  E-mail inválido.');
  }

  const existing = await col.users.findOne({ email });
  if (existing) {
    const ok = (await ask('Já existe um usuário com este e-mail. Redefinir senha e autenticador? (s/N) ')).toLowerCase() === 's';
    if (!ok) process.exit(0);
  }

  let password = '';
  for (;;) {
    password = await askHidden(`Senha (mínimo 12 caracteres): `);
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
    if ((await askHidden('Repita a senha: ')) !== password) {
      console.log('  As senhas não conferem.');
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

  const { doc, recoveryCodes } = await buildUser(crypto, { name, email, password, totpSecret: secret });
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
  rl.close();
  await database.close();
}
