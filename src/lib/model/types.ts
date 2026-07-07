// The model-client boundary — provider-agnostic.
//
// The autonomous loop "thinks" by calling a frontier model. It must never see
// a provider SDK: it depends only on this interface (constitution C6). Swapping
// the model, or letting the user pick one, is a config change behind
// getModelClient() — never a refactor of the loop.
//
// Every implementation is wrapped by the metering layer (see ./index.ts) before
// it reaches a caller, so token accounting is by-construction, not opt-in.

/** A provider-agnostic chat-completion client. */
export interface ModelClient {
  /** Stable identifier recorded in the metering ledger, e.g.
   *  "anthropic:claude-opus-4-8". */
  readonly id: string;
  /** One completion. Throws on provider/transport errors (after SDK retries). */
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export type ModelMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ModelRequest = {
  /** Optional system prompt. */
  system?: string;
  /** Conversation turns. First turn must be "user". */
  messages: ModelMessage[];
  /** Hard ceiling on output tokens for this completion. */
  maxTokens: number;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ModelResponse = {
  /** Concatenated text of the response. */
  text: string;
  usage: ModelUsage;
};

/** One row of the per-run cost ledger (stored via internal-store). The user is
 *  implicit in the store path (currentUserId), so it is not duplicated here. */
export type MeteringEntry = {
  run_id: string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
};
