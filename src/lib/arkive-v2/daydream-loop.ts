// The autonomous compound loop — Daydream's "think on a schedule, no human
// present" pass. This is the SAME loop the in-chat MCP path runs (record →
// notice → learn → improve), driven a second way (C5). It reuses the existing
// machinery — scanEmergence, the stream readers, the daydream store, and the
// single shared propose path — and adds no parallel pipeline.
//
// Hard invariants honored here:
//   - C1: works on a fresh arkive with zero practices (it still produces
//     cross-cutting, untagged daydreams).
//   - C2: practice-agnostic — no specific practice is named in code or prompt.
//   - C3: NEVER writes any practice's journal/. The loop only writes daydreams
//     (its own hypotheses store) and proposals into insights/pending/. It reads
//     the stream and prior daydreams; it does not construct a journal write path.
//   - C4: never moves an insight to accepted/, never mutates context/, never
//     creates a practice. Commit stays human-gated (decide_insight).
//   - C5: one model pass via getModelClient(); proposals go through the single
//     shared proposeInsight() that the MCP handler also uses.
//   - C6: the model is reached only through getModelClient() — no provider SDK.

import { readArkiveConfig } from "./arkive-config";
import { scanEmergence, type PatternCandidate } from "./emergence";
import { listObservations } from "./stream";
import {
  listDaydreams,
  writeDaydream,
  readDaydream,
  recordRecurrence,
  setSurfaced,
  setPromotedTo,
  type Daydream,
} from "./daydream";
import { listEntries } from "./write-entity";
import { proposeInsight, deriveProvenanceKind } from "./propose-insight";
import { getPracticeConfig } from "./practices";
import { getModelClientForUser } from "@/lib/model";
import { readInternal, writeInternal } from "@/lib/internal-store";

// ---- Run-to-run state: the observation high-water cursor --------------------
//
// The loop should reflect on what's NEW since it last ran, not re-chew the same
// recent observations every pass (which produced duplicate daydreams). We
// persist the created_at of the newest observation processed last run in the
// engine-internal store (a sibling of the cost ledger, hidden from the arkive
// UI). Next run only feeds observations strictly newer than that cursor; if
// there are none, the pass short-circuits without spending a model call.
const DAYDREAM_STATE_NS = "daydream-state";
const DAYDREAM_CURSOR_ID = "cursor";

async function getDaydreamCursor(): Promise<string | null> {
  try {
    const entry = await readInternal<{ last_observation_cursor?: string }>(
      DAYDREAM_STATE_NS,
      DAYDREAM_CURSOR_ID
    );
    const c = entry?.meta?.last_observation_cursor;
    return typeof c === "string" && c ? c : null;
  } catch {
    return null; // cursor I/O must never break a run — worst case we re-see a few obs
  }
}

async function saveDaydreamCursor(cursor: string, runId: string): Promise<void> {
  try {
    await writeInternal({
      namespace: DAYDREAM_STATE_NS,
      id: DAYDREAM_CURSOR_ID,
      meta: {
        last_observation_cursor: cursor,
        last_run_id: runId,
        last_run_at: new Date().toISOString(),
      },
      body: "",
    });
  } catch {
    /* best-effort — a failed cursor write only means the next run re-sees a few obs */
  }
}

// ---- Tunable v1 constants (named so they're easy to find + adjust later) ----

/** A daydream surfaces as a read-only Notice if EITHER bar is cleared. */
// Recalibrated 2026-06-17 (was 0.7 / 3): a real Opus run rated its own daydreams
// 0.42–0.62, so the 0.7 bar surfaced nothing even for strong, well-grounded
// thoughts. Lowered to separate good from weak rather than to lower everything.
const SURFACE_CONFIDENCE_THRESHOLD = 0.55;
const SURFACE_RECURRENCE_THRESHOLD = 2;
/** Only daydreams this confident may imply a durable-structure proposal.
 *  Lowered 2026-06-17 (was 0.8): the 0.8 bar was stub-calibrated (the stub
 *  hard-codes 0.85); a real Opus run never rated its own daydreams above ~0.62,
 *  so nothing ever proposed. 0.6 is the calibration-matrix test bar — see
 *  docs/DAYDREAM_CALIBRATION_MATRIX.md. Surfacing (0.55 / 2) is held fixed. */
const PROPOSE_CONFIDENCE_THRESHOLD = 0.6;

/** Shortlist caps — the expensive model only ever sees this much, never the
 *  raw firehose (cost + quality scaffold). */
