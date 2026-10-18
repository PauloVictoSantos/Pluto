// Cadastra ou troca o CPF de login de um usuario existente, sem mexer em senha e autenticador.
// Uso: pnpm --filter @pluto/api user:set-cpf
import { CpfSchema, EmailSchema, maskCpf } from '@pluto/shared';
import { loadEnv } from '../src/config/env';
import { connectDatabase } from '../src/db/client';
import { collections } from '../src/db/collections';
import { ensureIndexes } from '../src/db/indexes';
import { cpfHash } from '../src/modules/auth/service';
import { createFieldCrypto } from '../src/lib/crypto';
import { ask } from './prompt';

const env = loadEnv();
const database = await connectDatabase(env.MONGODB_URI, env.MONGODB_DB);
const col = collections(database.db);
const crypto = createFieldCrypto(env.FIELD_ENCRYPTION_KEY);

try {
  await ensureIndexes(database.db);
  console.log('\n🐱 Pluto · CPF de login\n');

  const email = EmailSchema.safeParse(await ask('E-mail da conta: '));
  const user = email.success ? await col.users.findOne({ email: email.data }) : null;
  if (!user) {
    console.log('Nenhuma conta com este e-mail.');
    process.exit(1);
  }

  let cpf = '';
  for (;;) {
    const r = CpfSchema.safeParse(await ask('CPF: '));
    if (r.success) {
      cpf = r.data;
      break;
    }
    console.log('  CPF inválido.');
  }
  const hash = cpfHash(crypto, cpf);
  if (await col.users.findOne({ cpfHash: hash, _id: { $ne: user._id } })) {
    console.log('Este CPF já é o login de outra conta.');
    process.exit(1);
  }

  await col.users.updateOne({ _id: user._id }, { $set: { cpfHash: hash, cpfEnc: crypto.encrypt(cpf), updatedAt: new Date() } });
  await col.auditLogs.insertOne({ userId: user._id, event: 'user.cpf_changed', ip: null, meta: { via: 'cli' }, at: new Date() } as never);
  console.log(`\n✓ Pronto. Agora você entra com o CPF ${maskCpf(cpf)} e a mesma senha.\n`);
} finally {
  await database.close();
}
process.exit(0);
