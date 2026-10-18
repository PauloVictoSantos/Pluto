import { z } from 'zod';
import { isValidCpf, normalizeCpf } from '../cpf';
import { UserSettingsSchema } from './settings';

export const EmailSchema = z.string().trim().toLowerCase().email('E-mail inválido').max(254);

/** CPF com ou sem pontuacao; sai so com os 11 digitos. */
export const CpfSchema = z
  .string()
  .max(20)
  .transform(normalizeCpf)
  .refine(isValidCpf, 'CPF inválido');

/** Login por CPF + senha; o e-mail e so contato. */
export const LoginSchema = z.object({
  cpf: CpfSchema,
  password: z.string().min(1).max(256),
});

/** Senha correta: falta o segundo fator (secao 6.2). */
export const MfaChallengeSchema = z.object({ mfaRequired: z.literal(true), mfaToken: z.string() });

/** Codigo do autenticador (6 digitos) ou codigo de recuperacao (xxxx-xxxx). */
export const MfaCodeSchema = z.string().trim().min(6).max(12);

export const VerifyMfaSchema = z.object({
  mfaToken: z.string().min(10).max(2000),
  code: MfaCodeSchema,
  remember: z.boolean().default(true),
});

export const TokensSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  /** So para o app mobile (guardado no Keychain/Keystore). Na web vai em cookie HttpOnly. */
  refreshToken: z.string().optional(),
});
export type Tokens = z.infer<typeof TokensSchema>;

export const RefreshSchema = z.object({ refreshToken: z.string().min(20).max(200).optional() }).nullish();

export const ReauthSchema = z.object({ password: z.string().min(1).max(256), code: MfaCodeSchema });

export const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  /** "***.456.789-**"; null enquanto o CPF nao foi cadastrado. */
  cpfMasked: z.string().nullable(),
  name: z.string(),
  phone: z.string().nullable(),
  settings: UserSettingsSchema,
});
export type Me = z.infer<typeof MeSchema>;

export const UpdateMeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: EmailSchema.optional(),
  /** Trocar o CPF muda o login: exige autenticacao recente. */
  cpf: CpfSchema.optional(),
});

// Passkeys (WebAuthn): biometria do aparelho (digital, Face ID, Windows Hello) como login completo.
// As opcoes e respostas seguem o formato JSON do WebAuthn (@simplewebauthn); a API valida tudo.
export const PasskeyOptionsSchema = z.object({
  challengeId: z.string(),
  options: z.record(z.string(), z.unknown()),
});

const WebAuthnResponseSchema = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  response: z.record(z.string(), z.unknown()),
});

export const PasskeyRegisterSchema = z.object({
  challengeId: z.string().regex(/^[a-f0-9]{24}$/),
  response: WebAuthnResponseSchema,
  name: z.string().trim().max(60).optional(),
});

export const PasskeyLoginSchema = z.object({
  challengeId: z.string().regex(/^[a-f0-9]{24}$/),
  response: WebAuthnResponseSchema,
  remember: z.boolean().default(true),
});

export const PasskeySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  lastUsedAt: z.coerce.date().nullable(),
});
export type Passkey = z.infer<typeof PasskeySchema>;

/** Cabecalho que o app mobile envia para receber o refresh token no corpo. */
export const CLIENT_HEADER = 'x-pluto-client';
