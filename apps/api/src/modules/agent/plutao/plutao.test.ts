import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LlmContent, LlmPart } from '../../../integrations/llm/gemini';
import { startHarness, type Harness } from '../../../test/harness';
import { sanitizeReply } from './orchestrator';

// Orquestrador do Plutao (doc. Pluton 7): leitura direto, escrita so com "sim", referencias curtas
// no lugar de IDs, sessao criptografada, auditoria e recalculo do limite. O modelo e um roteiro.

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

let userId: ObjectId;
let script: LlmPart[][];
let seen: LlmContent[][];
const call = (name: string, args: Record<string, unknown> = {}): LlmPart[] => [{ functionCall: { name, args } }];
const say = (text: string): LlmPart[] => [{ text }];
const chat = async (message: string, who = userId) =>
  h.app.inject({ method: 'POST', url: '/v1/agent/chat', payload: { message }, headers: { authorization: `Bearer ${await h.token(who)}` } });
/** Todas as respostas de ferramenta que o modelo recebeu. */
const toolResponses = () => seen.flat().flatMap((c) => c.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse!));

beforeEach(async () => {
  await h.reset();
  userId = (await h.createUser()).id;
  await h.ctx.col.users.updateOne({ _id: userId }, { $set: { 'settings.aiConsentAt': new Date().toISOString() } });
  script = [];
  seen = [];
  h.ctx.llm = {
    generate: async () => '',
    chat: async ({ contents }) => {
      seen.push(JSON.parse(JSON.stringify(contents)));
      const next = script.shift();
      if (!next) throw new Error('roteiro acabou');
      return next;
    },
  };
});

