import { z } from 'zod';

// Caixinhas, porquinhos e investimentos (tela Investimentos): um card por aplicacao, com o banco,
// quanto tem, a meta a que esta ligada e quanto rende em 1 mes, 1 ano e 5 anos.

const Money = z.number().int();

export const InvestmentBoxSchema = z.object({
  /** "inv:<id>" (investimento) ou "acc:<id>" (poupanca). */
  id: z.string(),
  kind: z.enum(['investimento', 'poupanca']),
  name: z.string(),
  institutionName: z.string(),
  type: z.string(),
  valueMinor: Money,
  appliedMinor: Money.nullable(),
  /** Taxa usada na projecao, ao ano (0,14 = 14%). */
  annualRate: z.number(),
  rateLabel: z.string(),
  /** Sem taxa informada pelo banco: vale a referencia. */
  estimated: z.boolean(),
  projection: z.object({ monthMinor: Money, yearMinor: Money, fiveYearsMinor: Money }),
  goal: z
    .object({
      id: z.string(),
      name: z.string(),
      targetMinor: Money,
      deadline: z.string().nullable(),
      /** Soma das caixinhas ligadas a esta meta. */
      savedMinor: Money,
      monthlyMinor: Money,
      /** Meses para chegar no alvo com rendimento + aporte; null se nao chega. */
      monthsToTarget: z.number().int().nullable(),
    })
    .nullable(),
});
export type InvestmentBox = z.infer<typeof InvestmentBoxSchema>;

export const InvestmentBoxesSchema = z.object({
  items: z.array(InvestmentBoxSchema),
  rates: z.object({ cdi: z.number(), selic: z.number(), ipca: z.number(), source: z.enum(['bcb', 'referencia']), at: z.string() }),
  goals: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type InvestmentBoxes = z.infer<typeof InvestmentBoxesSchema>;

export const LinkBoxGoalSchema = z.object({ goalId: z.string().regex(/^[a-f0-9]{24}$/).nullable() });
