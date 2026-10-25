import {
  CATEGORIES,
  CreateFixedExpenseSchema,
  FIXED_RECURRENCES,
  GOAL_KINDS,
  GOAL_REASONS,
  GoalAnswersSchema,
  MOODS,
  PAYMENT_METHODS,
  PurchaseRequestSchema,
  UpdateFixedExpenseSchema,
  categoryOf,
  type FixedExpense,
} from '@pluto/shared';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppContext } from '../../../context';
import type { LlmTool } from '../../../integrations/llm/gemini';
import { financialHealth } from '../../analytics/health';
import { createFixed, listFixed, removeFixed, updateFixed } from '../fixed';
import { answerDraft, confirmDraft, createDraft, diagnoseDraft, goalsPlan, setGoalStatus } from '../goals';
import { getLimit } from '../limit';
import { listLoans } from '../loans';
import { listObligations } from '../obligations';
import { monthRange } from '../../../lib/time';
import { readProfile } from '../profile';
import { simulatePurchase } from '../purchases';

// Ferramentas do Plutao (doc. Pluton 7.1). Nenhuma recebe user_id: ele vem do token, pelo
// orquestrador. Argumentos validados por schema antes de executar. IDs internos nunca saem: as
// ferramentas falam em referencias curtas da sessao (F1, M2, D1, R1).

export type ToolKind = 'leitura' | 'calculo' | 'sessao' | 'escrita' | 'pergunta';
export type RefType = 'F' | 'M' | 'D' | 'R';
export type Refs = Record<string, string>;

export interface ToolEnv {
  ctx: AppContext;
  userId: ObjectId;
  refs: Refs;
}

/** Erro mostrado ao modelo (sem detalhes internos). */
export class ToolError extends Error {}

export interface Tool {
  name: string;
  kind: ToolKind;
  description: string;
  parameters?: object;
  /** Valida e resolve referencias; devolve os argumentos prontos para executar. */
  prepare(args: Record<string, unknown>, env: ToolEnv): Promise<unknown>;
  run(args: unknown, env: ToolEnv): Promise<Record<string, unknown>>;
  /** Escrita: resumo do que sera gravado, para o "sim". */
  summary?(args: unknown, env: ToolEnv): Promise<string>;
}

const brl = (minor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
const reais = (minor: number | null | undefined) => (minor == null ? null : Math.round(minor) / 100);
const cents = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : v);
const SPEND = CATEGORIES.filter((c) => c.group === 'essential' || c.group === 'lifestyle').map((c) => c.key);

