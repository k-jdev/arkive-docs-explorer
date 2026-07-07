// The daydream store — the autonomous loop's own thought substrate.
//
// This is the engine's private store of HYPOTHESES (constitution C3): the
// thoughts the compound loop generates while running with no human present.
// It is a deliberate mirror of stream.ts — same never-fails-on-input write
// contract, same best-effort index refresh, same monthly partitioning — but
// for the loop's own thoughts rather than raw user observations.
//
// Hard invariants enforced here:
//   - C7: daydreams live at the arkive root (arkive/daydreams/), a sibling of
//     the stream, NEVER inside a practice. They are engine-owned and carry an
//     optional practice tag only for scoping.
//   - C3: daydreams are hypotheses, never fact. This store never writes any
//     practice's structured-fact entries — it only ever writes under
//     DAYDREAMS_DIR. (The wall is folder location + read-time framing.)
//   - C1: a daydream with no practice tag is valid; the store works on a fresh
//     arkive with zero practices installed.
//
// Unlike the append-only observation stream, daydreams are MUTABLE engine
// substrate: recurrence and surfaced state are updated in place on the
// thought's own file (a Class-2 self-mutation, which is allowed for the
// engine's own store).

import { storage, currentUserId, type StoredEntry } from "@/lib/storage";
import type { StoredEntryMeta } from "@/lib/storage/types";
import { DAYDREAMS_DIR, daydreamPath, shortHash } from "./paths";
import { parseFrontmatter, serializeEntry } from "./frontmatter";
import { updateIndexForEntry } from "./arkive-index";
import type { DaydreamMeta } from "./schemas";

/** A single daydream as stored on disk. */
export type Daydream = {
  /** Full path: arkive/daydreams/<YYYY-MM>/<safeTimestamp>-<hash>.md */
  path: string;
  /** Universal frontmatter + daydream-specific salience/provenance fields. */
  meta: DaydreamMeta;
  /** Freeform body — the thought itself. */
  body: string;
};

// ============================================================================
// WRITE — the never-fails-on-input path (mirrors capture())
// ============================================================================

export type WriteDaydreamArgs = {
  /** The thought. Empty string is allowed (still records a timestamp + signals). */
  body: string;
  /** Optional ISO timestamp; defaults to now. */
  createdAt?: string;
  /** Practice tag(s) this thought concerns. Omit / [] = cross-cutting (C1). */
  practices?: string[];
  /** 0..1, model-assigned at generation. */
  confidence?: number;
  /** How many times the loop has re-arrived at this thought. Defaults unset. */
  recurrence?: number;
  /** ISO — most recent run that reinforced it. */
  lastSeen?: string;
  /** Presentation state — derived from salience, stored separately. */
  surfaced?: boolean;
  /** Paths to the stream entries this thought is grounded in. */
  evidence?: string[];
  /** Paths to prior daydreams this thought built on (reflective chain). */
  createdFrom?: string[];
  /** If this thought graduated to an insight, the insight path. */
  promotedTo?: string;
};

/**
 * Write a daydream. Never fails on input — only on storage outage. Returns the
 * persisted daydream including its assigned path. Caller need not know the
 * partitioning scheme.
 *
 * Like capture(), each call generates a fresh short hash, so two writes with
 * identical bodies + timestamps land at distinct paths.
 */
export async function writeDaydream(args: WriteDaydreamArgs): Promise<Daydream> {
  const createdAt = args.createdAt ?? new Date().toISOString();
  const hash = shortHash();
  const path = daydreamPath({ isoTimestamp: createdAt, shortHash: hash });

  const meta: DaydreamMeta = {
    entity_type: "daydream",
    practice: "core",
    created_at: createdAt,
  };
  if (args.practices && args.practices.length > 0) meta.practices = args.practices;
  if (typeof args.confidence === "number") meta.confidence = args.confidence;
  if (typeof args.recurrence === "number") meta.recurrence = args.recurrence;
  if (args.lastSeen) meta.last_seen = args.lastSeen;
  if (typeof args.surfaced === "boolean") meta.surfaced = args.surfaced;
  if (args.evidence && args.evidence.length > 0) meta.evidence = args.evidence;
  if (args.createdFrom && args.createdFrom.length > 0) meta.created_from = args.createdFrom;
  if (args.promotedTo) meta.promoted_to = args.promotedTo;

  const text = serializeEntry(meta as unknown as Record<string, unknown>, args.body ?? "");
  const uid = await currentUserId();
  await storage().writeEntry(uid, {
    path,
    body: text,
    meta: meta as unknown as Record<string, unknown>,
  });
  // Best-effort index refresh — never fails the write if the index misbehaves.
  try {
    await updateIndexForEntry(path);
  } catch {
    /* swallow — mirror the stream's never-fails-on-input contract. */
  }
  return { path, meta, body: args.body ?? "" };
}

// ============================================================================
// READS — list, slice
// ============================================================================

/** Read every daydream. Projects metadata only by default; pass
 *  `withBody: true` for full content. Sorted newest first (lexicographic on
 *  the timestamp-prefixed path). Mirrors listObservations. */
