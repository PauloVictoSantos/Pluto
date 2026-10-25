import { z } from 'zod';

// Perfis financeiros (doc. Melhorias, passo 6): ate 2 fontes de renda (ex.: salario e freela).
// A renda que o Plutao usa nos calculos e a soma dos perfis.

export const MAX_INCOME_PROFILES = 2;
export const INCOME_TYPES = ['clt', 'pj', 'autonomo', 'servidor', 'aposentadoria', 'beneficio', 'outro'] as const;
export type IncomeType = (typeof INCOME_TYPES)[number];
export const INCOME_TYPE_LABEL: Record<IncomeType, string> = {
  clt: 'Salário (CLT)',
  pj: 'PJ',
  autonomo: 'Autônomo / freela',
  servidor: 'Servidor público',
  aposentadoria: 'Aposentadoria',
  beneficio: 'Benefício / pensão',
  outro: 'Outro',
};
/** Capas padrao (sem upload de imagem). */
export const PROFILE_COVERS = ['violeta', 'lima', 'oceano', 'por-do-sol', 'grafite', 'floresta'] as const;
export type ProfileCover = (typeof PROFILE_COVERS)[number];

export const IncomeProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  cover: z.enum(PROFILE_COVERS),
  netIncomeMinor: z.number().int(),
  payDay: z.number().int().min(1).max(31),
  incomeType: z.enum(INCOME_TYPES),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type IncomeProfile = z.infer<typeof IncomeProfileSchema>;

const Fields = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao perfil').max(40),
  cover: z.enum(PROFILE_COVERS),
  netIncomeMinor: z.number().int().min(0).max(100_000_000_00),
  payDay: z.number().int().min(1, 'Dia entre 1 e 31').max(31, 'Dia entre 1 e 31'),
  incomeType: z.enum(INCOME_TYPES),
  notes: z.string().trim().max(200).nullable().optional(),
});
export const CreateIncomeProfileSchema = Fields;
export type CreateIncomeProfile = z.input<typeof CreateIncomeProfileSchema>;
export const UpdateIncomeProfileSchema = Fields.partial().refine((b) => Object.keys(b).length > 0, 'Nada para atualizar');
export type UpdateIncomeProfile = z.input<typeof UpdateIncomeProfileSchema>;

export const IncomeProfilesSchema = z.object({
  items: z.array(IncomeProfileSchema),
  totalIncomeMinor: z.number().int(),
  max: z.number().int(),
});
export type IncomeProfiles = z.infer<typeof IncomeProfilesSchema>;
