// The universal observation stream — the spine of the stream-first model.
//
// The contract is short and absolute: capture NEVER fails. No schema
// validation, no required practice routing, no required entity_type beyond
// the universal three (entity_type, practice, created_at). Hints
// (`kind`, `mentions`, `routed_to`) improve retrieval but cap-fail nothing.
//
// Reads from this module:
//   - The bundle loads a recent slice (capped) so the AI has the latest
//     context without paying for the whole stream.
//   - Practice routing pulls observations that match the practice's
//     loading.triggers / routed_to hint.
//   - Emergence walks the stream to find candidate patterns; on user
//     acceptance, projects matched observations into structured journal
//     entries with `created_from: [<observation-paths>]`.
//
// Writes through this module only — never reach into write_entity for
// observations. write_entity is the projection tool; this is capture.

import { storage, currentUserId, type StoredEntry } from "@/lib/storage";
import type { StoredEntryMeta } from "@/lib/storage/types";
import {
  STREAM_DIR,
  streamObservationPath,
  shortHash,
} from "./paths";
import { parseFrontmatter, serializeEntry } from "./frontmatter";
import { updateIndexForEntry } from "./arkive-index";

/** A single raw observation as stored on disk. */
export type Observation = {
  /** Full path: arkive/stream/<YYYY-MM>/<safeTimestamp>-<hash>.md */
  path: string;
  /** Universal frontmatter + observation-specific hints. */
  meta: ObservationMeta;
  /** Freeform body — exactly what was captured. */
  body: string;
};

export type ObservationMeta = {
  entity_type: "observation";
  /** Always "core" for raw stream observations. Projections flip this
   *  to the target practice's name; the observation itself stays "core". */
  practice: "core";
  /** ISO 8601 — moment of capture. */
  created_at: string;
  /** Loose hint — freeform string, no enum. Examples: "trade_close",
   *  "watch_deal", "design_critique", "intent", "reflection". */
  kind?: string;
  /** Extracted entity hints (asset tickers, wallet labels, project names).
   *  Improve retrieval; never required, never validated. */
  mentions?: string[];
  /** Best-guess practice slug for retrieval routing (e.g. "trading").
   *  NOT structural commitment — the observation still lives at the
   *  stream root. Practices use this as a hint when fetching their slice. */
  routed_to?: string;
  /** Optional projection backlink — set after an observation has been
   *  promoted into a structured journal entry. Lets the index show
   *  "this observation produced X." Multiple projections allowed. */
  projected_to?: string[];
};

// ============================================================================
// CAPTURE — the never-fails path
// ============================================================================

export type CaptureArgs = {
  /** Freeform body. Empty string is allowed (still captures a timestamp +
   *  hints — useful when all the signal is in `kind`/`mentions`). */
  body: string;
  /** Optional ISO timestamp; defaults to now. Useful for backfilling
   *  historical data (e.g. importing existing trades as observations). */
  createdAt?: string;
  /** Optional loose hint. */
  kind?: string;
  /** Optional extracted mentions. */
  mentions?: string[];
  /** Optional best-guess practice routing hint. */
  routedTo?: string;
};

/**
 * Capture an observation. Never fails on input — only on storage outage.
 * Returns the persisted observation including its assigned path. Caller
 * does not need to know about the partitioning scheme.
 *
 * Idempotency: each call generates a fresh short hash; two captures with
 * identical bodies + timestamps will land at distinct paths. This is
 * intentional — observations are the historical record of *capture events*,
 * not deduped facts.
 */
export async function capture(args: CaptureArgs): Promise<Observation> {
  const createdAt = args.createdAt ?? new Date().toISOString();
  const hash = shortHash();
  const path = streamObservationPath({ isoTimestamp: createdAt, shortHash: hash });

  const meta: ObservationMeta = {
    entity_type: "observation",
    practice: "core",
    created_at: createdAt,
  };
  if (args.kind) meta.kind = args.kind;
  if (args.mentions && args.mentions.length > 0) meta.mentions = args.mentions;
  if (args.routedTo) meta.routed_to = args.routedTo;

  const text = serializeEntry(meta as unknown as Record<string, unknown>, args.body ?? "");
  const uid = await currentUserId();
  await storage().writeEntry(uid, {
    path,
    body: text,
    meta: meta as unknown as Record<string, unknown>,
  });
  // Best-effort index refresh — never fails capture if the index is misbehaving.
  // The next capture / read will rebuild from scratch if this slipped.
  try {
    await updateIndexForEntry(path);
  } catch {
    /* swallow — capture's contract is "never fails on input"; we honor it
       even if index maintenance is temporarily broken. */
  }
  return { path, meta, body: args.body ?? "" };
}

