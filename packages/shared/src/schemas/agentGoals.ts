import { z } from 'zod';

// Metas v2 do agente Plutao (doc. Pluton 3.2 e 4): intencao -> entrevista -> diagnostico -> proposta
// -> confirmacao. O rascunho guarda as respostas; a meta so nasce na confirmacao (MT-02).

export const GOAL_KINDS = ['purchase', 'fixed', 'debt_payoff', 'experience'] as const;
export type GoalKindV2 = (typeof GOAL_KINDS)[number];
export const GOAL_KIND_LABEL: Record<GoalKindV2, string> = {
  purchase: 'Compra',
  fixed: 'Reserva ou aporte contínuo',
  debt_payoff: 'Quitar dívida',
  experience: 'Viagem ou evento',
};

export const GOAL_REASONS = ['renda', 'trabalho', 'saude', 'moradia', 'educacao', 'desejo'] as const;
export const GOAL_REASON_LABEL: Record<(typeof GOAL_REASONS)[number], string> = {
  renda: 'Gera renda',
  trabalho: 'Para o trabalho',
  saude: 'Saúde',
  moradia: 'Moradia ou reparo essencial',
  educacao: 'Estudo',
  desejo: 'Desejo pessoal',
};
export const PAYMENT_METHODS = ['cash', 'installments', 'financed', 'card'] as const;
export const PAYMENT_METHOD_LABEL: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: 'À vista',
  installments: 'Parcelado sem juros',
  financed: 'Financiado',
  card: 'Cartão de crédito',
};

