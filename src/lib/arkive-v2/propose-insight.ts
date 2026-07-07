// The single propose-insight code path (constitution C5).
//
// Both the MCP `propose_insight` tool (human/in-chat loop) and the autonomous
// daydream loop file proposals through THIS function — there is exactly one
// place a pending insight is written, so the two paths can never drift.
//
// A proposal is just a plain insight in the practice's insights/pending/ folder
// (spec §5.3 — no Daydream-specific insight type). The human gate
// (decide_insight) is untouched and remains the only path to accepted/ (C4).

import { writeEntity, type WriteResult } from "./write-entity";
import { slugify, todayIso } from "./paths";

/** Where a proposal's evidence is grounded — recorded so each proposal is a
 *  self-describing training example (§5.4). Derivable from evidence paths. */
export type ProvenanceKind = "journal" | "daydream" | "mixed" | "none";

export type ProposeInsightArgs = {
  practice: string;
  /** Short title — becomes the filename slug. */
  title: string;
  /** One-paragraph description of the pattern (the insight body). */
  summary: string;
  /** Paths to the entries supporting this pattern. Must be real files. */
  evidence: string[];
  /** What this insight should produce on acceptance. */
  proposedOutput: "skill" | "context" | "both" | "ask_user";
  /** For a context/both insight: which declared context file it should land in
   *  on acceptance (e.g. "rules.md"). The placement judgment, made at
   *  propose-time. Omit ⇒ the accept path falls back to the practice's first
   *  accumulate (TRUTH) context file. */
  targetContextFile?: string;
  /** Optional upstream triggers. */
  triggeredBy?: string[];

  // ---- §5.4: loop self-description (only the autonomous loop sets these) ----
  /** The loop's own reasoning for proposing this. */
  loopReasoning?: string;
  /** The loop's confidence at propose time (0..1). */
  loopConfidence?: number;
  /** Whether the evidence is journal/stream-grounded vs daydream-grounded. */
  provenanceKind?: ProvenanceKind;
};

/**
 * File a candidate pattern as a pending insight. Returns the written path.
 * Identical on-disk shape regardless of caller — meta `{ status: "pending",
 * evidence, triggered_by, proposed_output }`, plus the optional §5.4 fields when
 * the loop supplies them.
 */
export async function proposeInsight(args: ProposeInsightArgs): Promise<WriteResult> {
  const slug = slugify(args.title);
  const subpath = `insights/pending/${todayIso()}-${slug}.md`;

  const meta: Record<string, unknown> = {
    status: "pending",
    evidence: args.evidence,
    triggered_by: args.triggeredBy ?? [],
    proposed_output: args.proposedOutput,
  };
  if (args.targetContextFile) meta.target_context_file = args.targetContextFile;
  // Self-describing example fields — recorded, not acted on in v1 (§7).
  if (args.loopReasoning) meta.loop_reasoning = args.loopReasoning;
  if (typeof args.loopConfidence === "number") meta.loop_confidence = args.loopConfidence;
  if (args.provenanceKind) meta.provenance_kind = args.provenanceKind;

  return writeEntity({
    practice: args.practice,
    entity_type: "insight",
    subpath,
    body: args.summary,
    meta,
  });
}

/** Derive provenance from evidence paths: does the grounding point at the
 *  daydream store, the stream/journal (fact), both, or nothing? (§5.4) */
export function deriveProvenanceKind(evidence: string[]): ProvenanceKind {
  let daydream = false;
  let fact = false;
  for (const p of evidence) {
    if (p.includes("/daydreams/")) daydream = true;
    else if (p.includes("/stream/") || p.includes("/journal/")) fact = true;
  }
  if (daydream && fact) return "mixed";
  if (daydream) return "daydream";
  if (fact) return "journal";
  return "none";
}
