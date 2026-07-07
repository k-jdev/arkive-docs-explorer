// A zero-cost, no-API-key stub ModelClient for integration/plumbing tests.
//
// It implements the same ModelClient interface as the real Anthropic client and
// is selected by getModelClient() when the requested model is "stub" (e.g.
// DAYDREAM_MODEL=stub). It still flows through the metering wrapper, so the
// ledger path is exercised — just with fake (free) token counts.
//
// The stub is intentionally NOT smart. It reads the real file paths the loop
// hands it in the prompt (recent stream observations + prior daydreams) and
// weaves them into a few canned, daydream-shaped JSON objects so that the whole
// machinery — write, surfacing, recurrence/created_from, proposals, metering —
// gets driven through all its paths. Keep it permanently available; it makes
// the engine testable without burning API spend.

import type { ModelClient, ModelRequest, ModelResponse } from "./types";

export const STUB_MODEL_ID = "stub:daydream-v1";

export function createStubModelClient(): ModelClient {
  return {
    id: STUB_MODEL_ID,
    async complete(req: ModelRequest): Promise<ModelResponse> {
      const prompt = [req.system ?? "", ...req.messages.map((m) => m.content)].join("\n");

      const streamPaths = uniq(prompt.match(/arkive\/stream\/[^\s,)\]]+\.md/g) ?? []);
      const priorDaydreams = uniq(prompt.match(/arkive\/daydreams\/[^\s,)\]]+\.md/g) ?? []);
      const installed = parseInstalledPractices(prompt);
      const work = installed.find((p) => p === "work") ?? installed[0];
      const health = installed.find((p) => p === "health") ?? installed[1];

      // "cycle" differs run-to-run (0 priors on first run, >0 after) so titles —
      // and therefore the dated proposal filenames — don't collide across runs.
      const cycle = priorDaydreams.length;

      const text = buildStubDaydreams({ streamPaths, priorDaydreams, work, health, cycle });
      return {
        text,
        // Fake/free token counts derived from sizes — enough to exercise the
        // ledger + cost math; no real spend.
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(text.length / 4),
        },
      };
    },
  };
}

function buildStubDaydreams(args: {
  streamPaths: string[];
  priorDaydreams: string[];
  work?: string;
  health?: string;
  cycle: number;
}): string {
  const { streamPaths, priorDaydreams, work, health, cycle } = args;
  const strong = streamPaths.slice(0, 6);
  const medium = streamPaths.slice(6, 9);
  const subtle = streamPaths.slice(9, 11);

  const daydreams: unknown[] = [
    {
      // High confidence → should surface (>=0.7) AND propose (>=0.8).
      thought:
        "Hypothesis: a strong recurring pattern keeps showing up in the recent signal — it may be worth a durable note.",
      confidence: 0.85,
      practices: work ? [work] : [],
      evidence: strong,
      built_on: priorDaydreams.slice(0, 1), // extend a prior thought on later runs
      implies_insight: work
        ? {
            title: `Recurring pattern in ${work} (cycle ${cycle})`,
            summary:
              "The same situation recurs often enough that a small structural change might help. Proposed by the autonomous loop as a hypothesis for the human to judge.",
            proposed_output: "context",
            practice: work,
          }
        : null,
    },
    {
      // Medium confidence → should NOT surface, should NOT propose.
      thought:
        "Hypothesis: a medium-strength pattern might be forming, but the evidence is thinner — watch it.",
      confidence: 0.5,
      practices: health ? [health] : [],
      evidence: medium,
      built_on: [],
      implies_insight: null,
    },
    {
      // Low confidence, cross-cutting/untagged → should NOT surface or propose.
      thought:
        "Hypothesis: a faint cross-cutting thread connects a couple of unrelated-looking notes; too weak to act on.",
      confidence: 0.3,
      practices: [],
      evidence: subtle,
      built_on: priorDaydreams.slice(1, 2),
      implies_insight: null,
    },
  ];

  return JSON.stringify({ daydreams });
}

function parseInstalledPractices(prompt: string): string[] {
  const m = prompt.match(/INSTALLED PRACTICES[^:]*:\s*(.+)/);
  if (!m) return [];
  const tail = m[1].trim();
  if (tail.startsWith("(none")) return [];
  return tail
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
