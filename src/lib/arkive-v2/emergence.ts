// Emergence — the structure-earning analyzer (rebuild §3 + Phase 5).
//
// Two scans, both feeding "ask, don't auto-build":
//
//   1. Pattern candidates — observations sharing a kind / mention that
//      have crossed a threshold. The AI uses these as evidence for
//      propose_insight calls; the user gate decides whether they get
//      promoted into structured journal entries.
//
//   2. Practice suggestions — `routed_to` hints pointing at practices
//      that don't exist yet. The AI uses these as triggers for the
//      §10 ask-once nudge ("I've noticed you mention X a few times…").
//
// CRITICAL: this module ONLY analyzes. It never commits structure.
// Per the spec: hearing "watches" three times is permission to ASK,
// not permission to BUILD. The scanner surfaces evidence; the AI
// surfaces the question; the user makes the call.

import { storage, currentUserId } from "@/lib/storage";
import { STREAM_DIR } from "./paths";

// ---- Tunable thresholds ---------------------------------------------------
//
// Kept conservative — the cost of a false positive (an unwanted nudge) is
// much higher than the cost of a missed pattern (the user will surface it
// directly). The defaults match the spec's "3 distinct entries" rule for
// insight evidence + a slightly higher bar for practice suggestions since
// a new practice is a heavier commitment.

const PATTERN_KIND_THRESHOLD = 3;
const PATTERN_MENTION_THRESHOLD = 3;
const PRACTICE_SUGGESTION_THRESHOLD = 5;
/** Mentions that occur in >50% of stream observations are too generic to
 *  signal anything. Strip them out of cluster scoring. */
const MENTION_DROP_FREQUENCY = 0.5;

// ---- Public types ---------------------------------------------------------

export type ObservationSummary = {
  path: string;
  created_at: string;
  kind?: string;
  routed_to?: string;
  mentions: string[];
};

/** A cluster of observations the AI may propose as a pattern. */
export type PatternCandidate = {
  /** How the cluster was grouped. */
  group_by: "kind" | "mention";
  /** The grouping key — kind name or mention string. */
  key: string;
  /** Sample observation paths. Cap at 6 so the bundle stays compact. */
  sample_paths: string[];
  /** Total observation count in this cluster. */
  count: number;
  /** Best-guess routing — the most common routed_to among the cluster. */
  most_routed_to?: string;
  /** How close this cluster is to its threshold, in [0, 1]. Always 1 here
   *  because we only emit candidates AT or above threshold; future
   *  versions may also surface near-threshold candidates. */
  threshold_progress: number;
  /** Date of the most recent observation in the cluster — recency hint
   *  the AI can use to decide whether the pattern is still active. */
  most_recent_date: string;
};

/** A nonexistent practice the user has been thinking about, based on
 *  routed_to hints accumulating in the stream. */
export type PracticeSuggestion = {
  /** Slug the user has been routing to (e.g. "fitness", "reading"). */
  proposed_name: string;
  /** Total stream observations routed_to this name. */
  observation_count: number;
  /** Sample paths the AI can cite when asking the user. */
  sample_paths: string[];
  /** First and last time the user routed something here — gives the AI
   *  a sense of whether interest is sustained or one-off. */
  first_seen: string;
  last_seen: string;
};

export type EmergenceReport = {
  pattern_candidates: PatternCandidate[];
  practice_suggestions: PracticeSuggestion[];
  /** For diagnostics — how many observations the scan looked at. */
  observations_scanned: number;
};

// ---- Main entry point -----------------------------------------------------

/**
 * Walk the universal stream + cluster observations. Returns candidates +
 * practice suggestions. Pure read; never writes.
 */
