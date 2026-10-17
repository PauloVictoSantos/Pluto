import { z } from 'zod';
import { UserSettingsSchema } from './settings';

export const EmailSchema = z.string().trim().toLowerCase().email('E-mail inválido').max(254);

export const LoginSchema = z.object({
  email: EmailSchema,
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
  name: z.string(),
  phone: z.string().nullable(),
  settings: UserSettingsSchema,
});
export type Me = z.infer<typeof MeSchema>;

export const UpdateMeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: EmailSchema.optional(),
});

/** Cabecalho que o app mobile envia para receber o refresh token no corpo. */
export const CLIENT_HEADER = 'x-pluto-client';