/** Status (MT-03): rascunho -> em analise -> ativa -> pausada -> concluida / cancelada. */
export const GOAL_STATUSES = ['rascunho', 'em-analise', 'ativa', 'pausada', 'concluida', 'cancelada'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const Money = z.number().int().nonnegative().max(1e12);

/** Respostas da entrevista (todas opcionais ate o diagnostico). */
export const GoalAnswersSchema = z
  .object({
    targetMinor: Money.refine((v) => v > 0, 'Informe o valor'),
    priceResearched: z.boolean(),
    store: z.string().trim().min(1).max(80),
    paymentMethod: z.enum(PAYMENT_METHODS),
    /** Desconto a vista (0 a 0,5). */
    cashDiscount: z.number().min(0).max(0.5),
    installments: z.number().int().min(1).max(120),
    /** Juros ao mes do financiamento. */
    monthlyRate: z.number().min(0).max(0.5),
    urgency: z.number().int().min(1).max(5),
    reason: z.enum(GOAL_REASONS),
    alternative: z.string().trim().min(1).max(200),
    targetDate: Day,
    savedMinor: Money,
    /** Meta fixa: alvo em meses de custo fixo. */
    targetMonths: z.number().int().min(1).max(36),
    /** Meta fixa: quanto consegue guardar por mes. */
    monthlyCapacityMinor: Money.refine((v) => v > 0, 'Informe quanto consegue guardar'),
    whereStored: z.string().trim().min(1).max(80),
    liquidity: z.boolean(),
    /** Quitacao: qual divida com juros. */
    loanId: z.string().regex(/^[a-f0-9]{24}$/),
  })
  .partial();
export type GoalAnswers = z.infer<typeof GoalAnswersSchema>;
export type GoalField = keyof GoalAnswers;

export interface GoalQuestion {
  field: GoalField;
  question: string;
  why: string;
  input: 'money' | 'bool' | 'text' | 'date' | 'urgency' | 'reason' | 'payment' | 'percent' | 'int' | 'loan' | 'rate';
}

/** Perguntas obrigatorias (doc. 4.1), na ordem em que o agente faz. */
export const GOAL_QUESTIONS: Record<GoalField, GoalQuestion> = {
  targetMinor: { field: 'targetMinor', question: 'Qual o valor exato?', why: 'Base de todo o cálculo', input: 'money' },
  priceResearched: { field: 'priceResearched', question: 'Já pesquisou o preço em mais de um lugar?', why: 'Preço real evita meta errada', input: 'bool' },
  store: { field: 'store', question: 'Onde pretende comprar? Loja física, online, importação?', why: 'Frete, impostos, garantia, risco', input: 'text' },
  paymentMethod: { field: 'paymentMethod', question: 'À vista, parcelado sem juros, financiado ou cartão?', why: 'Custo efetivo total', input: 'payment' },
  cashDiscount: { field: 'cashDiscount', question: 'Qual o desconto se pagar à vista?', why: 'Comparar com o rendimento do dinheiro guardado', input: 'percent' },
  installments: { field: 'installments', question: 'Em quantas parcelas?', why: 'Valor e custo das parcelas', input: 'int' },
  monthlyRate: { field: 'monthlyRate', question: 'Qual a taxa de juros ao mês do financiamento?', why: 'Custo efetivo total', input: 'rate' },
  urgency: { field: 'urgency', question: 'De 1 a 5, quão urgente? O que acontece se esperar 6 meses?', why: 'Prioridade e prazo', input: 'urgency' },
  reason: { field: 'reason', question: 'Para que você precisa disso? Gera renda, é trabalho ou é desejo?', why: 'Separar necessidade de desejo', input: 'reason' },
  alternative: { field: 'alternative', question: 'Existe opção mais barata que resolve 80% do problema?', why: 'Reduzir o valor da meta', input: 'text' },
  targetDate: { field: 'targetDate', question: 'Até quando você quer ter isso?', why: 'Aporte mensal necessário', input: 'date' },
  savedMinor: { field: 'savedMinor', question: 'Já tem algum valor separado para isso?', why: 'Saldo inicial', input: 'money' },
  targetMonths: { field: 'targetMonths', question: 'A reserva deve cobrir quantos meses do seu custo fixo?', why: 'Valor alvo da reserva', input: 'int' },
  monthlyCapacityMinor: { field: 'monthlyCapacityMinor', question: 'Quanto consegue guardar por mês?', why: 'Prazo da meta', input: 'money' },
  whereStored: { field: 'whereStored', question: 'Onde o dinheiro vai ficar guardado?', why: 'Rendimento e segurança', input: 'text' },
  liquidity: { field: 'liquidity', question: 'Dá para resgatar na hora, se precisar?', why: 'Reserva precisa de liquidez imediata', input: 'bool' },
  loanId: { field: 'loanId', question: 'Qual dívida você quer quitar?', why: 'Valor e juros evitados', input: 'loan' },
};

/** Campos obrigatorios por tipo e resposta (desconto so faz sentido sem financiamento, etc.). */
export function requiredFields(kind: GoalKindV2, a: GoalAnswers): GoalField[] {
  if (kind === 'fixed') return ['targetMonths', 'savedMinor', 'monthlyCapacityMinor', 'whereStored', 'liquidity'];
  if (kind === 'debt_payoff') return ['loanId', 'savedMinor', 'urgency', 'targetDate'];
  const f: GoalField[] = ['targetMinor', 'priceResearched', 'reason', 'urgency', 'store', 'paymentMethod'];
  if (a.paymentMethod === 'installments' || a.paymentMethod === 'financed') f.push('installments');
  if (a.paymentMethod === 'financed') f.push('monthlyRate');
  f.push('cashDiscount', 'alternative', 'targetDate', 'savedMinor');
  return f;
}
export const missingFields = (kind: GoalKindV2, a: GoalAnswers) => requiredFields(kind, a).filter((k) => a[k] === undefined);

export const GoalScenarioSchema = z.object({
  key: z.enum(['no-prazo', 'adiar', 'reduzir', 'pausar']),
  label: z.string(),
  targetMinor: z.number().int(),
  targetDate: z.string(),
  monthlyMinor: z.number().int(),
  note: z.string(),
  /** "pausar": meta de menor prioridade que libera o aporte. */
  pauseGoalId: z.string().nullable(),
});
export type GoalScenario = z.infer<typeof GoalScenarioSchema>;

export const GoalDiagnosisSchema = z.object({
  verdict: z.enum(['aprovar', 'adiar', 'recusar']),
  /** Justificativa explicavel, com os numeros. */
  rationale: z.array(z.string()),
  targetMinor: z.number().int(),
  savedMinor: z.number().int(),
  targetDate: z.string(),
  months: z.number().int(),
  requiredMonthlyMinor: z.number().int(),
  /** Capacidade de poupanca (renda - fixos - media dos variaveis). */
  capacityMinor: z.number().int(),
  /** Ja comprometido com outras metas ativas. */
  committedMinor: z.number().int(),
  freeMinor: z.number().int(),
  score: z.number(),
  factors: z.object({ U: z.number(), E: z.number(), F: z.number(), R: z.number(), A: z.number() }),
  health: z.object({ score: z.number().int().nullable(), containment: z.boolean(), reserveMonths: z.number().nullable() }),
  /** A vista com desconto x parcelado sem juros (compras). */
  payment: z.object({ cashMinor: z.number().int(), installmentsPvMinor: z.number().int(), best: z.enum(['cash', 'installments']), savingMinor: z.number().int() }).nullable(),
  /** Juros totais do financiamento (Price), se financiado. */
  financedInterestMinor: z.number().int().nullable(),
  scenarios: z.array(GoalScenarioSchema).max(3),
});
export type GoalDiagnosis = z.infer<typeof GoalDiagnosisSchema>;

export const GoalDraftSchema = z.object({
  id: z.string(),
  kind: z.enum(GOAL_KINDS),
  title: z.string(),
  status: z.enum(['rascunho', 'em-analise', 'confirmada', 'descartada']),
  answers: GoalAnswersSchema,
  missing: z.array(z.string()),
  /** Proximas 1 ou 2 perguntas (o agente nao despeja todas de uma vez). */
  next: z.array(z.object({ field: z.string(), question: z.string(), why: z.string(), input: z.string() })),
  diagnosis: GoalDiagnosisSchema.nullable(),
  goalId: z.string().nullable(),
});
export type GoalDraft = z.infer<typeof GoalDraftSchema>;

export const CreateGoalDraftSchema = z.object({ kind: z.enum(GOAL_KINDS), title: z.string().trim().min(1, 'Dê um nome à meta').max(80) });
export const ConfirmGoalDraftSchema = z.object({ scenario: z.enum(['no-prazo', 'adiar', 'reduzir', 'pausar']) });
export const DiscardGoalDraftSchema = z.object({ reason: z.string().trim().min(1, 'Conte o motivo').max(200) });
export const GoalStatusChangeSchema = z.object({ status: z.enum(['ativa', 'pausada', 'concluida']) });

/** Plano das metas: capacidade distribuida por prioridade (MT-04). */
export const GoalsPlanSchema = z.object({
  capacityMinor: z.number().int(),
  allocatedMinor: z.number().int(),
  freeMinor: z.number().int(),
  goals: z.array(
    z.object({
      goalId: z.string(),
      name: z.string(),
      status: z.enum(GOAL_STATUSES),
      score: z.number(),
      requiredMinor: z.number().int(),
      allocatedMinor: z.number().int(),
      waiting: z.boolean(),
      note: z.string(),
    }),
  ),
});
export type GoalsPlan = z.infer<typeof GoalsPlanSchema>;