const MAX_OBSERVATIONS = 40;
const MAX_PRIOR_DAYDREAMS = 30;
const MAX_FEEDBACK = 20;
const MAX_EMERGENCE_CANDIDATES = 20;
const BODY_SNIPPET = 280;
/** Output ceiling for the single think pass (well under the no-stream limit). */
const MODEL_MAX_TOKENS = 8000;

export type DaydreamPassResult = {
  runId: string;
  daydreamsWritten: number;
  surfaced: number;
  proposed: number;
  /** Proposals that threw (e.g. a same-day slug collision) and were skipped.
   *  A failed proposal never aborts the pass — the daydream is still kept. */
  proposeFailures: number;
  recurrencesRecorded: number;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Set when the model returned nothing parseable — pass still succeeds. */
  note?: string;
};

/** Live progress emitted during a pass so a streaming caller can show real
 *  status (not a fake spinner). Phases fire in order:
 *    reading → context → thinking → writing → wrote* .
 *  The terminal done/error envelope is added by the HTTP layer, not here. The
 *  one slow phase is `thinking` (a single opaque model call); `wrote` ticks
 *  once per daydream actually written, giving honest "N of M" progress. */
export type DaydreamProgress =
  | { phase: "reading" }
  | {
      phase: "context";
      observations: number;
      priorDaydreams: number;
      candidates: number;
      feedback: number;
      practices: number;
    }
  | { phase: "thinking"; modelId: string }
  | { phase: "writing"; total: number }
  | { phase: "wrote"; index: number; total: number; surfaced: number; proposed: number };

/** v1 surfacing rule — DERIVED from salience, stored as its own field (§5.1). */
function deriveSurfaced(confidence: number, recurrence: number): boolean {
  return confidence >= SURFACE_CONFIDENCE_THRESHOLD || recurrence >= SURFACE_RECURRENCE_THRESHOLD;
}