export async function scanEmergence(args: {
  installed_practice_names: string[];
  /** Optional cap on observations scanned. Default scans the whole stream. */
  limit?: number;
}): Promise<EmergenceReport> {
  const uid = await currentUserId();
  // Meta-only: the scan reads kind / routed_to / mentions / created_at, all of
  // which live in frontmatter — never the body. No body load.
  const all = await storage().listMeta(uid, `${STREAM_DIR}/`);

  // Newest first; cap if requested
  const sorted = all.sort((a, b) => (a.path < b.path ? 1 : -1));
  const scope = args.limit !== undefined ? sorted.slice(0, args.limit) : sorted;

  const observations: ObservationSummary[] = [];
  for (const e of scope) {
    const m = e.meta ?? {};
    observations.push({
      path: e.path,
      created_at:
        typeof m.created_at === "string"
          ? m.created_at
          : e.path.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "",
      kind: typeof m.kind === "string" ? m.kind : undefined,
      routed_to: typeof m.routed_to === "string" ? m.routed_to : undefined,
      mentions: Array.isArray(m.mentions)
        ? (m.mentions as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
    });
  }

  const pattern_candidates = clusterPatterns(observations);
  const practice_suggestions = detectPracticeSuggestions(
    observations,
    new Set(args.installed_practice_names)
  );

  return {
    pattern_candidates,
    practice_suggestions,
    observations_scanned: observations.length,
  };
}

// ---- Cluster scoring ------------------------------------------------------

function clusterPatterns(obs: ObservationSummary[]): PatternCandidate[] {
  if (obs.length === 0) return [];
  const candidates: PatternCandidate[] = [];

  // ---- Group by kind ----
  const byKind = new Map<string, ObservationSummary[]>();
  for (const o of obs) {
    if (!o.kind) continue;
    const arr = byKind.get(o.kind) ?? [];
    arr.push(o);
    byKind.set(o.kind, arr);
  }
  for (const [kind, group] of byKind) {
    if (group.length < PATTERN_KIND_THRESHOLD) continue;
    candidates.push(buildCandidate("kind", kind, group));
  }

  // ---- Group by mention (with frequency filter) ----
  const mentionTally = new Map<string, ObservationSummary[]>();
  for (const o of obs) {
    for (const m of o.mentions) {
      const arr = mentionTally.get(m) ?? [];
      arr.push(o);
      mentionTally.set(m, arr);
    }
  }
  const dropThreshold = obs.length * MENTION_DROP_FREQUENCY;
  for (const [mention, group] of mentionTally) {
    if (group.length < PATTERN_MENTION_THRESHOLD) continue;
    if (group.length > dropThreshold) continue; // too generic
    candidates.push(buildCandidate("mention", mention, group));
  }

  // De-dup very similar candidates: if a "kind" cluster has the same
  // sample paths as a "mention" cluster, keep the kind one (more
  // intentional signal).
  const seenSamples = new Set<string>();
  const deduped: PatternCandidate[] = [];
  for (const c of candidates.sort((a, b) => b.count - a.count)) {
    const sampleKey = c.sample_paths.slice(0, 3).sort().join("|");
    if (seenSamples.has(sampleKey)) continue;
    seenSamples.add(sampleKey);
    deduped.push(c);
  }

  return deduped;
}

function buildCandidate(
  group_by: "kind" | "mention",
  key: string,
  group: ObservationSummary[]
): PatternCandidate {
  // Most-common routed_to across the group
  const routeTally = new Map<string, number>();
  for (const o of group) {
    if (!o.routed_to) continue;
    routeTally.set(o.routed_to, (routeTally.get(o.routed_to) ?? 0) + 1);
  }
  const most_routed_to =
    [...routeTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? undefined;

  const sorted = group.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const threshold =
    group_by === "kind" ? PATTERN_KIND_THRESHOLD : PATTERN_MENTION_THRESHOLD;
  return {
    group_by,
    key,
    sample_paths: sorted.slice(0, 6).map((o) => o.path),
    count: group.length,
    most_routed_to,
    threshold_progress: Math.min(1, group.length / threshold),
    most_recent_date: sorted[0]?.created_at ?? "",
  };
}

// ---- Practice suggestion detection ---------------------------------------

function detectPracticeSuggestions(
  obs: ObservationSummary[],
  installed: Set<string>
): PracticeSuggestion[] {
  const byRoute = new Map<string, ObservationSummary[]>();
  for (const o of obs) {
    if (!o.routed_to) continue;
    if (installed.has(o.routed_to)) continue; // already a practice
    const arr = byRoute.get(o.routed_to) ?? [];
    arr.push(o);
    byRoute.set(o.routed_to, arr);
  }

  const out: PracticeSuggestion[] = [];
  for (const [name, group] of byRoute) {
    if (group.length < PRACTICE_SUGGESTION_THRESHOLD) continue;
    const sorted = group.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    out.push({
      proposed_name: name,
      observation_count: group.length,
      sample_paths: sorted
        .slice(-6) // last 6 by date (most-recent context for the question)
        .map((o) => o.path)
        .reverse(),
      first_seen: sorted[0]?.created_at ?? "",
      last_seen: sorted[sorted.length - 1]?.created_at ?? "",
    });
  }

  // Sort suggestions newest-activity-first so the AI surfaces the most
  // active prospective practice first.
  out.sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1));
  return out;
}

// ---- Intake question catalog ---------------------------------------------
//
// Generic, domain-agnostic shape questions. Per §2 the AI runs these
// conversationally after the user opts into a new practice; the answers
// license update_practice_config calls. A short library, not a wizard.

export type IntakeQuestion = {
  id: string;
  question: string;
  /** What kind of config patch the answer maps to. The AI is responsible
   *  for parsing the answer and constructing the patch — these are hints
   *  about what to do with the response. */
  shapes:
    | "journal_entity_types"
    | "context_files"
    | "instructions_voice"
    | "instructions_anti_patterns"
    | "loading_triggers";
};

/**
 * Default intake question set — keep it small. The spec is explicit: a
 * few questions, not a survey. Skippable. The AI may also generate
 * domain-specific follow-ups based on the practice name + early answers.
 */
export function defaultIntakeQuestions(_practice: string): IntakeQuestion[] {
  return [
    {
      id: "what_events",
      question:
        "What discrete events do you want me to log here? (e.g. 'every deal', 'every workout', 'every client call')",
      shapes: "journal_entity_types",
    },
    {
      id: "current_state",
      question:
        "What's the current state I should keep track of for you? (e.g. 'inventory I'm holding', 'projects in flight', 'people I'm tracking')",
      shapes: "context_files",
    },
    {
      id: "loading_triggers",
      question:
        "What keywords or topics should make me load this practice when you bring it up?",
      shapes: "loading_triggers",
    },
    {
      id: "voice_and_limits",
      question:
        "Anything I should NEVER do here, or any defaults I should always apply? (e.g. 'never speculate on prices', 'always show capital state when asked')",
      shapes: "instructions_anti_patterns",
    },
  ];
}
