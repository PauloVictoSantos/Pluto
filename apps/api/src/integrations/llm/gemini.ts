/**
 * LLM (secao 5.7): so redige a explicacao. Os numeros chegam prontos no prompt; o modelo nao
 * calcula nem acessa o banco. Fronteira isolada para trocar de provedor.
 */
export interface Llm {
  generate(input: { system: string; prompt: string }): Promise<string>;
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** Sobrecarga e limite de taxa sao passageiros: vale tentar de novo ou usar o modelo reserva. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createGemini(opts: { apiKey: string; model: string; fallbackModel?: string; timeoutMs?: number }): Llm {
  async function call(model: string, system: string, prompt: string): Promise<Response> {
    return fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      // Chave no header, nunca na URL (URLs acabam em logs).
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    });
  }

  return {
    async generate({ system, prompt }) {
      const attempts = [opts.model, opts.model, ...(opts.fallbackModel && opts.fallbackModel !== opts.model ? [opts.fallbackModel] : [])];
      let res: Response | null = null;
      for (const [i, model] of attempts.entries()) {
        if (i > 0) await sleep(i === 1 ? 800 : 0);
        res = await call(model, system, prompt);
        if (!RETRYABLE.has(res.status)) break;
      }
      // Corpo de erro do provedor nao e repassado: pode ecoar o prompt com dados financeiros.
      if (!res!.ok) throw new Error(`Gemini respondeu ${res!.status}`);
      const data = (await res!.json()) as GeminiResponse;
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought && p.text)
        .map((p) => p.text)
        .join('')
        .trim();
      if (!text) throw new Error(`Gemini sem resposta (${data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? 'vazio'})`);
      return text;
    },
  };
}