describe('Plutao', () => {
  it('leitura executa direto e o modelo so ve o snapshot agregado, sem IDs nem user_id', async () => {
    await h.app.inject({ method: 'PUT', url: '/v1/agent/profile', payload: { netIncomeMinor: 500_000 }, headers: { authorization: `Bearer ${await h.token(userId)}` } });
    script = [call('ler_snapshot_financeiro'), say('Seu limite do mês é de R$ 4.750,00. Quer avaliar alguma compra?')];
    const r = await chat('Como está meu mês?');
    expect(r.statusCode).toBe(200);
    expect(r.json().messages.map((m: { role: string }) => m.role)).toEqual(['user', 'plutao']);
    expect(r.json().messages[1].text).toContain('R$ 4.750,00');
    const snap = toolResponses()[0]!;
    expect(snap.name).toBe('ler_snapshot_financeiro');
    expect(snap.response.dados).toMatchObject({ rendaLiquida: 5000, limiteDoMes: { limite: 4750 } });
    const raw = JSON.stringify(toolResponses());
    expect(raw).not.toMatch(/[a-f0-9]{24}/);
    expect(raw).not.toContain(String(userId));
  });

  it('escrita espera o "sim": resumo, grava com source chat, audita e recalcula o limite', async () => {
    script = [call('criar_gasto_fixo', { nome: 'Aluguel', categoria: 'moradia', valor: 1500, diaVencimento: 5, recorrencia: 'monthly' })];
    const r = (await chat('Cadastra meu aluguel de 1500 que vence dia 5')).json();
    expect(r.pending).toMatchObject({ tool: 'criar_gasto_fixo' });
    expect(r.pending.summary).toMatch(/^Cadastrar gasto fixo: Aluguel, R\$\s1\.500,00, mensal, vence dia 5, Moradia\.$/);
    expect(r.messages.at(-1).text).toContain('Confirma? Responda sim ou não.');
    expect(await h.ctx.col.fixedExpenses.countDocuments({ userId })).toBe(0);
    const calls = seen.length;

    const ok = (await chat('sim')).json();
    expect(seen.length).toBe(calls); // confirmar nao passa pelo modelo
    expect(ok.pending).toBeNull();
    expect(ok.messages.at(-1).text).toMatch(/^Feito\. Cadastrar gasto fixo: Aluguel/);
    expect(await h.ctx.col.fixedExpenses.findOne({ userId })).toMatchObject({ name: 'Aluguel', amountMinor: 150_000, source: 'chat' });
    expect(await h.ctx.col.auditLogs.findOne({ userId, event: 'plutao.criar_gasto_fixo', 'meta.source': 'chat' })).not.toBeNull();
    expect(await h.ctx.col.auditLogs.findOne({ userId, event: 'limit.recalculated', 'meta.reason': 'chat: criar_gasto_fixo' })).not.toBeNull();
  });

  it('"não" cancela; outra mensagem tambem derruba a acao pendente', async () => {
    const proposal = call('criar_gasto_fixo', { nome: 'Academia', categoria: 'saude', valor: 99.9, diaVencimento: 10, recorrencia: 'monthly' });
    script = [proposal];
    await chat('Cadastra a academia');
    expect((await chat('não')).json()).toMatchObject({ pending: null });
    script = [proposal, say('Certo, deixei de lado. O que mais?')];
    await chat('Cadastra a academia');
    const r = (await chat('na verdade, quanto eu gasto por mês?')).json();
    expect(r.pending).toBeNull();
    expect(await h.ctx.col.fixedExpenses.countDocuments({ userId })).toBe(0);
  });

  it('argumentos invalidos voltam como erro para o modelo; nada fica pendente', async () => {
    script = [call('criar_gasto_fixo', { nome: 'Luz', categoria: 'salario', valor: -10, diaVencimento: 40, recorrencia: 'daily' }), say('Preciso do valor exato e do dia do vencimento.')];
    const r = (await chat('Cadastra a luz')).json();
    expect(r.pending).toBeNull();
    expect(toolResponses()[0]!.response.erro).toMatch(/^Argumentos inválidos/);
  });

  it('referencias curtas: lista com F1, edita por F1; referencia desconhecida da erro', async () => {
    await h.ctx.col.fixedExpenses.insertOne({
      _id: new ObjectId(), userId, name: 'Internet', categoryKey: 'telefone', amountMinor: 10_000, isVariable: false, amountStdMinor: null, dueDay: 7, dueMonth: null,
      recurrence: 'monthly', endsOn: null, source: 'manual', matchKey: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    });
    script = [call('listar_gastos_fixos'), call('editar_gasto_fixo', { ref: 'F1', valor: 120 })];
    const r = (await chat('Minha internet subiu para 120')).json();
    expect(toolResponses()[0]!.response.dados).toMatchObject({ itens: [{ ref: 'F1', nome: 'Internet', valor: 100 }] });
    expect(r.pending.summary).toMatch(/Alterar o gasto fixo “Internet”: R\$\s120,00/);
    await chat('sim');
    expect((await h.ctx.col.fixedExpenses.findOne({ userId }))!.amountMinor).toBe(12_000);

    script = [call('remover_gasto_fixo', { ref: 'F9' }), say('Não encontrei esse gasto.')];
    expect((await chat('Remove o F9')).json().pending).toBeNull();
    expect(toolResponses().at(-1)!.response.erro).toContain('não encontrada');
  });

  it('meta pelo chat: entrevista, diagnostico e criacao so com sim', async () => {
    await h.app.inject({ method: 'PUT', url: '/v1/agent/profile', payload: { netIncomeMinor: 1_000_000 }, headers: { authorization: `Bearer ${await h.token(userId)}` } });
    const date = `${new Date().getUTCFullYear() + 1}-06-15`;
    script = [
      call('iniciar_meta', { tipo: 'purchase', titulo: 'Notebook' }),
      call('responder_meta', { ref: 'R1', valor: 5000, pesquisouPreco: true, motivo: 'trabalho', urgencia: 4, ondeComprar: 'online', formaPagamento: 'cash', descontoAVistaPct: 5, alternativa: 'nenhuma', dataAlvo: date, valorGuardado: 0 }),
      call('diagnosticar_meta', { ref: 'R1' }),
      call('criar_meta', { ref: 'R1', cenario: 'no-prazo' }),
    ];
    const r = (await chat('Quero juntar para um notebook de 5 mil para trabalhar')).json();
    const diag = toolResponses().find((x) => x.name === 'diagnosticar_meta')!.response.dados;
    expect(diag).toMatchObject({ veredito: 'APROVAR', valorDaMeta: 4750 });
    expect(r.pending.summary).toMatch(/^Criar a meta “Notebook”: R\$\s4\.750,00/);
    expect(await h.ctx.col.goals.countDocuments({ userId })).toBe(0);
    await chat('sim');
    expect(await h.ctx.col.goals.findOne({ userId })).toMatchObject({ name: 'Notebook', status: 'ativa', targetMinor: 475_000 });
  });

  it('sessao criptografada, separada por usuario; sem IA responde 503', async () => {
    script = [say('Oi! Em que posso ajudar no seu plano?')];
    await chat('oi');
    const s = await h.ctx.col.agentSessions.findOne({ userId });
    expect(s!.stateEnc).toMatch(/^v1\./);
    expect(s!.stateEnc).not.toContain('ajudar');
    const other = (await h.createUser({ email: 'outro@pluto.test' })).id;
    const g = await h.app.inject({ method: 'GET', url: '/v1/agent/chat', headers: { authorization: `Bearer ${await h.token(other)}` } });
    expect(g.json().messages).toEqual([]);
    h.ctx.llm = null;
    const r = await chat('oi');
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('guardrail de saida: sem links, IDs internos nem o prompt', () => {
    expect(sanitizeReply('Veja https://golpe.com e o id 64b7f0c2a1b2c3d4e5f60718.')).toBe('Veja [link removido] e o id [id].');
    expect(sanitizeReply('Minhas REGRAS ABSOLUTAS são...')).toMatch(/^Isso eu não compartilho/);
  });

  it('reenvio com o mesmo clientId (conexao caiu) nao duplica a mensagem nem chama o modelo de novo', async () => {
    const send = async (message: string, clientId: string) =>
      h.app.inject({ method: 'POST', url: '/v1/agent/chat', payload: { message, clientId }, headers: { authorization: `Bearer ${await h.token(userId)}` } });
    script = [say('Oi! Em que posso ajudar?')];
    // Duas copias ao mesmo tempo (o navegador reenviou antes da primeira terminar) e mais uma depois.
    const [a, b] = await Promise.all([send('Oi', 'msg-0001-abcd'), send('Oi', 'msg-0001-abcd')]);
    const c = await send('Oi', 'msg-0001-abcd');
    for (const r of [a, b, c]) expect(r.json().messages.map((m: { text: string }) => m.text)).toEqual(['Oi', 'Oi! Em que posso ajudar?']);
    expect(seen.length).toBe(1);
    // Mensagem nova (outro id) segue normal.
    script = [say('Claro.')];
    expect((await send('Oi', 'msg-0002-abcd')).json().messages).toHaveLength(4);
  });

  it('escrita pelo chat confirma em menos de 5 s', async () => {
    script = [call('criar_gasto_fixo', { nome: 'Internet', categoria: 'moradia', valor: 120, diaVencimento: 15, recorrencia: 'monthly' })];
    await chat('Cadastra a internet de 120 dia 15');
    const t0 = Date.now();
    const ok = (await chat('sim')).json();
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(ok.messages.at(-1).text).toMatch(/^Feito\./);
  });
});