/** Run one autonomous pass for the current user. */
export async function runDaydreamPass(opts: {
  runId: string;
  /** Optional progress sink — best-effort, called synchronously at each phase
   *  boundary so a streaming caller can surface live status. Never affects the
   *  pass: a throwing handler is swallowed. */
  onProgress?: (ev: DaydreamProgress) => void;
}): Promise<DaydreamPassResult> {
  const { runId } = opts;
  const emit = (ev: DaydreamProgress) => {
    try {
      opts.onProgress?.(ev);
    } catch {
      /* progress is best-effort; a sink failure must never abort the pass */
    }
  };

  emit({ phase: "reading" });

  // 1. Pre-rank with ZERO tokens — assemble a shortlist the model can chew on.
  const cfg = await readArkiveConfig();
  const installedPractices = Object.entries(cfg.practices)
    .filter(([, reg]) => reg.enabled)
    .map(([name]) => name); // [] on a fresh arkive — C1

  // Only consider observations NEWER than the last run's high-water mark.
  const cursor = await getDaydreamCursor();

  const [emergence, rawObservations, priorDaydreams] = await Promise.all([
    scanEmergence({ installed_practice_names: installedPractices, limit: 400 }),
    listObservations({ since: cursor ?? undefined, limit: MAX_OBSERVATIONS, withBody: true }),
    listDaydreams({ limit: MAX_PRIOR_DAYDREAMS, withBody: true }),
  ]);
  // `since` is inclusive; drop the boundary observation we already processed so
  // the loop never re-evaluates a file. ISO-8601 strings compare chronologically.
  const observations = cursor
    ? rawObservations.filter((o) => o.meta.created_at > cursor)
    : rawObservations;

  // Nothing new since last run → don't re-chew old files, and don't spend a
  // model call. The pass succeeds with a note; the cursor is left untouched.
  if (observations.length === 0) {
    emit({
      phase: "context",
      observations: 0,
      priorDaydreams: priorDaydreams.length,
      candidates: 0,
      feedback: 0,
      practices: installedPractices.length,
    });
    return {
      runId,
      daydreamsWritten: 0,
      surfaced: 0,
      proposed: 0,
      proposeFailures: 0,
      recurrencesRecorded: 0,
      modelId: "(no model call)",
      usage: { inputTokens: 0, outputTokens: 0 },
      note: cursor
        ? "No new observations since the last daydream — nothing new to think about."
        : "No observations in the stream yet — capture something first.",
    };
  }

  // The high-water mark to persist once these observations are consumed. The
  // list is newest-first, so [0] is the newest. (A backlog larger than the cap
  // prioritizes the freshest signal; the loop is a reflection sampler, not a
  // complete-coverage pass.)
  const newestObservationCursor = observations[0].meta.created_at;

  // 2. Load recent feedback (accept/reject) so the loop adapts within this run.
  const feedback = await gatherRecentFeedback(installedPractices, MAX_FEEDBACK);

  // 2b. Each installed practice's declared context files, so the model can
  //     pick a target_context_file for context/both proposals (placement =
  //     judgment). Files default to "replace"; "accumulate" files are the
  //     homes for accepted conclusions.
  const practiceContextFiles = await Promise.all(
    installedPractices.map(async (name) => {
      const pcfg = await getPracticeConfig(name);
      return {
        practice: name,
        files: (pcfg?.provides.context_files ?? []).map((f) => ({
          name: f.name,
          update_mode: (f.update_mode ?? "replace") as "replace" | "accumulate",
          purpose: f.purpose,
        })),
      };
    })
  );

  emit({
    phase: "context",
    observations: observations.length,
    priorDaydreams: priorDaydreams.length,
    candidates: Math.min(emergence.pattern_candidates.length, MAX_EMERGENCE_CANDIDATES),
    feedback: feedback.length,
    practices: installedPractices.length,
  });

  // 3. Think — one model pass (C5/C6). The prompt frames daydreams as
  //    hypotheses (C3) and never names a specific practice (C2).
  //    Per-user: prefers the user's stored active model key (set on /keys)
  //    over the env key, falling back to env when none is set.
  const client = await getModelClientForUser({ runId });
  const system = buildSystemPrompt();
  const user = buildUserPrompt({
    installedPractices,
    practiceContextFiles,
    candidates: emergence.pattern_candidates.slice(0, MAX_EMERGENCE_CANDIDATES),
    observations,
    priorDaydreams,
    feedback,
  });

  // The single slow, opaque step — surface it so the UI can show an elapsed clock.
  emit({ phase: "thinking", modelId: client.id });

  const res = await client.complete({
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: MODEL_MAX_TOKENS,
  });

  // These observations are now consumed — advance the cursor so the next run
  // starts strictly after them, regardless of how the parse below turns out.
  await saveDaydreamCursor(newestObservationCursor, runId);

  const parsed = parseModelDaydreams(res.text);
  emit({ phase: "writing", total: parsed.length });

  const result: DaydreamPassResult = {
    runId,
    daydreamsWritten: 0,
    surfaced: 0,
    proposed: 0,
    proposeFailures: 0,
    recurrencesRecorded: 0,
    modelId: client.id,
    usage: res.usage,
  };
  if (parsed.length === 0) {
    result.note = "model returned no parseable daydreams";
    return result;
  }

  const priorByPath = new Map(priorDaydreams.map((d) => [d.path, d] as const));
  const installedSet = new Set(installedPractices);

  // 4–6. Write daydreams, record recurrence, derive surfaced, propose the few.
  for (const md of parsed) {
    const thought = (md.thought ?? "").trim();
    if (!thought) continue;
    const confidence = clamp01(md.confidence);
    const evidence = stringArray(md.evidence);
    const builtOn = stringArray(md.built_on).filter((p) => priorByPath.has(p));
    const practices = stringArray(md.practices).filter((p) => installedSet.has(p));

    // 5. Derive surfaced for this fresh thought (recurrence starts at 0).
    const surfaced = deriveSurfaced(confidence, 0);

    // 4. Write the daydream (its own hypotheses store — never the journal, C3).
    const dd = await writeDaydream({
      body: thought,
      confidence,
      practices,
      evidence,
      createdFrom: builtOn,
      surfaced,
    });
    result.daydreamsWritten += 1;
    if (surfaced) result.surfaced += 1;

    // 4. Increment recurrence on any prior daydream the loop re-arrived at,
    //    and surface it if the reinforcement now clears the bar.
    for (const priorPath of builtOn) {
      await recordRecurrence(priorPath);
      result.recurrencesRecorded += 1;
      const prior = priorByPath.get(priorPath);
      const newRecurrence = (prior?.meta.recurrence ?? 0) + 1;
      if (prior && prior.meta.surfaced !== true && deriveSurfaced(prior.meta.confidence ?? 0, newRecurrence)) {
        await setSurfaced(priorPath, true);
        result.surfaced += 1;
      }
    }

    // 6. Propose the fewest — only confident thoughts that imply durable
    //    structure for an INSTALLED practice. Cross-cutting/untagged thoughts
    //    and zero-practice arkives simply produce no proposal (C1/C4).
    const implies = md.implies_insight;
    if (
      implies &&
      confidence >= PROPOSE_CONFIDENCE_THRESHOLD &&
      typeof implies.practice === "string" &&
      installedSet.has(implies.practice) &&
      typeof implies.title === "string" &&
      typeof implies.summary === "string"
    ) {
      // A single proposal failure (e.g. a same-day slug collision with an
      // existing pending insight) must not abort the whole pass — count it and
      // move on. The daydream itself is already written and kept.
      try {
        const wr = await proposeInsight({
          practice: implies.practice,
          title: implies.title,
          summary: implies.summary,
          evidence,
          proposedOutput: normalizeProposedOutput(implies.proposed_output),
          targetContextFile:
            typeof implies.target_context_file === "string" ? implies.target_context_file : undefined,
          loopReasoning: thought,
          loopConfidence: confidence,
          provenanceKind: deriveProvenanceKind(evidence),
        });
        await setPromotedTo(dd.path, wr.path);
        result.proposed += 1;
      } catch {
        result.proposeFailures += 1;
      }
    }

    // Real per-daydream tick — "N of M written", climbing as each is stored.
    emit({
      phase: "wrote",
      index: result.daydreamsWritten,
      total: parsed.length,
      surfaced: result.surfaced,
      proposed: result.proposed,
    });
  }

  return result;
}

