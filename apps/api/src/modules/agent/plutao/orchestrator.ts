import type { AgentChatState } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../../context';
import type { AgentSessionDoc } from '../../../db/collections';
import type { LlmContent, LlmPart } from '../../../integrations/llm/gemini';
import { audit } from '../../../lib/audit';
import { AppError } from '../../../lib/errors';
import { recalcLimit } from '../limit';
import { REFUSAL, asData, classifyInput, dropSentencesWith, moneyIn, numbersIn, numbersOf, sanitizeReply, unverifiedMoney } from './guard';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './prompt';
import { TOOL_BY_NAME, ToolError, toolDeclarations, type Refs } from './tools';

export { sanitizeReply } from './guard';

// Orquestrador do Plutao (doc. Pluton 7.2): guardrail de entrada -> sessao -> modelo e ferramentas
// (leitura e calculo direto, escrita so com "sim") -> guardrail de saida (prompt, links, PII e
// numeros conferidos). O estado da sessao fica criptografado no banco.

const MAX_ROUNDS = 5;
const MAX_CONTENTS = 40;
/** Orcamento de contexto por sessao (~12 mil tokens). */
const MAX_CONTEXT_CHARS = 48_000;
/** 8.1: abuso de custo. Por minuto fica no rate limit da rota; por dia, aqui. */
export const DAILY_MESSAGES = 500;
const YES = /^\s*(sim|s|confirmo|confirmar|pode(\s+sim)?|pode gravar|ok|isso)\s*[.!]*\s*$/i;
const NO = /^\s*(n[aã]o|n|cancela|cancelar|deixa|esquece)\b/i;

interface Pending {
  tool: string;
  args: unknown;
  summary: string;
}
interface SessionState {
  contents: LlmContent[];
  transcript: { role: 'user' | 'plutao'; text: string; at: string }[];
  refs: Refs;
  pending: Pending | null;
}

const empty = (): SessionState => ({ contents: [], transcript: [], refs: {}, pending: null });

async function load(ctx: AppContext, userId: ObjectId) {
  const doc = await ctx.col.agentSessions.findOne({ userId }, { sort: { updatedAt: -1 } });
  const state: SessionState = doc ? (JSON.parse(ctx.crypto.decrypt(doc.stateEnc)) as SessionState) : empty();
  return { doc, state };
}

async function save(ctx: AppContext, userId: ObjectId, doc: AgentSessionDoc | null, state: SessionState) {
  const now = new Date();
  const stateEnc = ctx.crypto.encrypt(JSON.stringify(state));
  if (doc) await ctx.col.agentSessions.updateOne({ _id: doc._id }, { $set: { stateEnc, promptVersion: PROMPT_VERSION, updatedAt: now } });
  else await ctx.col.agentSessions.insertOne({ _id: new ObjectId(), userId, stateEnc, promptVersion: PROMPT_VERSION, createdAt: now, updatedAt: now });
}

async function aiStatus(ctx: AppContext, userId: ObjectId) {
  const u = await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.aiEnabled': 1, 'settings.aiConsentAt': 1 } });
  return { available: !!ctx.llm?.chat && u?.settings.aiEnabled !== false, consent: !!u?.settings.aiConsentAt };
}

export async function chatState(ctx: AppContext, userId: ObjectId): Promise<AgentChatState> {
  const { state } = await load(ctx, userId);
  return { messages: state.transcript, pending: state.pending && { tool: state.pending.tool, summary: state.pending.summary }, ...(await aiStatus(ctx, userId)) };
}

export async function resetChat(ctx: AppContext, userId: ObjectId) {
  await ctx.col.agentSessions.deleteMany({ userId });
  return chatState(ctx, userId);
}

/** 500 mensagens por dia por usuario (8.1). */
async function countMessage(ctx: AppContext, userId: ObjectId, now: Date) {
  const day = now.toISOString().slice(0, 10);
  const r = await ctx.col.agentUsage.findOneAndUpdate(
    { _id: `${userId.toHexString()}:${day}` },
    { $inc: { messages: 1 }, $setOnInsert: { userId, day, createdAt: now } },
    { upsert: true, returnDocument: 'after' },
  );
  if ((r?.messages ?? 0) > DAILY_MESSAGES) throw new AppError(429, 'DAILY_LIMIT', `Você chegou ao limite de ${DAILY_MESSAGES} mensagens por dia com o Plutão. Amanhã a conversa continua.`);
}