/** Referencia curta para um id (reaproveita se ja existe). */
export function refFor(refs: Refs, type: RefType, id: string): string {
  const hit = Object.entries(refs).find(([k, v]) => v === id && k.startsWith(type));
  if (hit) return hit[0];
  const n = Object.keys(refs).filter((k) => k.startsWith(type)).length + 1;
  refs[`${type}${n}`] = id;
  return `${type}${n}`;
}
function resolve(refs: Refs, type: RefType, ref: unknown): string {
  const id = typeof ref === 'string' ? refs[ref.trim().toUpperCase()] : undefined;
  if (!id || !String(ref).toUpperCase().startsWith(type)) throw new ToolError(`Referência ${String(ref)} não encontrada. Liste os itens antes.`);
  return id;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ToolError(`Argumentos inválidos: ${r.error.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`).join('; ')}`);
  return r.data;
}

const S = {
  str: (description: string) => ({ type: 'string', description }),
  num: (description: string) => ({ type: 'number', description }),
  int: (description: string) => ({ type: 'integer', description }),
  bool: (description: string) => ({ type: 'boolean', description }),
  enum: (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description }),
  obj: (properties: Record<string, object>, required: string[] = []) => ({ type: 'object', properties, required }),
  strs: (description: string) => ({ type: 'array', items: { type: 'string' }, description }),
};

const fixedView = (f: FixedExpense, refs: Refs) => ({
  ref: f.source === 'divida' ? null : refFor(refs, 'F', f.id),
  nome: f.name,
  categoria: categoryOf(f.categoryKey).label,
  valor: reais(f.amountMinor),
  valorVaria: f.isVariable,
  recorrencia: f.recurrence,
  vencimentoDia: f.dueDay,
  terminaEm: f.endsOn,
  origem: f.source === 'divida' ? 'parcela de dívida (editar em Contas a pagar)' : f.source,
  equivalenteMensal: reais(f.monthlyMinor),
});

const FIXED_PARAMS = {
  nome: S.str('Nome do gasto, ex.: Aluguel'),
  categoria: S.enum(SPEND, 'Categoria de gasto'),
  valor: S.num('Valor em reais (média, se varia)'),
  diaVencimento: S.int('Dia do vencimento (1-31; no semanal 1=domingo..7=sábado)'),
  recorrencia: S.enum(FIXED_RECURRENCES, 'weekly, monthly ou yearly'),
  mesVencimento: S.int('Mês do vencimento (1-12), só no anual'),
  valorVaria: S.bool('true se o valor muda todo mês (luz, água)'),
  terminaEm: S.str('Último mês AAAA-MM, se for temporário'),
};
const fixedBody = (a: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries({
      name: a.nome,
      categoryKey: a.categoria,
      amountMinor: cents(a.valor),
      dueDay: a.diaVencimento,
      recurrence: a.recorrencia,
      dueMonth: a.mesVencimento,
      isVariable: a.valorVaria,
      endsOn: a.terminaEm,
    }).filter(([, v]) => v !== undefined),
  );
const fixedText = (b: { name?: string; amountMinor?: number; recurrence?: string; dueDay?: number; categoryKey?: string }) =>
  [b.name, b.amountMinor !== undefined ? brl(b.amountMinor) : null, b.recurrence ? { weekly: 'semanal', monthly: 'mensal', yearly: 'anual' }[b.recurrence] : null, b.dueDay ? `vence dia ${b.dueDay}` : null, b.categoryKey ? categoryOf(b.categoryKey).label : null]
    .filter(Boolean)
    .join(', ');

const ANSWER_PARAMS = {
  valor: S.num('Valor exato em reais'),
  pesquisouPreco: S.bool('Já pesquisou o preço em mais de um lugar'),
  ondeComprar: S.str('Onde vai comprar'),
  formaPagamento: S.enum(PAYMENT_METHODS, 'cash, installments, financed ou card'),
  descontoAVistaPct: S.num('Desconto à vista em % (0 se não há)'),
  parcelas: S.int('Número de parcelas'),
  jurosMesPct: S.num('Juros do financiamento em % ao mês'),
  urgencia: S.int('Urgência de 1 a 5'),
  motivo: S.enum(GOAL_REASONS, 'renda, trabalho, saude, moradia, educacao ou desejo'),
  alternativa: S.str('Alternativa mais barata (ou "nenhuma")'),
  dataAlvo: S.str('Data alvo AAAA-MM-DD'),
  valorGuardado: S.num('Quanto já tem guardado, em reais'),
  mesesDeReserva: S.int('Reserva: quantos meses de custo fixo'),
  guardaPorMes: S.num('Reserva: quanto consegue guardar por mês, em reais'),
  ondeGuardar: S.str('Reserva: onde o dinheiro fica'),
  liquidez: S.bool('Reserva: dá para resgatar na hora'),
  divida: S.str('Quitação: referência da dívida (D1, D2...)'),
};

export const TOOLS: Tool[] = [
  {
    // Contrato com o site (doc. Melhorias, passo 4): a pergunta vira lista de escolha (radio) + Confirmar.
    name: 'perguntar_com_opcoes',
    kind: 'pergunta',
    description:
      'Faz UMA pergunta ao usuário com 2 a 6 respostas curtas para ele escolher (o app mostra como lista de escolha). Use sempre que as respostas possíveis forem conhecidas: prazo, prioridade, tipo de meta, sim/não com nuances. Encerra a sua vez: aguarde a resposta.',
    parameters: S.obj({ pergunta: S.str('Texto da pergunta'), opcoes: S.strs('De 2 a 6 opções curtas (até 60 caracteres cada)') }, ['pergunta', 'opcoes']),
    prepare: async (a) =>
      parse(z.object({ question: z.string().trim().min(3).max(300), options: z.array(z.string().trim().min(1).max(60)).min(2).max(6) }), { question: a.pergunta, options: a.opcoes }),
    run: async () => ({}),
  },
  {
    name: 'ler_snapshot_financeiro',
    kind: 'leitura',
    description: 'Resumo financeiro agregado do usuário: renda, limite do mês, saúde financeira, capacidade de poupança, fixos, dívidas e objetivo do ano.',
    prepare: async () => ({}),
    async run(_a, { ctx, userId }) {
      const [limit, health, { profile }, loans] = await Promise.all([getLimit(ctx, userId), financialHealth(ctx, userId), readProfile(ctx, userId), listLoans(ctx, userId)]);
      return {
        rendaLiquida: reais(limit.breakdown.incomeMinor),
        limiteDoMes: { limite: reais(limit.limitMinor), gastoVariavel: reais(limit.spentMinor), planejado: reais(limit.plannedMinor), restante: reais(limit.remainingMinor), porSemana: reais(limit.weekMinor), definidoPeloUsuario: limit.overrideMinor !== null },
        planoDoMes: { fixosEParcelas: reais(limit.breakdown.fixedMinor), aportesMetas: reais(limit.breakdown.goalsMinor), margemSeguranca: reais(limit.breakdown.marginMinor), deficit: reais(limit.breakdown.deficitMinor) },
        saude: {
          nota: health.score,
          faixa: health.band?.label ?? null,
          modoContencao: health.containment,
          indicadores: health.indicators.map((i) => ({ nome: i.label, valor: i.unit === 'money' ? reais(i.value) : i.value, unidade: i.unit === 'pct' ? 'fração da renda' : i.unit === 'months' ? 'meses' : 'reais', saudavel: i.healthy, ideal: i.target })),
        },
        dividas: { saldo: reais(loans.balanceMinor), parcelasMes: reais(loans.monthlyInstallmentsMinor), jurosMes: reais(loans.monthlyInterestMinor) },
        objetivoDoAno: profile.yearObjective,
        margemSegurancaPct: profile.safetyMarginPct,
      };
    },
  },
  {
    name: 'listar_gastos_fixos',
    kind: 'leitura',
    description: 'Lista os gastos fixos (com referência F1, F2...) e as parcelas de dívidas que contam como fixos.',
    prepare: async () => ({}),
    async run(_a, { ctx, userId, refs }) {
      const f = await listFixed(ctx, userId);
      return { itens: f.items.map((i) => fixedView(i, refs)), totalMensal: reais(f.monthlyTotalMinor), fracaoDaRenda: f.incomeShare };
    },
  },
  {
    name: 'listar_metas',
    kind: 'leitura',
    description: 'Lista as metas (referência M1, M2...) com status e o plano das metas por prioridade.',
    prepare: async () => ({}),
    async run(_a, { ctx, userId, refs }) {
      const [plan, goals] = await Promise.all([goalsPlan(ctx, userId), ctx.col.goals.find({ userId, status: { $ne: 'cancelada' } }).toArray()]);
      return {
        sobraMensal: reais(plan.capacityMinor),
        livre: reais(plan.freeMinor),
        metas: goals.map((g) => {
          const p = plan.goals.find((x) => x.goalId === g._id.toHexString());
          return {
            ref: refFor(refs, 'M', g._id.toHexString()),
            nome: g.name,
            alvo: reais(g.targetMinor),
            guardado: reais(g.savedMinor),
            prazo: g.deadline,
            aporteMensal: reais(g.monthlyContributionMinor),
            status: g.status ?? 'ativa',
            prioridade: g.score ?? null,
            situacao: p?.note ?? null,
          };
        }),
      };
    },
  },
  {
    name: 'listar_dividas',
    kind: 'leitura',
    description:
      'Todas as dívidas do mês: faturas de cartão em aberto, parcelamentos, gastos fixos e empréstimos (mesma lista das telas de Metas e Planejamento). Os empréstimos com juros vêm com referência D1, D2... em ordem de quitação (maior juro primeiro).',
    prepare: async () => ({}),
    async run(_a, { ctx, userId, refs }) {
      const [l, o] = await Promise.all([listLoans(ctx, userId), listObligations(ctx, userId)]);
      return {
        mes: o.month,
        totalDoMes: reais(o.monthTotalMinor),
        porTipo: { faturas: reais(o.byKind.fatura), parcelamentos: reais(o.byKind.parcelamento), gastosFixos: reais(o.byKind.fixo), emprestimos: reais(o.byKind.emprestimo) },
        saldoDevedorParcelasEEmprestimos: reais(o.remainingTotalMinor),
        itens: o.items.map((i) => ({
          tipo: i.kind,
          nome: i.name,
          valorNoMes: reais(i.monthMinor),
          vencimento: i.dueDate ?? (i.dueDay ? `dia ${i.dueDay}` : null),
          parcelasRestantes: i.remainingInstallments,
          faltaPagar: reais(i.remainingMinor),
          jaNaFatura: i.inInvoice,
          vencida: i.overdue,
        })),
        emprestimos: l.items.map((d) => ({
          ref: refFor(refs, 'D', d.id),
          credor: d.creditor,
          saldo: reais(d.balanceMinor),
          jurosMesPct: Math.round(d.monthlyRate * 10000) / 100,
          parcela: reais(d.installmentMinor),
          quitaEmMeses: d.payoffMonths,
          jurosAPagar: reais(d.totalInterestMinor),
          jurosEsteMes: reais(d.monthlyInterestMinor),
          jurosAltos: d.highInterest,
          ordemDeQuitacao: d.payoffRank,
        })),
      };
    },
  },
  {
    name: 'consultar_gastos',
    kind: 'leitura',
    description:
      'Quanto o usuário gastou num mês (AAAA-MM), no total ou numa categoria (ex.: mercado, educação, moradia). Use a data de hoje do contexto para converter "setembro", "mês passado" etc. Devolve o total, a quantidade e os estabelecimentos com mais gasto.',
    parameters: S.obj({ mes: S.str('Mês no formato AAAA-MM'), categoria: S.str('Categoria (nome ou chave). Vazio = todas') }, ['mes']),
    prepare: async (a) => parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM'), category: z.string().trim().max(40).optional() }), { month: a.mes, category: a.categoria || undefined }),
    async run(a, { ctx, userId }) {
      const { month, category } = a as { month: string; category?: string };
      const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      const cat = category ? CATEGORIES.find((c) => norm(c.key) === norm(category) || norm(c.label) === norm(category)) : undefined;
      if (category && !cat) throw new ToolError(`Categoria desconhecida. Use uma destas: ${SPEND.map((k) => categoryOf(k).label).join(', ')}.`);
      const tz = (await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.timezone': 1 } }))?.settings.timezone ?? 'America/Manaus';
      const { from, to } = monthRange(month, tz);
      const match = { userId, deletedAt: null, type: 'EXPENSE' as const, date: { $gte: from, $lt: to }, ...(cat ? { categoryKey: cat.key } : {}) };
      const [byCat, top] = await Promise.all([
        ctx.col.transactions.aggregate<{ _id: string | null; total: number; n: number }>([{ $match: match }, { $group: { _id: '$categoryKey', total: { $sum: '$amountMinor' }, n: { $sum: 1 } } }]).toArray(),
        ctx.col.transactions
          .aggregate<{ _id: string; total: number }>([{ $match: match }, { $group: { _id: { $ifNull: ['$merchant', '$description'] }, total: { $sum: '$amountMinor' } } }, { $sort: { total: 1 } }, { $limit: 5 }])
          .toArray(),
      ]);
      const total = -byCat.reduce((t, r) => t + r.total, 0);
      return {
        mes: month,
        categoria: cat?.label ?? 'todas',
        total: reais(total),
        quantidade: byCat.reduce((t, r) => t + r.n, 0),
        ...(cat ? {} : { porCategoria: byCat.map((r) => ({ categoria: categoryOf(r._id ?? 'outros').label, valor: reais(-r.total) })).sort((x, y) => (y.valor ?? 0) - (x.valor ?? 0)) }),
        principaisEstabelecimentos: top.map((t) => ({ nome: t._id, valor: reais(-t.total) })),
      };
    },
  },
  {
    name: 'consultar_planejamento',
    kind: 'leitura',
    description: 'Planejamento do mês: renda, dívidas do mês (faturas, parcelamentos, fixos, empréstimos), aportes das metas, limite de gastos variáveis e o que sobra. Use antes de sugerir valor mensal para uma meta.',
    prepare: async () => ({}),
    async run(_a, { ctx, userId }) {
      const [o, limit, plan] = await Promise.all([listObligations(ctx, userId), getLimit(ctx, userId), goalsPlan(ctx, userId)]);
      return {
        mes: o.month,
        renda: reais(limit.breakdown.incomeMinor),
        dividasDoMes: reais(o.monthTotalMinor),
        aportesMetas: reais(limit.breakdown.goalsMinor),
        limiteGastosVariaveis: reais(limit.limitMinor),
        gastoVariavelAteAgora: reais(limit.spentMinor),
        sobraMensalParaMetas: reais(plan.capacityMinor),
        livreParaNovaMeta: reais(plan.freeMinor),
      };
    },
  },
  {
    name: 'simular_compra',
    kind: 'calculo',
    description: 'Avalia uma compra (sem gravar): veredito APROVAR/ADIAR/RECUSAR com o número que justifica.',
    parameters: S.obj(
      {
        descricao: S.str('O que vai comprar'),
        valor: S.num('Valor em reais'),
        formaPagamento: S.enum(PAYMENT_METHODS, 'cash, installments, financed ou card'),
        parcelas: S.int('Número de parcelas (se parcelado ou financiado)'),
        jurosMesPct: S.num('Juros em % ao mês (financiado ou cartão)'),
        motivo: S.enum(GOAL_REASONS, 'Para que é'),
        urgencia: S.int('1 a 5'),
        estado: S.enum(MOODS, 'Como o usuário está: calmo, estressado, recompensa ou pressa'),
      },
      ['descricao', 'valor', 'formaPagamento', 'motivo', 'urgencia', 'estado'],
    ),
    prepare: async (a) =>
      parse(PurchaseRequestSchema, {
        description: a.descricao,
        priceMinor: cents(a.valor),
        payment: a.formaPagamento,
        installments: a.parcelas ?? null,
        monthlyRate: typeof a.jurosMesPct === 'number' ? a.jurosMesPct / 100 : null,
        reason: a.motivo,
        urgency: a.urgencia,
        mood: a.estado,
      }),
    async run(a, { ctx, userId }) {
      const e = await simulatePurchase(ctx, userId, a as never);
      return {
        veredito: e.verdict.toUpperCase(),
        frase: e.headline,
        explicacao: e.explanation,
        pesoNoMes: reais(e.monthImpactMinor),
        parcela: reais(e.installmentMinor),
        juros: reais(e.interestMinor),
        diasDeAtrasoDaMeta: e.goalDelayDays,
        meta: e.goalName,
        usoDaReserva: e.reservePlan ? { valor: reais(e.reservePlan.useMinor), mesesParaRecompor: e.reservePlan.months, porMes: reais(e.reservePlan.monthlyMinor) } : null,
      };
    },
  },
  {
    name: 'iniciar_meta',
    kind: 'sessao',
    description: 'Começa a entrevista de uma meta nova (nada é gravado como meta ainda). Devolve a referência R1 e as próximas perguntas.',
    parameters: S.obj({ tipo: S.enum(GOAL_KINDS, 'purchase, fixed (reserva), debt_payoff ou experience'), titulo: S.str('Nome da meta') }, ['tipo', 'titulo']),
    prepare: async (a) => parse(z.object({ kind: z.enum(GOAL_KINDS), title: z.string().trim().min(1).max(80) }), { kind: a.tipo, title: a.titulo }),
    async run(a, { ctx, userId, refs }) {
      const { kind, title } = a as { kind: (typeof GOAL_KINDS)[number]; title: string };
      const d = await createDraft(ctx, userId, kind, title);
      return { ref: refFor(refs, 'R', d.id), proximasPerguntas: d.next.map((q) => q.question), faltam: d.missing.length };
    },
  },
  {
    name: 'responder_meta',
    kind: 'sessao',
    description: 'Registra respostas da entrevista da meta (referência R1...). Devolve o que ainda falta perguntar.',
    parameters: S.obj({ ref: S.str('Referência do rascunho (R1...)'), ...ANSWER_PARAMS }, ['ref']),
    async prepare(a, { refs }) {
      const id = resolve(refs, 'R', a.ref);
      const pct = (v: unknown) => (typeof v === 'number' ? v / 100 : undefined);
      const answers = parse(
        GoalAnswersSchema,
        Object.fromEntries(
          Object.entries({
            targetMinor: cents(a.valor),
            priceResearched: a.pesquisouPreco,
            store: a.ondeComprar,
            paymentMethod: a.formaPagamento,
            cashDiscount: pct(a.descontoAVistaPct),
            installments: a.parcelas,
            monthlyRate: pct(a.jurosMesPct),
            urgency: a.urgencia,
            reason: a.motivo,
            alternative: a.alternativa,
            targetDate: a.dataAlvo,
            savedMinor: cents(a.valorGuardado),
            targetMonths: a.mesesDeReserva,
            monthlyCapacityMinor: cents(a.guardaPorMes),
            whereStored: a.ondeGuardar,
            liquidity: a.liquidez,
            loanId: a.divida !== undefined ? resolve(refs, 'D', a.divida) : undefined,
          }).filter(([, v]) => v !== undefined),
        ),
      );
      return { id, answers };
    },
    async run(a, { ctx, userId }) {
      const { id, answers } = a as { id: string; answers: z.infer<typeof GoalAnswersSchema> };
      const d = await answerDraft(ctx, userId, id, answers);
      return { faltam: d.missing.length, proximasPerguntas: d.next.map((q) => q.question), entrevistaCompleta: d.missing.length === 0 };
    },
  },
  {
    name: 'diagnosticar_meta',
    kind: 'calculo',
    description: 'Com a entrevista completa, calcula veredito, prioridade e até 3 cenários (no-prazo, adiar, reduzir, pausar).',
    parameters: S.obj({ ref: S.str('Referência do rascunho (R1...)') }, ['ref']),
    prepare: async (a, { refs }) => resolve(refs, 'R', a.ref),
    async run(id, { ctx, userId }) {
      const d = await diagnoseDraft(ctx, userId, id as string);
      const x = d.diagnosis!;
      return {
        veredito: x.verdict.toUpperCase(),
        justificativa: x.rationale,
        valorDaMeta: reais(x.targetMinor),
        precisaPorMes: reais(x.requiredMonthlyMinor),
        livreNoMes: reais(x.freeMinor),
        prioridade: Math.round(x.score * 100),
        cenarios: x.scenarios.map((s) => ({ chave: s.key, rotulo: s.label, valor: reais(s.targetMinor), ate: s.targetDate, porMes: reais(s.monthlyMinor), nota: s.note })),
      };
    },
  },
  {
    name: 'criar_meta',
    kind: 'escrita',
    description: 'Cria a meta com o cenário escolhido pelo usuário (depois do diagnóstico).',
    parameters: S.obj({ ref: S.str('Referência do rascunho (R1...)'), cenario: S.enum(['no-prazo', 'adiar', 'reduzir', 'pausar'], 'Cenário escolhido') }, ['ref', 'cenario']),
    async prepare(a, { ctx, userId, refs }) {
      const id = resolve(refs, 'R', a.ref);
      const key = parse(z.enum(['no-prazo', 'adiar', 'reduzir', 'pausar']), a.cenario);
      const d = await ctx.col.goalDrafts.findOne({ _id: new ObjectId(id), userId });
      const sc = d?.diagnosis?.scenarios.find((s) => s.key === key);
      if (!d || d.status !== 'em-analise' || !sc) throw new ToolError('Faça o diagnóstico e use um dos cenários propostos.');
      return { id, key, title: d.title, sc };
    },
    async summary(a) {
      const { title, sc } = a as { title: string; sc: { label: string; targetMinor: number; targetDate: string; monthlyMinor: number } };
      return `Criar a meta “${title}”: ${brl(sc.targetMinor)} até ${sc.targetDate.split('-').reverse().join('/')}, guardando ${brl(sc.monthlyMinor)} por mês (cenário ${sc.label}).`;
    },
    async run(a, { ctx, userId, refs }) {
      const { id, key } = a as { id: string; key: 'no-prazo' };
      const r = await confirmDraft(ctx, userId, id, key);
      return { criada: true, ref: refFor(refs, 'M', r.goalId) };
    },
  },
  {
    name: 'atualizar_meta',
    kind: 'escrita',
    description: 'Registra um valor guardado a mais numa meta (o Plutão não move dinheiro).',
    parameters: S.obj({ ref: S.str('Referência da meta (M1...)'), valorGuardado: S.num('Quanto guardou agora, em reais') }, ['ref', 'valorGuardado']),
    async prepare(a, { ctx, userId, refs }) {
      const id = resolve(refs, 'M', a.ref);
      const add = parse(z.number().int().positive('Valor precisa ser positivo').max(1e12), cents(a.valorGuardado));
      const g = await ctx.col.goals.findOne({ _id: new ObjectId(id), userId });
      if (!g) throw new ToolError('Meta não encontrada.');
      return { id, add, name: g.name };
    },
    summary: async (a) => `Registrar ${brl((a as { add: number }).add)} guardados na meta “${(a as { name: string }).name}”.`,
    async run(a, { ctx, userId }) {
      const { id, add } = a as { id: string; add: number };
      await ctx.col.goals.updateOne({ _id: new ObjectId(id), userId }, { $inc: { savedMinor: add }, $set: { updatedAt: new Date() } });
      return { registrado: true };
    },
  },
  ...(['pausar_meta', 'retomar_meta'] as const).map(
    (name): Tool => ({
      name,
      kind: 'escrita',
      description: name === 'pausar_meta' ? 'Pausa uma meta (deixa de receber aporte e sai do limite).' : 'Retoma uma meta pausada (só se o aporte couber na sobra).',
      parameters: S.obj({ ref: S.str('Referência da meta (M1...)') }, ['ref']),
      async prepare(a, { ctx, userId, refs }) {
        const id = resolve(refs, 'M', a.ref);
        const g = await ctx.col.goals.findOne({ _id: new ObjectId(id), userId });
        if (!g) throw new ToolError('Meta não encontrada.');
        return { id, name: g.name };
      },
      summary: async (a) => `${name === 'pausar_meta' ? 'Pausar' : 'Retomar'} a meta “${(a as { name: string }).name}”.`,
      async run(a, { ctx, userId }) {
        await setGoalStatus(ctx, userId, (a as { id: string }).id, name === 'pausar_meta' ? 'pausada' : 'ativa');
        return { feito: true };
      },
    }),
  ),
  {
    name: 'criar_gasto_fixo',
    kind: 'escrita',
    description: 'Cadastra um gasto fixo (aparece na tela Gastos fixos).',
    parameters: S.obj(FIXED_PARAMS, ['nome', 'categoria', 'valor', 'diaVencimento', 'recorrencia']),
    prepare: async (a) => parse(CreateFixedExpenseSchema, { ...fixedBody(a), source: 'chat' }),
    summary: async (b) => `Cadastrar gasto fixo: ${fixedText(b as never)}.`,
    async run(b, { ctx, userId, refs }) {
      const f = await createFixed(ctx, userId, b as never);
      return { criado: true, ref: refFor(refs, 'F', f.id) };
    },
  },
  {
    name: 'editar_gasto_fixo',
    kind: 'escrita',
    description: 'Altera campos de um gasto fixo (referência F1...).',
    parameters: S.obj({ ref: S.str('Referência do gasto (F1...)'), ...FIXED_PARAMS }, ['ref']),
    async prepare(a, { ctx, userId, refs }) {
      const id = resolve(refs, 'F', a.ref);
      const body = parse(UpdateFixedExpenseSchema, fixedBody(a));
      const f = await ctx.col.fixedExpenses.findOne({ _id: new ObjectId(id), userId, deletedAt: null });
      if (!f) throw new ToolError('Gasto fixo não encontrado.');
      return { id, body, name: f.name };
    },
    summary: async (a) => `Alterar o gasto fixo “${(a as { name: string }).name}”: ${fixedText((a as { body: never }).body)}.`,
    async run(a, { ctx, userId }) {
      const { id, body } = a as { id: string; body: never };
      await updateFixed(ctx, userId, id, body);
      return { alterado: true };
    },
  },
  {
    name: 'remover_gasto_fixo',
    kind: 'escrita',
    description: 'Remove um gasto fixo (referência F1...).',
    parameters: S.obj({ ref: S.str('Referência do gasto (F1...)') }, ['ref']),
    async prepare(a, { ctx, userId, refs }) {
      const id = resolve(refs, 'F', a.ref);
      const f = await ctx.col.fixedExpenses.findOne({ _id: new ObjectId(id), userId, deletedAt: null });
      if (!f) throw new ToolError('Gasto fixo não encontrado.');
      return { id, name: f.name, amountMinor: f.amountMinor };
    },
    summary: async (a) => `Remover o gasto fixo “${(a as { name: string }).name}” (${brl((a as { amountMinor: number }).amountMinor)}).`,
    async run(a, { ctx, userId }) {
      await removeFixed(ctx, userId, (a as { id: string }).id);
      return { removido: true };
    },
  },
  {
    name: 'registrar_contestacao',
    kind: 'escrita',
    description: 'Registra que o usuário contesta um veredito ou cálculo do Plutão (fica para revisão).',
    parameters: S.obj({ assunto: S.str('Sobre o que é a contestação'), texto: S.str('O que o usuário disse') }, ['assunto', 'texto']),
    prepare: async (a) => parse(z.object({ subject: z.string().trim().min(1).max(120), text: z.string().trim().min(1).max(1000) }), { subject: a.assunto, text: a.texto }),
    summary: async (a) => `Registrar sua contestação sobre “${(a as { subject: string }).subject}” para revisão.`,
    async run(a, { ctx, userId }) {
      const { subject, text } = a as { subject: string; text: string };
      await ctx.col.agentContestations.insertOne({ _id: new ObjectId(), userId, subject, text, createdAt: new Date() });
      return { registrada: true };
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const toolDeclarations = (): LlmTool[] => TOOLS.map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? { parameters: t.parameters } : {}) }));
