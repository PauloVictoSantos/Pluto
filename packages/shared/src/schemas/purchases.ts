import { z } from 'zod';
import { GOAL_REASONS, PAYMENT_METHODS } from './agentGoals';

// Avaliacao de compra do agente Plutao (doc. Pluton 3.4 e 5.5): APROVAR / ADIAR / RECUSAR com o
// numero que justifica. RECUSAR bloqueia "planejar"; comprar mesmo assim vira desvio.

export const MOODS = ['calmo', 'estressado', 'recompensa', 'pressa'] as const;
export const MOOD_LABEL: Record<(typeof MOODS)[number], string> = {
  calmo: 'Tranquilo',
  estressado: 'Estressado ou cansado',
  recompensa: 'Quero me recompensar',
  pressa: 'Com pressa, é promoção',
};

export const PURCHASE_STATUSES = ['simulada', 'avaliada', 'espera-72h', 'planejada', 'comprada', 'desvio', 'desistiu'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PurchaseRequestSchema = z
  .object({
    description: z.string().trim().min(1, 'O que você quer comprar?').max(80),
    priceMinor: z.number().int().positive('Informe o valor').max(1e11),
    payment: z.enum(PAYMENT_METHODS),
    installments: z.number().int().min(2).max(120).nullable().optional(),
    monthlyRate: z.number().min(0).max(0.5).nullable().optional(),
    reason: z.enum(GOAL_REASONS),
    urgency: z.number().int().min(1).max(5),
    mood: z.enum(MOODS),
  })
  .superRefine((b, ctx) => {
    if (b.payment !== 'cash' && !b.installments && b.payment !== 'card') ctx.addIssue({ code: 'custom', path: ['installments'], message: 'Em quantas parcelas?' });
    if (b.payment === 'financed' && b.monthlyRate == null) ctx.addIssue({ code: 'custom', path: ['monthlyRate'], message: 'Qual a taxa de juros ao mês?' });
  });
export type PurchaseRequest = z.input<typeof PurchaseRequestSchema>;

export const PurchaseEvaluationSchema = z.object({
  /** null: so simulacao (nada gravado). */
  id: z.string().nullable(),
  description: z.string(),
  priceMinor: z.number().int(),
  payment: z.enum(PAYMENT_METHODS),
  verdict: z.enum(['aprovar', 'adiar', 'recusar']),
  reason: z.enum(['urgencia-reserva', 'juros-sem-reserva', 'contencao', 'estoura-limite', 'reserva-baixa', 'atrasa-meta', 'regra-72h', 'cabe']),
  /** Veredito em uma frase, com o numero. */
  headline: z.string(),
  explanation: z.array(z.string()),
  monthImpactMinor: z.number().int(),
  installmentMinor: z.number().int().nullable(),
  interestMinor: z.number().int(),
  goalDelayDays: z.number().int().nullable(),
  goalName: z.string().nullable(),
  reservePlan: z.object({ useMinor: z.number().int(), months: z.number().int().nullable(), monthlyMinor: z.number().int() }).nullable(),
  status: z.enum(PURCHASE_STATUSES),
  holdUntil: z.string().nullable(),
  /** Pode virar "planejada" (so APROVAR, e depois das 72 h). */
  canPlan: z.boolean(),
  /** Consequencia mostrada quando comprou mesmo assim (desvio). */
  consequence: z.array(z.string()).nullable(),
  createdAt: z.string(),
});
export type PurchaseEvaluation = z.infer<typeof PurchaseEvaluationSchema>;
export const PurchasesSchema = z.array(PurchaseEvaluationSchema);
