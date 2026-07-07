// The one concrete ModelClient implementation: Anthropic's frontier model.
//
// This is the ONLY file in the codebase that imports a provider SDK. Everything
// else — the loop, the run endpoint — goes through getModelClient() and the
// ModelClient interface (constitution C6). Keep this file thin: all the
// swappability lives in the interface + factory, not here.

import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRequest, ModelResponse } from "./types";

/** v1 default — the frontier model. Overridable via DAYDREAM_MODEL so swapping
 *  the model is a config change, not a code change. */
export const DEFAULT_DAYDREAM_MODEL = "claude-opus-4-8";

export function createAnthropicClient(opts?: {
  model?: string;
  apiKey?: string;
}): ModelClient {
  const model = opts?.model ?? process.env.DAYDREAM_MODEL ?? DEFAULT_DAYDREAM_MODEL;
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — the daydream loop needs a model API key. " +
        "Add it to .env.local (see .env.local.example)."
    );
  }
  const sdk = new Anthropic({ apiKey });

  return {
    id: `anthropic:${model}`,
    async complete(req: ModelRequest): Promise<ModelResponse> {
      const res = await sdk.messages.create({
        model,
        max_tokens: req.maxTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      // Concatenate text blocks; control-flow narrowing avoids depending on a
      // named block type. (Opus 4.8: no temperature/top_p/budget_tokens — the
      // minimal request above stays within its supported surface.)
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return {
        text,
        usage: {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
        },
      };
    },
  };
}
