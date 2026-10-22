/**
 * LLM (secao 5.7 e doc. Pluton 7): redige e, no agente, propoe chamadas de ferramenta. Os numeros
 * vem das ferramentas; o modelo nao calcula nem acessa o banco. Fronteira isolada para trocar de provedor.
 */
export interface LlmPart {
  text?: string;
  thought?: boolean;
  /** Assinatura do raciocinio (Gemini 2.5): precisa voltar junto com a chamada de ferramenta. */
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
export interface LlmContent {
  role: 'user' | 'model';
  parts: LlmPart[];
}
/** Declaracao de ferramenta (subconjunto OpenAPI aceito pelo Gemini). */
export interface LlmTool {
  name: string;
  description: string;
  parameters?: object;
}

export interface Llm {
  /** json: resposta em JSON conforme responseSchema (o chamador ainda valida com zod, RN-I03). */
  generate(input: { system: string; prompt: string; json?: { responseSchema: object } }): Promise<string>;
  /** Conversa com ferramentas: devolve as partes da resposta do modelo (texto e/ou chamadas). */
  chat?(input: { system: string; contents: LlmContent[]; tools: LlmTool[] }): Promise<LlmPart[]>;
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: { content?: { parts?: LlmPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** Sobrecarga e limite de taxa sao passageiros: vale tentar de novo ou usar o modelo reserva. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createGemini(opts: { apiKey: string; model: string; fallbackModel?: string; timeoutMs?: number }): Llm {
  async function post(body: object): Promise<GeminiResponse> {
    const attempts = [opts.model, opts.model, ...(opts.fallbackModel && opts.fallbackModel !== opts.model ? [opts.fallbackModel] : [])];
    let res: Response | null = null;
    for (const [i, model] of attempts.entries()) {
      if (i > 0) await sleep(i === 1 ? 800 : 0);
      res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // Chave no header, nunca na URL (URLs acabam em logs).
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
      });
      if (!RETRYABLE.has(res.status)) break;
    }
    // Corpo de erro do provedor nao e repassado: pode ecoar o prompt com dados financeiros.
    if (!res!.ok) throw new Error(`Gemini respondeu ${res!.status}`);
    return (await res!.json()) as GeminiResponse;
  }
  const blocked = (data: GeminiResponse) => `Gemini sem resposta (${data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? 'vazio'})`;

  return {
    async generate({ system, prompt, json }) {
      const data = await post({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
          ...(json ? { responseMimeType: 'application/json', responseSchema: json.responseSchema } : {}),
        },
      });
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought && p.text)
        .map((p) => p.text)
        .join('')
        .trim();
      if (!text) throw new Error(blocked(data));
      return text;
    },

    async chat({ system, contents, tools }) {
      const data = await post({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: tools }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      });
      // Pensamentos nao voltam para a conversa; as assinaturas vem nas proprias partes de chamada.
      const parts = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && (p.text?.trim() || p.functionCall));
      if (!parts.length) throw new Error(blocked(data));
      return parts;
    },
  };
}
