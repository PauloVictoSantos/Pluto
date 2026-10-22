import type { AgentChatState } from '@pluto/shared';
import { ObjectId } from 'mongodb';
import type { AppContext } from '../../../context';
import type { AgentSessionDoc } from '../../../db/collections';
import type { LlmContent, LlmPart } from '../../../integrations/llm/gemini';
import { audit } from '../../../lib/audit';
import { AppError } from '../../../lib/errors';
import { recalcLimit } from '../limit';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './prompt';
import { TOOL_BY_NAME, ToolError, toolDeclarations, type Refs } from './tools';

// Orquestrador do Plutao (doc. Pluton 7.2): carrega a sessao, deixa o modelo responder ou propor
// ferramentas, executa leitura/calculo direto e segura toda escrita ate um "sim" explicito. O estado
// da sessao (conversa, referencias, acao pendente) fica criptografado no banco.

const MAX_ROUNDS = 5;
const MAX_CONTENTS = 40;
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

async function available(ctx: AppContext, userId: ObjectId) {
  if (!ctx.llm?.chat) return false;
  const u = await ctx.col.users.findOne({ _id: userId }, { projection: { 'settings.aiEnabled': 1 } });
  return u?.settings.aiEnabled !== false;
}

export async function chatState(ctx: AppContext, userId: ObjectId): Promise<AgentChatState> {
  const { state } = await load(ctx, userId);
  return { messages: state.transcript, pending: state.pending && { tool: state.pending.tool, summary: state.pending.summary }, available: await available(ctx, userId) };
}

export async function resetChat(ctx: AppContext, userId: ObjectId) {
  await ctx.col.agentSessions.deleteMany({ userId });
  return chatState(ctx, userId);
}

/** Guardrail de saida (basico; reforcado na etapa 9): sem links, IDs internos nem trechos do prompt. */
export function sanitizeReply(text: string): string {
  if (/REGRAS ABSOLUTAS|Você é o Plutão, agente financeiro do Pluton/i.test(text)) return 'Isso eu não compartilho. Voltando ao seu plano: em que posso ajudar?';
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[link removido]')
    .replace(/\b[a-f0-9]{24}\b/gi, '[id]')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
}

/** Mensagem do usuario na conversa do modelo (junta com a resposta de ferramenta pendente, se houver). */
function pushUser(contents: LlmContent[], part: LlmPart) {
  const last = contents[contents.length - 1];
  if (last?.role === 'user') last.parts.push(part);
  else contents.push({ role: 'user', parts: [part] });
}

/** Mantem as ultimas mensagens, sempre comecando num turno de texto do usuario. */
function trim(contents: LlmContent[]) {
  if (contents.length <= MAX_CONTENTS) return contents;
  let i = contents.length - MAX_CONTENTS;
  while (i < contents.length && !(contents[i]!.role === 'user' && contents[i]!.parts.some((p) => p.text))) i++;
  return contents.slice(i);
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
  const { doc, state } = await load(ctx, userId);
  const at = () => new Date().toISOString();
  state.transcript.push({ role: 'user', text: message, at: at() });
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
    if (YES.test(message)) {
      pushUser(state.contents, { text: message });
      const text = await runWrite(ctx, userId, state, ip);
      state.pending = null;
      return reply(text);
    }
    if (NO.test(message)) {
      pushUser(state.contents, { text: message });
      state.pending = null;
      return reply('Cancelado. Nada foi gravado. O que você quer fazer agora?');
    }
    // Outra mensagem: a acao pendente cai e a conversa segue.
    pushUser(state.contents, { text: '(A ação proposta não foi confirmada e foi cancelada.)' });
    state.pending = null;
  }

  if (!(await available(ctx, userId))) throw new AppError(503, 'LLM_NOT_CONFIGURED', 'O Plutão precisa da IA ligada. Ative em Configurações.');
  pushUser(state.contents, { text: message });
  const env = { ctx, userId, refs: state.refs };

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
      const text = parts.map((p) => p.text ?? '').join('').trim();
      state.contents.pop(); // a resposta final entra ja filtrada, em reply()
      return reply(text || 'Pode repetir de outro jeito?');
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
          respond({ status: 'aguardando confirmação do usuário', resumo: summary });
        } else respond(await tool.run(prepared, env));
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
