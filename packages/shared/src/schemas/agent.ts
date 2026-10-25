import { z } from 'zod';

// Agente Plutao (doc. Pluton): perfil financeiro que alimenta os calculos (renda liquida, margem de
// seguranca, objetivo do ano). A renda e criptografada no banco; o resto e configuracao.

export const YEAR_OBJECTIVES = ['quitar-dividas', 'reserva-emergencia', 'investir', 'comprar-bem', 'viajar', 'organizar'] as const;
export type YearObjective = (typeof YEAR_OBJECTIVES)[number];

export const YEAR_OBJECTIVE_LABEL: Record<YearObjective, string> = {
  'quitar-dividas': 'Quitar dívidas',
  'reserva-emergencia': 'Montar reserva de emergência',
  investir: 'Investir mais',
  'comprar-bem': 'Comprar um bem',
  viajar: 'Viajar',
  organizar: 'Organizar as contas',
};

export const FinancialProfileSchema = z.object({
  /** Renda liquida mensal informada; null = ainda nao informada (usa a sugestao). */
  netIncomeMinor: z.number().int().nullable(),
  /** Mediana das entradas dos ultimos 6 meses fechados, para sugerir a renda. */
  suggestedIncomeMinor: z.number().int().nullable(),
  /** Parte da renda que o agente nunca compromete (0 a 15%). */
  safetyMarginPct: z.number().min(0).max(15),
  yearObjective: z.enum(YEAR_OBJECTIVES).nullable(),
  /** Rendimento mensal de referencia do dinheiro guardado (ex.: 0,008 = 0,8% a.m.). */
  referenceRateMonthly: z.number().min(0).max(0.05),
  updatedAt: z.string().nullable(),
  /** true: a renda e a soma dos perfis financeiros (o campo de renda fica so de leitura). */
  incomeFromProfiles: z.boolean(),
});
export type FinancialProfile = z.infer<typeof FinancialProfileSchema>;

export const UpdateFinancialProfileSchema = z
  .object({
    netIncomeMinor: z.number().int().min(0).max(100_000_000_00).nullable(),
    safetyMarginPct: z.number().min(0).max(15),
    yearObjective: z.enum(YEAR_OBJECTIVES).nullable(),
    referenceRateMonthly: z.number().min(0).max(0.05),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para atualizar');
export type UpdateFinancialProfile = z.infer<typeof UpdateFinancialProfileSchema>;

export const PROFILE_DEFAULTS = { safetyMarginPct: 5, referenceRateMonthly: 0.008 } as const;
