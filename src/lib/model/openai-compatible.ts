// OpenAI-compatible ModelClient — covers OpenAI and OpenRouter (and any other
// provider exposing the /v1/chat/completions shape) with one thin fetch-based
// implementation. No SDK dependency: the request/response surface we use is
// tiny and stable.
//
// Like anthropic.ts, this is a provider edge — only ./index.ts imports it, and
// only behind getModelClient*(). The loop never sees it.

import type { ModelClient, ModelRequest, ModelResponse } from "./types";

type OpenAiCompatProvider = "openai" | "openrouter";

const BASE_URL: Record<OpenAiCompatProvider, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/** Sensible default model per provider when the caller doesn't override. */
const DEFAULT_MODEL: Record<OpenAiCompatProvider, string> = {
  openai: "gpt-4o",
  // OpenRouter routes to any model; a strong general default that exists there.
  openrouter: "anthropic/claude-3.7-sonnet",
};

export function createOpenAiCompatibleClient(opts: {
  provider: OpenAiCompatProvider;
  apiKey: string;
  model?: string;
}): ModelClient {
  const base = BASE_URL[opts.provider];
  const model = opts.model ?? process.env.DAYDREAM_MODEL ?? DEFAULT_MODEL[opts.provider];

  return {
    id: `${opts.provider}:${model}`,
    async complete(req: ModelRequest): Promise<ModelResponse> {
      // Map our provider-agnostic request to chat/completions: system prompt
      // becomes a leading {role:"system"} message.
      const messages: Array<{ role: string; content: string }> = [];
      if (req.system) messages.push({ role: "system", content: req.system });
      for (const m of req.messages) messages.push({ role: m.role, content: m.content });

      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
          // OpenRouter likes attribution headers; harmless on OpenAI.
          ...(opts.provider === "openrouter"
            ? { "HTTP-Referer": "https://arkive.app", "X-Title": "Arkive Daydream" }
            : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens,
          messages,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "<no body>");
        throw new Error(`${opts.provider} chat/completions ${res.status}: ${text.slice(0, 400)}`);
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      return {
        text,
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
