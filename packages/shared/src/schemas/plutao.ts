import { z } from 'zod';

// Chat com o Plutao (doc. Pluton 7). A escrita so acontece depois de um "sim" explicito: enquanto
// isso, a acao fica pendente e a tela mostra os botoes Sim / Nao.

export const AgentChatRequestSchema = z.object({ message: z.string().trim().min(1).max(1000) });

export const AgentMessageSchema = z.object({
  role: z.enum(['user', 'plutao']),
  text: z.string(),
  at: z.string(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const AgentChatStateSchema = z.object({
  messages: z.array(AgentMessageSchema),
  /** Acao de escrita aguardando confirmacao (resumo do que sera gravado). */
  pending: z.object({ tool: z.string(), summary: z.string() }).nullable(),
  /** IA ligada (chave configurada e "IA" ativa nas configuracoes). */
  available: z.boolean(),
  /** Consentimento para usar IA (LGPD): sem ele o Plutao nao conversa. */
  consent: z.boolean(),
});
export type AgentChatState = z.infer<typeof AgentChatStateSchema>;