/** Mensagem do usuario na conversa do modelo (junta com a resposta de ferramenta pendente, se houver). */
function pushUser(contents: LlmContent[], part: LlmPart) {
  const last = contents[contents.length - 1];
  if (last?.role === 'user') last.parts.push(part);
  else contents.push({ role: 'user', parts: [part] });
}

/** Mantem as ultimas mensagens dentro do orcamento, sempre comecando num turno de texto do usuario. */
function trim(contents: LlmContent[]) {
  let out = contents.length > MAX_CONTENTS ? contents.slice(contents.length - MAX_CONTENTS) : contents;
  while (out.length > 2 && JSON.stringify(out).length > MAX_CONTEXT_CHARS) out = out.slice(2);
  let i = 0;
  while (i < out.length && !(out[i]!.role === 'user' && out[i]!.parts.some((p) => p.text))) i++;
  return out.slice(i);
}

/** Numeros que o Plutao pode falar: os das ferramentas, os que o usuario disse e os ja conferidos. */
function knownNumbers(state: SessionState): number[] {
  const known: number[] = [];
  for (const c of state.contents) for (const p of c.parts) if (p.functionResponse) numbersOf(p.functionResponse.response, known);
  for (const t of state.transcript) known.push(...(t.role === 'user' ? numbersIn(t.text) : moneyIn(t.text)));
  return known;
}

async function runWrite(ctx: AppContext, userId: ObjectId, state: SessionState, ip: string | null) {
  const p = state.pending!;
  const tool = TOOL_BY_NAME.get(p.tool)!;
  try {
    await tool.run(p.args, { ctx, userId, refs: state.refs });
    // Escrita feita pelo chat: mesma auditoria e o mesmo recalculo do limite das telas (GF-01, GF-05).
    await audit(ctx.col, `plutao.${p.tool}`, userId, { summary: p.summary, promptVersion: PROMPT_VERSION, source: 'chat' }, ip);
    await recalcLimit(ctx, userId, `chat: ${p.tool}`);
    return `Feito. ${p.summary} Quer ajustar mais alguma coisa no seu plano?`;
  } catch (e) {
    const msg = e instanceof AppError || e instanceof ToolError ? e.message : 'Não consegui gravar agora.';
    return `Não gravei: ${msg} Quer tentar de outro jeito?`;
  }
}