// ============================================================================
// Feedback gathering (reads accepted/ + rejected/ — meta only)
// ============================================================================

type FeedbackItem = {
  status: "accepted" | "rejected";
  practice: string;
  path: string;
  reason_type?: string;
  proposed_output?: string;
  loop_reasoning?: string;
  resolution_date?: string;
};

async function gatherRecentFeedback(practices: string[], cap: number): Promise<FeedbackItem[]> {
  const out: FeedbackItem[] = [];
  for (const practice of practices) {
    for (const status of ["accepted", "rejected"] as const) {
      const entries = await listEntries({ practice, subpath: `insights/${status}` });
      for (const e of entries) {
        const m = e.meta;
        out.push({
          status,
          practice,
          path: e.path,
          reason_type: typeof m.reason_type === "string" ? m.reason_type : undefined,
          proposed_output: typeof m.proposed_output === "string" ? m.proposed_output : undefined,
          loop_reasoning: typeof m.loop_reasoning === "string" ? m.loop_reasoning : undefined,
          resolution_date: typeof m.resolution_date === "string" ? m.resolution_date : undefined,
        });
      }
    }
  }
  out.sort((a, b) => String(b.resolution_date ?? "").localeCompare(String(a.resolution_date ?? "")));
  return out.slice(0, cap);
}

// ============================================================================
// Prompt construction (practice-agnostic — C2; daydreams framed as hypotheses — C3)
// ============================================================================

function buildSystemPrompt(): string {
  return [
    "You are the autonomous reflection loop of a personal knowledge system, running on a schedule with no human present.",
    "Your job: read the recent raw signal and your own prior thoughts, then produce a few new DAYDREAMS.",
    "",
    "A daydream is a HYPOTHESIS — an unverified thought, never a stated fact. Phrase each as a hypothesis or question, not a conclusion.",
    "Ground every daydream in evidence: cite the file paths (from the stream or prior daydreams) that prompted it. Do not invent paths.",
    "Build on your prior daydreams when a new thought extends one — reference its path in built_on — so thoughts compound rather than repeat.",
    "Adapt to the recent accept/reject feedback: propose fewer of the kinds the user rejected, more like the kinds they accepted.",
    "Stay domain-agnostic. Do not assume any particular subject area; work only from the signal you are given.",
    "",
    "Set implies_insight when a thought is strong and well-grounded enough to be worth remembering as durable structure for one of the user's INSTALLED practices. Propose BOTH kinds, weighted equally:",
    '  - a recurring how-to-act rule the user could follow            -> proposed_output: "skill"   (a prescriptive lever)',
    '  - a durable, non-obvious diagnostic fact about the user/their patterns -> proposed_output: "context" (a descriptive observation about their state or tendencies)',
    'A strong DIAGNOSTIC observation (e.g. "X reliably precedes Y for this user") is worth proposing EXACTLY as much as an actionable rule — do NOT withhold it just because it is not a prescription. Use "both" when a thought implies a rule AND a state fact; "ask_user" only when the right output is genuinely unclear.',
    "Most daydreams should still have implies_insight: null — proposing stays the high-bar case, reserved for well-grounded thoughts (skip speculative reaches). The bar is STRENGTH and GROUNDING, not whether the insight is actionable.",
    'For a "context" or "both" insight, set target_context_file to the accumulate/TRUTH context file of that practice that best fits the conclusion (each practice\'s context files are listed below with their mode). Omit target_context_file for skill-only insights, or when the practice has no context files yet.',
    "",
    "Return ONLY a JSON object, no prose, in exactly this shape:",
    '{ "daydreams": [ {',
    '  "thought": string,',
    '  "confidence": number between 0 and 1,',
    '  "practices": string[]  (installed practice names this concerns; [] if cross-cutting),',
    '  "evidence": string[]   (file paths you grounded this in),',
    '  "built_on": string[]   (paths of prior daydreams you extended; [] if none),',
    '  "implies_insight": null | { "title": string, "summary": string, "proposed_output": "skill"|"context"|"both"|"ask_user", "practice": string, "target_context_file"?: string }',
    "} ] }",
  ].join("\n");
}