// ============================================================================
// READS — list, slice, traverse
// ============================================================================

/** Read every observation in the stream. Cheap-ish — projects metadata
 *  only by default; pass `withBody: true` for full content. Sorted newest
 *  first (lexicographic on the path, which is timestamp-prefixed). */
export async function listObservations(args?: {
  limit?: number;
  /** Filter by routed_to hint. */
  routedTo?: string;
  /** Filter by kind. */
  kind?: string;
  /** Only observations created at or after this ISO timestamp. */
  since?: string;
  /** When false (default), bodies are stripped to save memory. */
  withBody?: boolean;
}): Promise<Observation[]> {
  const uid = await currentUserId();
  const withBody = args?.withBody ?? false;
  // Meta-only first: filtering (routed_to / kind / since) and the limit all run
  // off frontmatter, so we never load a body we're going to discard.
  const metas = await storage().listMeta(uid, `${STREAM_DIR}/`);
  const sorted = metas.sort((a, b) => (a.path < b.path ? 1 : -1)); // newest first
  const sinceMs = args?.since ? Date.parse(args.since) : null;
  const picked: StoredEntryMeta[] = [];
  for (const e of sorted) {
    const m = buildObservationMeta(e.meta ?? {});
    if (args?.routedTo && m.routed_to !== args.routedTo) continue;
    if (args?.kind && m.kind !== args.kind) continue;
    if (sinceMs !== null) {
      const t = Date.parse(m.created_at);
      if (!Number.isFinite(t) || t < sinceMs) continue;
    }
    picked.push(e);
    if (args?.limit !== undefined && picked.length >= args.limit) break;
  }

  if (!withBody) {
    return picked.map((e) => ({
      path: e.path,
      meta: buildObservationMeta(e.meta ?? {}),
      body: "",
    }));
  }

  // Bodies requested — fetch the already-capped `picked` set in ONE round-trip.
  const fulls = await storage().readEntries(uid, picked.map((e) => e.path));
  const byPath = new Map(fulls.map((f) => [f.path, f] as const));
  return picked.map((e) => {
    const full = byPath.get(e.path);
    return full
      ? projectObservation(full, true)
      : { path: e.path, meta: buildObservationMeta(e.meta ?? {}), body: "" };
  });
}

/** Read one observation by exact path. */
export async function readObservation(path: string): Promise<Observation | null> {
  const uid = await currentUserId();
  const entry = await storage().readEntry(uid, path);
  if (!entry) return null;
  return projectObservation(entry, true);
}

// ============================================================================
// PROJECTION BACKLINK — set on accept of an emergent or intake-driven
// promotion into a structured journal entry. Idempotent.
// ============================================================================

export async function recordProjection(
  observationPath: string,
  projectedToPath: string
): Promise<void> {
  const obs = await readObservation(observationPath);
  if (!obs) return; // observation was deleted or never existed — silent no-op
  const projected = obs.meta.projected_to ?? [];
  if (projected.includes(projectedToPath)) return;
  projected.push(projectedToPath);
  const newMeta: ObservationMeta = { ...obs.meta, projected_to: projected };
  const uid = await currentUserId();
  await storage().writeEntry(uid, {
    path: observationPath,
    body: serializeEntry(newMeta as unknown as Record<string, unknown>, obs.body),
    meta: newMeta as unknown as Record<string, unknown>,
  });
  try {
    await updateIndexForEntry(observationPath);
  } catch {
    /* swallow */
  }
}

// ============================================================================
// Internals
// ============================================================================

/** Normalize a raw frontmatter/meta map into the typed ObservationMeta. Shared
 *  by the meta-only and full-body read paths so both project identically. */
function buildObservationMeta(m: Record<string, unknown>): ObservationMeta {
  const obsMeta: ObservationMeta = {
    entity_type: "observation",
    practice: "core",
    created_at: typeof m.created_at === "string" ? m.created_at : new Date().toISOString(),
  };
  if (typeof m.kind === "string") obsMeta.kind = m.kind;
  if (Array.isArray(m.mentions)) {
    obsMeta.mentions = m.mentions.filter((x): x is string => typeof x === "string");
  }
  if (typeof m.routed_to === "string") obsMeta.routed_to = m.routed_to;
  if (Array.isArray(m.projected_to)) {
    obsMeta.projected_to = m.projected_to.filter((x): x is string => typeof x === "string");
  }
  return obsMeta;
}

function projectObservation(entry: StoredEntry, withBody: boolean): Observation {
  const { meta, body } = parseFrontmatter(entry.body);
  return {
    path: entry.path,
    meta: buildObservationMeta((meta ?? {}) as Record<string, unknown>),
    body: withBody ? body : "",
  };
}