export async function sendMessage(ctx: AppContext, userId: ObjectId, message: string, ip: string | null): Promise<AgentChatState> {
  const now = new Date();
  const ai = await aiStatus(ctx, userId);
  // LGPD: sem consentimento explicito, nada vai para o provedor de IA.
  if (!ai.consent) throw new AppError(403, 'AI_CONSENT_REQUIRED', 'Para conversar com o Plutão, autorize o uso de IA.');
  await countMessage(ctx, userId, now);
  const { doc, state } = await load(ctx, userId);
  const at = () => new Date().toISOString();
  // Guardrail de entrada: PII mascarada antes de ir ao modelo e ao historico (8.3).
  const input = classifyInput(message);
  state.transcript.push({ role: 'user', text: input.text, at: at() });
  const reply = async (text: string) => {
    const clean = sanitizeReply(text);
    state.transcript.push({ role: 'plutao', text: clean, at: at() });
    state.contents.push({ role: 'model', parts: [{ text: clean }] });
    state.contents = trim(state.contents);
    state.transcript = state.transcript.slice(-60);
    await save(ctx, userId, doc, state);
    return chatState(ctx, userId);
  };

  // Acao pendente: so um "sim" explicito grava (GF-03, 7.2 passo 4). Nao precisa do modelo.
  if (state.pending) {
    if (YES.test(input.text)) {
      pushUser(state.contents, { text: input.text });
      const text = await runWrite(ctx, userId, state, ip);
      state.pending = null;
      return reply(text);
    }
    if (NO.test(input.text)) {
      pushUser(state.contents, { text: input.text });
      state.pending = null;
      return reply('Cancelado. Nada foi gravado. O que você quer fazer agora?');
    }
    // Outra mensagem: a acao pendente cai e a conversa segue.
    pushUser(state.contents, { text: '(A ação proposta não foi confirmada e foi cancelada.)' });
    state.pending = null;
  }

  // Injecao, dados de terceiros e fora de escopo: recusa curta, sem chamar o modelo (8.1).
  if (input.block) {
    await audit(ctx.col, 'plutao.guard', userId, { kind: input.block, promptVersion: PROMPT_VERSION }, ip);
    pushUser(state.contents, { text: '(Mensagem do usuário barrada pelo filtro de segurança.)' });
    return reply(REFUSAL[input.block]);
  }

  if (!ai.available) throw new AppError(503, 'LLM_NOT_CONFIGURED', 'O Plutão precisa da IA ligada. Ative em Configurações.');
  pushUser(state.contents, { text: input.text });
  if (input.noConfirmRequest) pushUser(state.contents, { text: '(Nota do sistema: gravar sem confirmação não é permitido. Toda escrita continua exigindo o "sim" do usuário.)' });
  const env = { ctx, userId, refs: state.refs };
  let checked = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let parts: LlmPart[];
    try {
      parts = await ctx.llm!.chat!({ system: SYSTEM_PROMPT, contents: state.contents, tools: toolDeclarations() });
    } catch {
      // Sem o conteudo no log: tem dados financeiros.
      throw new AppError(502, 'LLM_FAILED', 'O Plutão não respondeu agora. Tente de novo em instantes.');
    }
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      let text = parts.map((p) => p.text ?? '').join('').trim() || 'Pode repetir de outro jeito?';
      // "Nunca invente numeros": todo R$ precisa ter vindo de ferramenta ou do usuario.
      const bad = unverifiedMoney(text, knownNumbers(state));
      if (bad.length && !checked) {
        checked = true;
        state.contents.push({ role: 'model', parts: [{ text }] });
        pushUser(state.contents, { text: `(Verificação do sistema: os valores ${bad.map((v) => `R$ ${v}`).join(', ')} não vieram de nenhuma ferramenta nem do usuário. Refaça a resposta usando só números das ferramentas; se precisar de um dado, chame a ferramenta ou pergunte.)` });
        continue;
      }
      if (bad.length) {
        await audit(ctx.col, 'plutao.unverified_number', userId, { count: bad.length, promptVersion: PROMPT_VERSION }, ip);
        text = dropSentencesWith(text, bad);
      }
      return reply(text);
    }
    state.contents.push({ role: 'model', parts });
    const responses: LlmPart[] = [];
    for (const c of calls) {
      const { name, args = {} } = c.functionCall!;
      const tool = TOOL_BY_NAME.get(name);
      const respond = (response: Record<string, unknown>) => responses.push({ functionResponse: { name, response } });
      if (!tool) {
        respond({ erro: 'Ferramenta desconhecida.' });
        continue;
      }
      if (state.pending) {
        respond({ erro: 'Uma escrita por vez: aguarde a confirmação da anterior.' });
        continue;
      }
      try {
        const prepared = await tool.prepare(args, env);
        if (tool.kind === 'escrita') {
          const summary = await tool.summary!(prepared, env);
          state.pending = { tool: name, args: prepared, summary };
          respond({ status: 'aguardando confirmação do usuário', resumo: asData(summary) });
        }
        // Dados delimitados: o que vem do banco (nomes, descricoes) e dado, nunca instrucao (8.1).
        else respond({ dados: asData(await tool.run(prepared, env)) });
      } catch (e) {
        respond({ erro: e instanceof ToolError || e instanceof AppError ? e.message : 'Falha ao executar.' });
      }
    }
    state.contents.push({ role: 'user', parts: responses });
    if (state.pending) {
      await audit(ctx.col, 'plutao.write_proposed', userId, { tool: state.pending.tool, promptVersion: PROMPT_VERSION }, ip);
      const text = sanitizeReply(`${state.pending.summary}\n\nConfirma? Responda sim ou não.`);
      state.transcript.push({ role: 'plutao', text, at: at() });
      state.contents = trim(state.contents);
      await save(ctx, userId, doc, state);
      return chatState(ctx, userId);
    }
  }
  return reply('Não consegui concluir esse cálculo agora. Pode reformular o pedido?');
}