function buildUserPrompt(args: {
  installedPractices: string[];
  practiceContextFiles: Array<{
    practice: string;
    files: Array<{ name: string; update_mode: "replace" | "accumulate"; purpose: string }>;
  }>;
  candidates: PatternCandidate[];
  observations: Awaited<ReturnType<typeof listObservations>>;
  priorDaydreams: Daydream[];
  feedback: FeedbackItem[];
}): string {
  const sections: string[] = [];

  sections.push(
    `INSTALLED PRACTICES (the only valid values for implies_insight.practice): ${
      args.installedPractices.length ? args.installedPractices.join(", ") : "(none installed)"
    }`
  );

  const withFiles = args.practiceContextFiles.filter((p) => p.files.length > 0);
  if (withFiles.length) {
    sections.push(
      "\nCONTEXT FILES PER PRACTICE (valid targets for implies_insight.target_context_file — prefer an 'accumulate' file for a conclusion/rule):\n" +
        withFiles
          .map(
            (p) =>
              `- ${p.practice}: ${p.files
                .map((f) => `${f.name} [${f.update_mode}] — ${f.purpose}`)
                .join("; ")}`
          )
          .join("\n")
    );
  }

  sections.push(
    "\nPRE-RANKED PATTERN CANDIDATES (from a zero-cost clustering scan):\n" +
      (args.candidates.length
        ? args.candidates
            .map(
              (c) =>
                `- [${c.group_by}=${c.key}] count=${c.count} recent=${c.most_recent_date}` +
                `${c.most_routed_to ? ` routed_to=${c.most_routed_to}` : ""} samples=${c.sample_paths.join(", ")}`
            )
            .join("\n")
        : "(none)")
  );

  sections.push(
    "\nRECENT RAW OBSERVATIONS (newest first):\n" +
      (args.observations.length
        ? args.observations
            .map((o) => `- ${o.path}${o.meta.kind ? ` (${o.meta.kind})` : ""}: ${snippet(o.body)}`)
            .join("\n")
        : "(none)")
  );

  sections.push(
    "\nYOUR PRIOR DAYDREAMS (extend these via built_on rather than repeating):\n" +
      (args.priorDaydreams.length
        ? args.priorDaydreams
            .map(
              (d) =>
                `- ${d.path} [conf=${d.meta.confidence ?? "?"} recurrence=${d.meta.recurrence ?? 0}]: ${snippet(d.body)}`
            )
            .join("\n")
        : "(none yet)")
  );

  sections.push(
    "\nRECENT FEEDBACK ON YOUR PAST PROPOSALS (adapt to this):\n" +
      (args.feedback.length
        ? args.feedback
            .map(
              (f) =>
                `- ${f.status.toUpperCase()}${f.reason_type ? ` (${f.reason_type})` : ""}` +
                ` [${f.proposed_output ?? "?"}] ${f.path}`
            )
            .join("\n")
        : "(no decided proposals yet)")
  );

  sections.push("\nProduce your daydreams now as the JSON object specified.");
  return sections.join("\n");
}

// ============================================================================
// Parsing + small helpers
// ============================================================================

type ModelDaydream = {
  thought?: string;
  confidence?: unknown;
  practices?: unknown;
  evidence?: unknown;
  built_on?: unknown;
  implies_insight?: {
    title?: unknown;
    summary?: unknown;
    proposed_output?: unknown;
    practice?: unknown;
    target_context_file?: unknown;
  } | null;
};

/** Defensively extract the daydreams array from the model's text. Never throws —
 *  a malformed response yields [] and the pass reports it. */
function parseModelDaydreams(text: string): ModelDaydream[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { daydreams?: unknown };
    if (!obj || !Array.isArray(obj.daydreams)) return [];
    return obj.daydreams as ModelDaydream[];
  } catch {
    return [];
  }
}

function clamp01(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function normalizeProposedOutput(v: unknown): "skill" | "context" | "both" | "ask_user" {
  return v === "skill" || v === "context" || v === "both" || v === "ask_user" ? v : "ask_user";
}

function snippet(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > BODY_SNIPPET ? `${flat.slice(0, BODY_SNIPPET)}…` : flat;
}
