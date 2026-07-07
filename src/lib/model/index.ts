// The model-client factory + the metering boundary.
//
// getModelClient() is the ONLY way the rest of the app obtains a ModelClient.
// It always returns a client wrapped in MeteredModelClient, so it is
// impossible — by construction — to call the model without writing a cost-ledger
// entry. That is the whole point: metering lives at the interface boundary, not
// as an opt-in the loop could forget.
//
// Callers depend on this module and ./types only — never on ./anthropic or the
// provider SDK (constitution C6). Swapping providers means changing the one line
// below that picks the implementation.

import { writeInternal } from "@/lib/internal-store";
import { shortHash } from "@/lib/arkive-v2/paths";
import { createAnthropicClient } from "./anthropic";
import { createOpenAiCompatibleClient } from "./openai-compatible";
import { createStubModelClient } from "./stub";
import type { ModelClient, ModelRequest, ModelResponse, MeteringEntry } from "./types";

export type { ModelClient, ModelRequest, ModelResponse, ModelMessage, MeteringEntry } from "./types";

/** internal-store namespace for the per-run cost ledger. */
export const METERING_NAMESPACE = "daydream-runs";

export type GetModelClientOptions = {
  /** Run this completion is part of — stamped on each ledger entry. */
  runId?: string;
  /** Override the model id (else DAYDREAM_MODEL / the v1 default). */
  model?: string;
};

/**
 * Get a metered ModelClient. Every complete() call on the returned client
 * writes exactly one ledger entry under `_internal/daydream-runs/`. The loop
 * (CP3) calls this — it must never import a provider SDK directly (C6).
 */
export function getModelClient(opts?: GetModelClientOptions): ModelClient {
  // "stub" (via opts.model or DAYDREAM_MODEL=stub) routes to the zero-cost stub
  // for integration testing; anything else uses the real Anthropic client. The
  // stub is still wrapped in the metering boundary like any other client.
  const requested = opts?.model ?? process.env.DAYDREAM_MODEL;
  const inner = requested === "stub" ? createStubModelClient() : createAnthropicClient({ model: opts?.model });
  return new MeteredModelClient(inner, opts?.runId ?? "adhoc");
}

/**
 * Per-user metered ModelClient. PREFERS the user's stored active model key
 * (set on the /keys page) over the env key, so each user runs the daydream
 * loop on their OWN provider + credential. Falls back to the env-based
 * Anthropic client (or the stub) when the user has set no key — preserving
 * the original behavior for single-user / local setups.
 *
 * Resolution order:
 *   1. DAYDREAM_MODEL=stub or opts.model="stub" → stub (testing, no spend)
 *   2. user's active model key (anthropic / openai / openrouter) → that client
 *   3. env ANTHROPIC_API_KEY → anthropic client (legacy default)
 */
export async function getModelClientForUser(opts?: GetModelClientOptions): Promise<ModelClient> {
  const requested = opts?.model ?? process.env.DAYDREAM_MODEL;
  if (requested === "stub") {
    return new MeteredModelClient(createStubModelClient(), opts?.runId ?? "adhoc");
  }

  // Try the user's stored active key.
  try {
    const { currentUserId } = await import("@/lib/storage");
    const { getActiveModelKey } = await import("@/lib/model-keys");
    const uid = await currentUserId();
    const active = await getActiveModelKey(uid);
    if (active) {
      const inner = buildClientForProvider(active.provider, active.key, opts?.model);
      if (inner) return new MeteredModelClient(inner, opts?.runId ?? "adhoc");
      // Provider stored but no client impl yet → fall through to env.
    }
  } catch {
    // No user context / DB unavailable → fall through to env.
  }

  // Legacy env fallback.
  return new MeteredModelClient(createAnthropicClient({ model: opts?.model }), opts?.runId ?? "adhoc");
}

/** Construct the right provider client for a stored key. Returns null for
 *  providers we accept keys for but don't yet have a client implementation. */
function buildClientForProvider(provider: string, apiKey: string, model?: string): ModelClient | null {
  switch (provider) {
    case "anthropic":
      return createAnthropicClient({ apiKey, model });
    case "openai":
      return createOpenAiCompatibleClient({ provider: "openai", apiKey, model });
    case "openrouter":
      return createOpenAiCompatibleClient({ provider: "openrouter", apiKey, model });
    default:
      return null;
  }
}

/**
 * Wraps any ModelClient so every successful completion is metered. This is the
 * single place complete() is invoked on the underlying client — there is no
 * other path to the model, so no call can escape the ledger.
 */
class MeteredModelClient implements ModelClient {
  constructor(
    private readonly inner: ModelClient,
    private readonly runId: string
  ) {}

  get id(): string {
    return this.inner.id;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.inner.complete(req);
    // Metering is non-negotiable: a failure to record is surfaced (it throws),
    // not swallowed — there must be no silent path to an unmetered call.
    const createdAt = new Date().toISOString();
    const entry: MeteringEntry = {
      run_id: this.runId,
      model_id: this.inner.id,
      input_tokens: res.usage.inputTokens,
      output_tokens: res.usage.outputTokens,
      created_at: createdAt,
    };
    await writeInternal({
      namespace: METERING_NAMESPACE,
      id: `${createdAt.replace(/[:.]/g, "-")}-${shortHash()}`,
      meta: entry as unknown as Record<string, unknown>,
      body: "",
    });
    return res;
  }
}
