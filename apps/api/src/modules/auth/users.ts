import { DEFAULT_SETTINGS, normalizeCpf } from '@pluto/shared';
import type { UserDoc } from '../../db/collections';
import type { FieldCrypto } from '../../lib/crypto';
import { hashPassword } from '../../lib/password';
import { recoveryCodes, sha256 } from '../../lib/tokens';
import { cpfHash } from './service';

/** Monta o documento do usuario com senha Argon2id, TOTP criptografado e codigos de recuperacao. */
export async function buildUser(
  crypto: FieldCrypto,
  input: { name: string; email: string; cpf: string; password: string; totpSecret: string },
): Promise<{ doc: Omit<UserDoc, '_id'>; recoveryCodes: string[] }> {
  const codes = recoveryCodes();
  const now = new Date();
  const cpf = normalizeCpf(input.cpf);
  return {
    recoveryCodes: codes,
    doc: {
      email: input.email.trim().toLowerCase(),
      cpfHash: cpfHash(crypto, cpf),
      cpfEnc: crypto.encrypt(cpf),
      name: input.name.trim(),
      phone: null,
      passwordHash: await hashPassword(input.password),
      totp: { secretEnc: crypto.encrypt(input.totpSecret), enabled: true, lastStep: null, recoveryCodesHash: codes.map(sha256) },
      settings: DEFAULT_SETTINGS,
      failedLogins: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}
