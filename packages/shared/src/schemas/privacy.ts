import { z } from 'zod';

// LGPD (doc. Pluton 8.5): exportacao, exclusao real e consentimento para a IA.

export const ExportQuerySchema = z.object({ format: z.enum(['json', 'csv']).default('json') });
/** Arquivo pronto para baixar (o app cria o download no aparelho). */
export const ExportFileSchema = z.object({ filename: z.string(), mime: z.string(), content: z.string() });
export type ExportFile = z.infer<typeof ExportFileSchema>;

/** Exclusao pede a palavra digitada, alem da autenticacao recente. */
export const DeleteAccountSchema = z.object({ confirm: z.literal('EXCLUIR', { error: 'Digite EXCLUIR para confirmar' }) });

export const AiConsentSchema = z.object({ accept: z.boolean() });

export const ContestationSchema = z.object({ subject: z.string(), text: z.string(), createdAt: z.string() });
export const ContestationsSchema = z.array(ContestationSchema);
export const CreateContestationSchema = z.object({ subject: z.string().trim().min(1).max(120), text: z.string().trim().min(1, 'Conte o que você contesta').max(1000) });