export async function listDaydreams(args?: {
  limit?: number;
  /** Only daydreams created at or after this ISO timestamp. */
  since?: string;
  /** Only daydreams tagged with this practice (membership in `practices`). */
  practice?: string;
  /** Only daydreams currently surfaced as Notices. */
  surfacedOnly?: boolean;
  /** When false (default), bodies are stripped to save memory. */
  withBody?: boolean;
}): Promise<Daydream[]> {
  const uid = await currentUserId();
  const withBody = args?.withBody ?? false;
  // Meta-only first: practice / surfaced / since filtering + limit all run off
  // frontmatter, so we never load a body we're going to discard.
  const metas = await storage().listMeta(uid, `${DAYDREAMS_DIR}/`);
  const sorted = metas.sort((a, b) => (a.path < b.path ? 1 : -1)); // newest first
  const sinceMs = args?.since ? Date.parse(args.since) : null;
  const picked: StoredEntryMeta[] = [];
  for (const e of sorted) {
    const m = buildDaydreamMeta(e.meta ?? {});
    if (args?.practice && !(m.practices ?? []).includes(args.practice)) continue;
    if (args?.surfacedOnly && m.surfaced !== true) continue;
    if (sinceMs !== null) {
      const t = Date.parse(m.created_at);
      if (!Number.isFinite(t) || t < sinceMs) continue;
    }
    picked.push(e);
    if (args?.limit !== undefined && picked.length >= args.limit) break;
  }

  if (!withBody) {
    return picked.map((e) => ({ path: e.path, meta: buildDaydreamMeta(e.meta ?? {}), body: "" }));
  }

  // Bodies requested — fetch the already-capped `picked` set in ONE round-trip.
  const fulls = await storage().readEntries(uid, picked.map((e) => e.path));
  const byPath = new Map(fulls.map((f) => [f.path, f] as const));
  return picked.map((e) => {
    const full = byPath.get(e.path);
    return full
      ? projectDaydream(full, true)
      : { path: e.path, meta: buildDaydreamMeta(e.meta ?? {}), body: "" };
  });
}

/** Read one daydream by exact path. */
export async function readDaydream(path: string): Promise<Daydream | null> {
  const uid = await currentUserId();
  const entry = await storage().readEntry(uid, path);
  if (!entry) return null;
  return projectDaydream(entry, true);
}

// ============================================================================
// SELF-MUTATIONS — additive frontmatter updates on the thought's own file.
// Allowed: this is the engine's own mutable substrate, not the append-only
// stream. (read → modify → write same path.)
// ============================================================================

/** Increment a daydream's recurrence and stamp last_seen. Called when the loop
 *  re-arrives at an existing thought. Idempotent in shape; monotonic in count. */
export async function recordRecurrence(
  path: string,
  seenAt?: string
): Promise<void> {
  const d = await readDaydream(path);
  if (!d) return; // deleted or never existed — silent no-op
  const next: DaydreamMeta = {
    ...d.meta,
    recurrence: (d.meta.recurrence ?? 0) + 1,
    last_seen: seenAt ?? new Date().toISOString(),
  };
  await rewrite(path, next, d.body);
}

/** Set a daydream's surfaced (presentation) flag. */
export async function setSurfaced(path: string, surfaced: boolean): Promise<void> {
  const d = await readDaydream(path);
  if (!d) return;
  await rewrite(path, { ...d.meta, surfaced }, d.body);
}

/** Record that a daydream graduated into an insight (sets promoted_to). */
export async function setPromotedTo(path: string, insightPath: string): Promise<void> {
  const d = await readDaydream(path);
  if (!d) return;
  await rewrite(path, { ...d.meta, promoted_to: insightPath }, d.body);
}

// ============================================================================
// Internals
// ============================================================================

async function rewrite(path: string, meta: DaydreamMeta, body: string): Promise<void> {
  const uid = await currentUserId();
  await storage().writeEntry(uid, {
    path,
    body: serializeEntry(meta as unknown as Record<string, unknown>, body),
    meta: meta as unknown as Record<string, unknown>,
  });
  try {
    await updateIndexForEntry(path);
  } catch {
    /* swallow */
  }
}

/** Normalize a raw frontmatter/meta map into the typed DaydreamMeta. Shared by
 *  the meta-only and full-body read paths so both project identically. */
function buildDaydreamMeta(m: Record<string, unknown>): DaydreamMeta {
  const out: DaydreamMeta = {
    entity_type: "daydream",
    practice: "core",
    created_at: typeof m.created_at === "string" ? m.created_at : new Date().toISOString(),
  };
  if (Array.isArray(m.practices)) {
    out.practices = m.practices.filter((x): x is string => typeof x === "string");
  }
  if (typeof m.confidence === "number") out.confidence = m.confidence;
  if (typeof m.recurrence === "number") out.recurrence = m.recurrence;
  if (typeof m.last_seen === "string") out.last_seen = m.last_seen;
  if (typeof m.surfaced === "boolean") out.surfaced = m.surfaced;
  if (Array.isArray(m.evidence)) {
    out.evidence = m.evidence.filter((x): x is string => typeof x === "string");
  }
  if (Array.isArray(m.created_from)) {
    out.created_from = m.created_from.filter((x): x is string => typeof x === "string");
  }
  if (typeof m.promoted_to === "string") out.promoted_to = m.promoted_to;
  return out;
}

function projectDaydream(entry: StoredEntry, withBody: boolean): Daydream {
  const { meta, body } = parseFrontmatter(entry.body);
  return {
    path: entry.path,
    meta: buildDaydreamMeta((meta ?? {}) as Record<string, unknown>),
    body: withBody ? body : "",
  };
}
