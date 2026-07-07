// read_arkive — session-start loader, practice-agnostic per §14.
//
// Order of operations per the spec:
//   1. identity.md
//   2. arkive.protocol.md
//   3. arkive.config (find active practices + load defaults)
//   4. For each active practice:
//        - read its practice.config
//        - load context/ files
//        - load journal entries from the recent window
//        - load insights/pending/
//   5. Skills are NOT bulk-loaded — situation-triggered.
//
// The bundle returned by readArkive() carries every active practice's data
// in a generic shape so the runtime + UI never hard-code which practice is
// being read.

import { storage, currentUserId, type StoredEntry } from "@/lib/storage";
import type { StoredEntryMeta } from "@/lib/storage/types";
import {
  PATH_IDENTITY,
  PATH_LOADUP,
  PATH_PROTOCOL,
  PATH_CONFIG,
  PATH_INDEX,
  PRACTICES_DIR,
  STREAM_DIR,
  DAYDREAMS_DIR,
  practiceRoot,
  practiceConfigPath,
  practiceInstructionsPath,
} from "./paths";
import { parseFrontmatter, serializeEntry } from "./frontmatter";
import { LOADUP_MD, PROTOCOL_MD, PROTOCOL_VERSION } from "./seeds";
import { readArkiveConfig } from "./arkive-config";
import { parsePracticeConfig } from "./practices";
import { readIndex } from "./arkive-index";
import { migrateToCoreV1IfNeeded } from "./migrate";
import {
  UNIVERSAL_ENTITY_TYPES,
  UNIVERSAL_LINK_TYPES,
  type ArkiveConfigFile,
  type PracticeConfigFile,
} from "./schemas";
import {
  scanEmergence,
  type PatternCandidate,
  type PracticeSuggestion,
} from "./emergence";
import { listDaydreams, type Daydream } from "./daydream";

// ---- Load-economics knobs (Phase 4 §7) -------------------------------------
//
// recent_max_entries from arkive.config is a UPPER bound on what the loader
// looks at. The bulk-with-bodies cap is much smaller — recency-loaded full
// bodies are what the AI burns context window on, so we keep it tight and
// surface everything else as a cheap path+meta summary.
const RECENT_JOURNAL_FULL_BODY_CAP = 15;

export type Entry = {
  path: string;
  meta: Record<string, unknown>;
  body: string;
};

/** Lightweight reference to a structured entry — path + the minimum meta
 *  needed to display / decide whether to fetch the full body. Used for
 *  older journal entries, skills, and any pile of files we don't want to
 *  bulk-load. */
export type EntryRef = {
  path: string;
  entity_type: string;
  title?: string;
  created_at?: string;
};

export type PopulationStatus =
  | "empty" // no entries at all
  | "awaiting_structure" // observations exist; no journal/context entries yet
  | "partially_populated" // some content but minimal
  | "populated"; // healthy density of entries

export type LoadedPractice = {
  name: string;
  /** Loading mode at the time of this load. */
  mode: "active" | "on_demand" | "private";
  /** Resolved config — null if the practice has no config file (broken install). */
  config: PracticeConfigFile | null;
  /** Operational playbook for this practice. Loaded at session start so
   *  the AI knows the practice-specific defaults, tool sequences, anti-
   *  patterns, and decisive-execution rules. Mutable by the user. Null
   *  if the practice hasn't seeded an instructions file yet. */
  instructions: Entry | null;
  /** Context/ files (Class 2 state) — small + always loaded in full. */
  context: Entry[];
  /** Pending insights — small set + always loaded in full (they're a user gate). */
  pending_insights: Entry[];
  /** RECENT journal entries with FULL BODIES. Capped tightly by
   *  RECENT_JOURNAL_FULL_BODY_CAP so the context window doesn't get eaten
   *  by months of routine entries. The rest are surfaced via
   *  older_journal_summary. */
  recent_journal: Entry[];
  /** Older journal entries inside the recent_window_days window — paths +
   *  meta only. The AI can fetch any of them on demand via read_entity. */
  older_journal_summary: EntryRef[];
  /** Aggregate journal counts by entity_type. Lets the AI answer "how
   *  many trades has the user logged?" without scanning files. */
  journal_by_entity_type: Record<
    string,
    { count: number; latest_date: string | null }
  >;
  /** Skills index — paths + name + status. Skills are NEVER bulk-loaded
   *  (they're situation-triggered); the AI picks one and calls read_entity. */
  skill_index: EntryRef[];
  /** Total non-management entry count (for stats UI). */
  entry_count: number;
  /** EVERY on-disk path inside this practice — paths only, no bodies.
   *  The UI uses this to render the file explorer / graph faithfully even
   *  when entries are outside the recent window or in folders that aren't
   *  bulk-loaded (skills/, insights/accepted/, insights/rejected/). */
  all_paths: string[];
};

/** Per-practice capability surface — declared once in practice.config, lifted
 *  here so the AI can read its tool list + gates + entity-type vocabulary
 *  without scanning the config file directly. */
export type PracticeCapability = {
  name: string;
  mode: "active" | "on_demand" | "private";
  version: string;
  declared_entity_types: string[];
  declared_context_files: string[];
  declared_link_types: string[];
  declared_tools: Array<{
    name: string;
    description?: string;
    gate: "none" | "one_tap" | "hard_confirm";
  }>;
  population: {
    status: PopulationStatus;
    journal_entry_count: number;
    context_file_count: number;
    skill_count: number;
    pending_insight_count: number;
    last_activity: string | null;
  };
};

/** Top-of-bundle capability manifest. Claude reads this FIRST every session
 *  so it knows the full surface — no mid-session tool discovery, no
 *  "is there a tool for X?" questions. */
export type CapabilityManifest = {
  protocol_version: string;
  universal_entity_types: string[];
  universal_link_types: string[];
  installed_practices: PracticeCapability[];
  stream: {
    observation_count: number;
    /** Tally of routed_to hint values seen across the stream — gives the
     *  AI a sense of which practices the user has been thinking about
     *  even when no structured entries exist yet. */
    routing_hints_seen: Record<string, number>;
  };
  /** Emergence — observation clusters that have crossed an evidence
   *  threshold. The AI MAY formulate these into propose_insight calls;
   *  the user gate (decide_insight) is what actually moves the needle. */
  pattern_candidates: PatternCandidate[];
  /** Nonexistent practices the user has been routing observations to.
   *  Each entry is permission to ASK (§10 ask-once nudge) — never
   *  permission to BUILD. */
  practice_suggestions: PracticeSuggestion[];
};

export type ArkiveBundle = {
  current_date: string;
  /** TOP-OF-BUNDLE capability manifest (Phase 4 §7). The AI reads this
   *  FIRST and knows the full tool surface + gates + which practices
   *  carry content vs. are awaiting structure. Eliminates mid-session
   *  tool discovery. */
  capability: CapabilityManifest;
  protocol: { path: string; body: string } | null;
  identity: Entry | null;
  /** User-controlled session-start preferences (single source of truth
   *  for "what to do when I open Ark"). Auto-seeded if missing. */
  loadup: Entry | null;
  config: ArkiveConfigFile;
  /** Every installed practice's compacted digest. Active practices include
   *  full context + pending insights + capped recent_journal with bodies +
   *  older_journal_summary (paths only) + skill_index. on_demand / private
   *  practices include just the structural bits + all_paths. */
  practices: LoadedPractice[];
  /** Recent slice of the universal observation stream. Newest first,
   *  capped by globalConfig.defaults.recent_max_entries. Bodies INCLUDED
   *  (these are the AI's freshest signal — projections + structured
   *  context already cover what's older). */
  recent_observations: Entry[];
  /** Total observation count on disk. UI uses it for the stream tab badge. */
  observation_count: number;
  /** Surfaced daydreams — the autonomous loop's hypotheses that cleared the
   *  surfacing bar, shown to the human as read-only "Notices". Newest first.
   *  Engine-owned (arkive/daydreams/), a sibling of the stream — never the
   *  journal. Additive: existing consumers ignore it. */
  notices: Daydream[];
  /** Count of surfaced daydreams — badge for the Notices tab. */
  daydream_count: number;
  /** Every daydream file path on disk (no bodies) — lets the explorer show an
   *  arkive/daydreams branch, browsable like the stream. Surfaced or not. */
  daydream_paths: string[];
  extra_paths: string[];
  /** Auto-maintained link graph. */
  index_version: string;
  index_last_updated: string;
  /** Set only on the MODEL-facing projection (projectBundleForModel) — a short
   *  in-band reminder that the bundle is compacted + how to fetch full bodies.
   *  Absent on the raw bundle the UI consumes. */
  loading_note?: string;
};

export async function readArkive(): Promise<ArkiveBundle> {
  const uid = await currentUserId();
  const adapter = storage();
  const now = new Date();

  // ---- Migration (idempotent, marker-gated) ----
  try {
    await migrateToCoreV1IfNeeded();
  } catch (err) {
    console.error("core-v1 migration failed (will retry next read):", err);
  }

  // ---- Protocol auto-refresh ----
  try {
    const stored = await adapter.readEntry(uid, PATH_PROTOCOL);
    const storedVersion = (stored?.meta as Record<string, unknown> | undefined)
      ?.protocol_version;
    if (!stored || storedVersion !== PROTOCOL_VERSION) {
      await adapter.writeEntry(uid, {
        path: PATH_PROTOCOL,
        body: PROTOCOL_MD,
        meta: {
          entity_type: "protocol",
          practice: "core",
          created_at: stored?.meta?.created_at ?? new Date().toISOString(),
          last_updated: new Date().toISOString(),
          version: 1,
          protocol_version: PROTOCOL_VERSION,
        },
      });
    }
  } catch {
    // Best-effort
  }

  // ---- loadup.md seed-if-missing ----
  // Auto-seeded once per arkive. NEVER auto-refreshed — the user owns this
  // file. Their edits are the single source of truth for session-start.
  try {
    const existingLoadup = await adapter.readEntry(uid, PATH_LOADUP);
    if (!existingLoadup) {
      const { meta: seedMeta, body: seedBody } = parseFrontmatter(LOADUP_MD);
      const seedMetaObj = (seedMeta ?? {}) as Record<string, unknown>;
      await adapter.writeEntry(uid, {
        path: PATH_LOADUP,
        body: serializeEntry(seedMetaObj, seedBody),
        meta: seedMetaObj,
      });
    }
  } catch {
    // Best-effort
  }

  // ---- Heal context files left in a broken state by the pre-v6.4 writer ----
  // The earlier writer refused to overwrite context files, so the AI
  // reached for append_to_entity instead. That left placeholders like
  // "_No rules captured yet._" sitting next to real appended sections.
  // One-shot strip on the next read; idempotent (skips healthy files).
  try {
    await healPlaceholdersInContextFiles(adapter, uid);
  } catch (err) {
    console.error("context-file heal failed (non-fatal):", err);
  }

  // ---- Heal misrouted universal-root files ----
  // Before v7.x, write_entity(practice: "core", subpath: "identity.md")
  // landed at arkive/practices/core/identity.md instead of arkive/identity.md
  // because "core" was treated as a practice slug. The writer is fixed now
  // (resolveFullPath routes "core" to the root) but historical misrouted
  // content needs to migrate. Idempotent: only acts when the root file is
  // still a placeholder AND the misrouted file has real content.
  try {
    await healMisroutedCoreFiles(adapter, uid);
  } catch (err) {
    console.error("misrouted-core heal failed (non-fatal):", err);
  }

  // ---- §14.1-3: identity, protocol, loadup, config ----
  const [identityEntry, protocolEntry, loadupEntry, config] = await Promise.all(
    [
      adapter.readEntry(uid, PATH_IDENTITY),
      adapter.readEntry(uid, PATH_PROTOCOL),
      adapter.readEntry(uid, PATH_LOADUP),
      readArkiveConfig(),
    ],
  );

  // ---- §14.4-6: per-practice load ----
  const practices: LoadedPractice[] = [];
  for (const [name, reg] of Object.entries(config.practices)) {
    if (!reg.enabled) continue;
    const loaded = await loadPractice(adapter, uid, name, reg.mode, config);
    practices.push(loaded);
  }
  practices.sort((a, b) => a.name.localeCompare(b.name));

  // ---- Recent slice of the observation stream ----
  // Newest first, capped by the same recent_max_entries used by per-practice
  // journal loading. We list METADATA ONLY for the whole stream (count +
  // routing-hint tally are meta-only), then fetch BODIES for just the capped
  // recent slice — the freshest user signal — instead of dragging every
  // observation's body through memory and into the bundle.
  const streamMetas = await adapter.listMeta(uid, `${STREAM_DIR}/`);
  const sortedStream = streamMetas.sort((a, b) => (a.path < b.path ? 1 : -1));
  const recentStreamMetas = sortedStream.slice(
    0,
    config.defaults.recent_max_entries,
  );
  const recent_observations = await fetchBodies(
    adapter,
    uid,
    recentStreamMetas,
  );
  const observation_count = streamMetas.length;

  // ---- Surfaced daydreams (read-only Notices) ----
  // The loop's hypotheses that cleared the surfacing bar. A sibling of the
  // stream slice above, read from the engine-owned daydream store — never the
  // journal. User-scoped via the storage adapter (currentUserId). Surfaced
  // subset only; full history is served by GET /api/arkive-v2/daydream.
  const notices = await listDaydreams({ surfacedOnly: true, withBody: true });
  // All daydream paths (metadata-only) for the explorer's daydreams branch.
  const allDaydreamRefs = await listDaydreams({});
  const daydream_paths = allDaydreamRefs.map((d) => d.path);

  // Extra paths — docs/ and any other top-level folders not covered by
  // practices, stream, or daydreams. UI-only; gives the explorer a complete tree.
  const knownPrefixes = [
    `${STREAM_DIR}/`,
    `${DAYDREAMS_DIR}/`,
    `${PRACTICES_DIR}/`,
  ];
  const rootMetas = await adapter.listMeta(uid, "arkive/");
  const extra_paths = rootMetas
    .map((e) => e.path)
    .filter((p) => !knownPrefixes.some((prefix) => p.startsWith(prefix)))
    .filter(
      (p) =>
        ![
          "arkive/arkive.config",
          "arkive/arkive.index",
          "arkive/arkive.protocol.md",
          "arkive/identity.md",
          "arkive/loadup.md",
        ].includes(p),
    );

  const routing_hints_seen: Record<string, number> = {};
  for (const e of streamMetas) {
    const rt = (e.meta as Record<string, unknown> | undefined)?.routed_to;
    if (typeof rt === "string" && rt) {
      routing_hints_seen[rt] = (routing_hints_seen[rt] ?? 0) + 1;
    }
  }

  // ---- Index meta ----
  const indexEntry = await adapter.readEntry(uid, PATH_INDEX);
  let index_version = "1";
  let index_last_updated = now.toISOString();
  if (indexEntry) {
    try {
      const parsed = JSON.parse(indexEntry.body) as {
        version: number;
        last_updated: string;
      };
      index_version = String(parsed.version);
      index_last_updated = parsed.last_updated ?? index_last_updated;
    } catch {
      // ignore — readIndex will rebuild on next read
    }
  } else {
    try {
      const fresh = await readIndex();
      index_version = String(fresh.version);
      index_last_updated = fresh.last_updated;
    } catch (err) {
      // Read-only filesystem (Vercel) — the index rebuild couldn't persist.
      // The bundle still loads; graph / backlinks will be empty until a
      // writable storage backend is connected.
      console.error("index rebuild failed (non-fatal):", err);
    }
  }

  // Emergence scan — pattern candidates + practice suggestions. Best-effort;
  // a failure here can never break read_arkive (the AI can still operate
  // without emergence hints).
  let pattern_candidates: PatternCandidate[] = [];
  let practice_suggestions: PracticeSuggestion[] = [];
  try {
    const installed_practice_names = Object.keys(config.practices);
    const report = await scanEmergence({ installed_practice_names });
    pattern_candidates = report.pattern_candidates;
    practice_suggestions = report.practice_suggestions;
  } catch (err) {
    console.error("emergence scan failed (non-fatal):", err);
  }

  const capability = buildCapabilityManifest(
    practices,
    observation_count,
    routing_hints_seen,
    pattern_candidates,
    practice_suggestions,
  );

  return {
    current_date: now.toISOString().slice(0, 10),
    capability,
    protocol: protocolEntry
      ? { path: protocolEntry.path, body: stripFrontmatter(protocolEntry.body) }
      : null,
    identity: identityEntry ? projectEntry(identityEntry) : null,
    loadup: loadupEntry ? projectEntry(loadupEntry) : null,
    config,
    practices,
    recent_observations,
    observation_count,
    notices,
    daydream_count: notices.length,
    daydream_paths,
    extra_paths,
    index_version,
    index_last_updated,
  };
}

// ============================================================================
// Model-facing projection — compact the rich bundle for the MCP read_arkive
// tool so the model isn't handed every body verbatim. The UI route keeps the
// raw bundle (it renders the file explorer + full content); ONLY the MCP
// boundary applies this. The HOT tier — identity, loadup, capability manifest,
// protocol, and each active practice's context + pending_insights +
// instructions — stays WHOLE so the model is never starved of current state.
// The BULK — full recent bodies and the all_paths/daydream_paths firehose — is
// snippeted or dropped, leaving exact counts + path summaries so the model can
// read_entity on demand.
// ============================================================================

/** Recent observations shown WITH a snippet body (the rest are implied by
 *  observation_count + emergence candidates). */
const MODEL_RECENT_OBS = 10;
/** Recent journal entries per practice shown WITH a snippet body; the overflow
 *  is demoted to path+meta refs. */
const MODEL_RECENT_JOURNAL = 8;
/** Chars of body kept for a snippeted recent item. */
const MODEL_BODY_SNIPPET = 400;

const MODEL_LOADING_NOTE =
  "Bundle compacted for context economy. Counts (observation_count, " +
  "journal_by_entity_type, entry_count, daydream_count) are EXACT — answer " +
  "how-many / when / which from them; do not open files to count. Current " +
  "state (identity, loadup, context, pending_insights, instructions) is FULL. " +
  "Recent observations + journal are snippets; older journal, skills, and " +
  "accepted/rejected insights are listed by path only. Call read_entity(path) " +
  "for any full body, list_entries for a folder, traverse_index for links. " +
  "Do not reload what the bundle already contains.";

/** Project the rich bundle into the compact view the MCP read_arkive tool
 *  returns to the model. Pure + non-mutating. */
export function projectBundleForModel(b: ArkiveBundle): ArkiveBundle {
  return {
    ...b,
    loading_note: MODEL_LOADING_NOTE,
    recent_observations: b.recent_observations
      .slice(0, MODEL_RECENT_OBS)
      .map(snippetEntry),
    notices: b.notices.map((d) => ({ ...d, body: trimBody(d.body) })),
    daydream_paths: [],
    extra_paths: [],
    practices: b.practices.map(projectPracticeForModel),
  };
}

function projectPracticeForModel(p: LoadedPractice): LoadedPractice {
  // NON-ACTIVE (on_demand / private) practices are in standby (§0): the
  // capability manifest already lists them (mode, declared surface, population),
  // and the model loads them only when the conversation triggers them. So we
  // drop their heavy bodies — config + instructions + content — entirely; they
  // were the bulk of the bundle (full config + playbook per practice, even for
  // ones not in use). Counts stay so "how many entries in X" still answers.
  if (p.mode !== "active") {
    return {
      ...p,
      config: null,
      instructions: null,
      context: [],
      pending_insights: [],
      recent_journal: [],
      older_journal_summary: [],
      skill_index: [],
      all_paths: [],
      // journal_by_entity_type + entry_count kept (small, just counts).
    };
  }

  // ACTIVE practice — the full working brain stays (config declarations +
  // instructions playbook + context state + pending gate). Only the bulk is
  // trimmed: recent journal → snippeted head, overflow demoted to refs;
  // all_paths is UI-only.
  const shown = p.recent_journal
    .slice(0, MODEL_RECENT_JOURNAL)
    .map(snippetEntry);
  const overflow = p.recent_journal
    .slice(MODEL_RECENT_JOURNAL)
    .map((e) => buildEntryRef(e.path, e.meta));
  return {
    ...p,
    recent_journal: shown,
    older_journal_summary: [...overflow, ...p.older_journal_summary],
    all_paths: [], // UI-only; the model has entry_count + summaries + counts.
  };
}

function snippetEntry(e: Entry): Entry {
  return { ...e, body: trimBody(e.body) };
}

function trimBody(s: string): string {
  const flat = (s ?? "").trimEnd();
  if (flat.length <= MODEL_BODY_SNIPPET) return flat;
  return (
    flat.slice(0, MODEL_BODY_SNIPPET).trimEnd() +
    "\n\n…[truncated — read_entity for full body]"
  );
}

async function loadPractice(
  adapter: ReturnType<typeof storage>,
  uid: string,
  name: string,
  mode: "active" | "on_demand" | "private",
  globalConfig: ArkiveConfigFile,
): Promise<LoadedPractice> {
  const root = practiceRoot(name);
  const cfgEntry = await adapter.readEntry(uid, practiceConfigPath(name));
  const config = cfgEntry ? parsePracticeConfig(cfgEntry.body) : null;

  // Per-practice operational playbook (mutable). Loaded for every practice
  // regardless of mode so the UI can render it; the AI only acts on it for
  // active practices (the §0 protocol step is gated to active).
  const instructionsEntry = await adapter.readEntry(
    uid,
    practiceInstructionsPath(name),
  );
  const instructions = instructionsEntry
    ? projectEntry(instructionsEntry)
    : null;

  const emptyDigest: Omit<
    LoadedPractice,
    "name" | "mode" | "config" | "instructions" | "entry_count" | "all_paths"
  > = {
    context: [],
    pending_insights: [],
    recent_journal: [],
    older_journal_summary: [],
    journal_by_entity_type: {},
    skill_index: [],
  };

  // For on_demand / private practices: don't bulk-load. Still expose count
  // + every on-disk path so the explorer / graph stays faithful. Meta-only —
  // we need paths + count, never bodies.
  if (mode !== "active") {
    const all = await adapter.listMeta(uid, `${root}/`);
    const real = all.filter((e) => e.path !== practiceConfigPath(name));
    return {
      name,
      mode,
      config,
      instructions,
      ...emptyDigest,
      entry_count: real.length,
      all_paths: real.map((e) => e.path),
    };
  }

  // Active load — compacted per Phase 4 load economics. Only context/ and
  // insights/pending/ are bulk-loaded WITH bodies (both small); everything
  // else is listed METADATA-ONLY and bodies are fetched lazily for just the
  // capped recent-journal slice:
  //   - context/         full bodies (small, mutable state)
  //   - insights/pending FULL bodies (small, user gate)
  //   - journal/         META only → recent N fetched with bodies, rest summary
  //   - skills/          INDEX ONLY (situation-triggered, never bulk-loaded)
  const [contextEntries, journalMetas, pendingEntries, skillMetas, totalMetas] =
    await Promise.all([
      adapter.listEntries(uid, `${root}/context/`),
      adapter.listMeta(uid, `${root}/journal/`),
      adapter.listEntries(uid, `${root}/insights/pending/`),
      adapter.listMeta(uid, `${root}/skills/`),
      adapter.listMeta(uid, `${root}/`),
    ]);

  // Sort journal newest-first by path (which is timestamp-prefixed).
  const sortedJournal = journalMetas.sort((a, b) => (a.path < b.path ? 1 : -1));

  // Per-entity-type counts + latest_date. Meta only — no body load.
  const byType: Record<string, { count: number; latest_date: string | null }> =
    {};
  for (const e of sortedJournal) {
    const m = e.meta ?? {};
    const t = typeof m.entity_type === "string" ? m.entity_type : "unknown";
    const date =
      typeof m.created_at === "string"
        ? (m.created_at as string)
        : (e.path.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null);
    if (!byType[t]) byType[t] = { count: 0, latest_date: null };
    byType[t].count++;
    if (date && (!byType[t].latest_date || date > byType[t].latest_date)) {
      byType[t].latest_date = date;
    }
  }

  // Recent journal — capped tightly at RECENT_JOURNAL_FULL_BODY_CAP.
  // The recent_window_days config still applies but as an upper bound, not
  // the primary cap. Bodies fetched only for the capped slice.
  const cutoffMs =
    Date.now() - globalConfig.defaults.recent_window_days * 24 * 60 * 60 * 1000;
  const inWindow = sortedJournal.filter((e) =>
    withinCutoff(e.meta as Record<string, unknown>, e.path, cutoffMs),
  );
  const recentJournal = await fetchBodies(
    adapter,
    uid,
    inWindow.slice(0, RECENT_JOURNAL_FULL_BODY_CAP),
  );
  const olderJournalSummary: EntryRef[] = inWindow
    .slice(RECENT_JOURNAL_FULL_BODY_CAP)
    .slice(
      0,
      globalConfig.defaults.recent_max_entries - RECENT_JOURNAL_FULL_BODY_CAP,
    )
    .map((e) => buildEntryRef(e.path, e.meta));

  // Skills are always paths-only — situation-triggered, never bulk-loaded.
  const skillIndex: EntryRef[] = skillMetas
    .filter((e) => e.path.endsWith(".md"))
    .map((e) => buildEntryRef(e.path, e.meta));

  const real = totalMetas.filter((e) => e.path !== practiceConfigPath(name));
  return {
    name,
    mode,
    config,
    instructions,
    context: contextEntries.map(projectEntry),
    pending_insights: pendingEntries.map(projectEntry),
    recent_journal: recentJournal,
    older_journal_summary: olderJournalSummary,
    journal_by_entity_type: byType,
    skill_index: skillIndex,
    entry_count: real.length,
    all_paths: real.map((e) => e.path),
  };
}

function projectEntry(e: StoredEntry): Entry {
  const { meta, body } = parseFrontmatter(e.body);
  return { path: e.path, meta: meta as Record<string, unknown>, body };
}

/** Path + minimal meta → EntryRef. For older journal entries, skills, and any
 *  pile of files we don't bulk-load. Title comes from meta only (meta.title /
 *  meta.name), so this works off listMeta with no body scan. (Entries that put
 *  their title solely in a body H1 fall back to the filename in the UI — the
 *  right tradeoff: a ref's title belongs in its metadata.) */
function buildEntryRef(path: string, meta: Record<string, unknown>): EntryRef {
  const m = meta ?? {};
  let title: string | undefined;
  if (typeof m.title === "string") title = m.title;
  else if (typeof m.name === "string") title = m.name as string;
  return {
    path,
    entity_type: typeof m.entity_type === "string" ? m.entity_type : "unknown",
    title,
    created_at:
      typeof m.created_at === "string" ? (m.created_at as string) : undefined,
  };
}

/** Fetch full bodies for a SMALL, already-capped set of meta refs and project
 *  them to Entry, preserving the input order. ONE round-trip via readEntries —
 *  never an N+1 per-item read. Used only for the recent slices (stream +
 *  journal), never a whole list. */
async function fetchBodies(
  adapter: ReturnType<typeof storage>,
  uid: string,
  metas: StoredEntryMeta[],
): Promise<Entry[]> {
  if (metas.length === 0) return [];
  const fulls = await adapter.readEntries(
    uid,
    metas.map((m) => m.path),
  );
  const byPath = new Map(fulls.map((f) => [f.path, f] as const));
  return metas.map((m) => {
    const full = byPath.get(m.path);
    return full ? projectEntry(full) : { path: m.path, meta: m.meta, body: "" };
  });
}

/** Compose the top-of-bundle capability manifest. Folds the practice config
 *  declarations + the loaded population stats into a single concise summary
 *  the AI can read once at session start. */
function buildCapabilityManifest(
  practices: LoadedPractice[],
  observation_count: number,
  observation_routing_hints: Record<string, number>,
  pattern_candidates: PatternCandidate[],
  practice_suggestions: PracticeSuggestion[],
): CapabilityManifest {
  const installed: PracticeCapability[] = practices.map((p) => {
    const decl_tools: PracticeCapability["declared_tools"] = (
      p.config?.provides.mcp_tools ?? []
    ).map((t) => ({
      name: t.name,
      description: t.description,
      gate: t.requires_gate,
    }));
    const journalCount = Object.values(p.journal_by_entity_type).reduce(
      (s, v) => s + v.count,
      0,
    );
    const lastActivity =
      Object.values(p.journal_by_entity_type)
        .map((v) => v.latest_date)
        .filter((d): d is string => typeof d === "string")
        .sort()
        .pop() ?? null;
    let status: PopulationStatus = "empty";
    if (p.entry_count === 0) status = "empty";
    else if (journalCount === 0 && p.context.length === 0)
      status = "awaiting_structure";
    else if (journalCount + p.context.length < 3)
      status = "partially_populated";
    else status = "populated";

    return {
      name: p.name,
      mode: p.mode,
      version: p.config?.version ?? "0.0.0",
      declared_entity_types: (
        p.config?.provides.journal_entity_types ?? []
      ).map((e) => e.name),
      declared_context_files: (p.config?.provides.context_files ?? []).map(
        (c) => c.name,
      ),
      declared_link_types: (p.config?.provides.link_types ?? []).map(
        (l) => l.name,
      ),
      declared_tools: decl_tools,
      population: {
        status,
        journal_entry_count: journalCount,
        context_file_count: p.context.length,
        skill_count: p.skill_index.length,
        pending_insight_count: p.pending_insights.length,
        last_activity: lastActivity,
      },
    };
  });

  return {
    protocol_version: PROTOCOL_VERSION,
    universal_entity_types: [...UNIVERSAL_ENTITY_TYPES],
    universal_link_types: [...UNIVERSAL_LINK_TYPES],
    installed_practices: installed,
    stream: {
      observation_count,
      routing_hints_seen: observation_routing_hints,
    },
    pattern_candidates,
    practice_suggestions,
  };
}

function stripFrontmatter(s: string): string {
  const { body } = parseFrontmatter(s);
  return body;
}

function withinCutoff(
  meta: Record<string, unknown> | undefined,
  path: string,
  cutoffMs: number,
): boolean {
  if (meta && typeof meta.created_at === "string") {
    const t = Date.parse(meta.created_at as string);
    if (Number.isFinite(t)) return t >= cutoffMs;
  }
  const m = path.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const t = Date.parse(m[1]);
    if (Number.isFinite(t)) return t >= cutoffMs;
  }
  return true;
}

// ---- One-shot heal for context files damaged by the pre-v6.4 writer -------
//
// Scope: any file under arkive/practices/<name>/context/ whose body still
// contains the literal seed placeholder line (e.g. "_No rules captured
// yet._") AND has additional content beneath. Strip the placeholder, leave
// everything else as-is. Idempotent — files that don't match are skipped.

/** Placeholder strings the original seeds shipped with. Used to detect
 *  damaged context files where an append left the placeholder sitting
 *  next to real content. */
const CONTEXT_PLACEHOLDER_LINES = [
  "_No watchlist entries yet._",
  "_No open positions._",
  "_No rules captured yet._",
  "_No active intentions._",
];

/** Detect content the pre-v7.x writer misrouted to arkive/practices/core/*
 *  and migrate it to the canonical root path. Idempotent + safe — only
 *  promotes when the canonical file is still in placeholder state.
 *
 *  Currently handles: identity.md, loadup.md. Add more as bugs surface.
 */
async function healMisroutedCoreFiles(
  adapter: ReturnType<typeof storage>,
  uid: string,
): Promise<void> {
  const candidates: Array<{
    misrouted: string;
    canonical: string;
    entity_type: string;
    /** Substrings that mean the canonical file is still a placeholder
     *  (no real user content yet → safe to overwrite). */
    placeholderMarkers: string[];
  }> = [
    {
      misrouted: `${PRACTICES_DIR}/core/identity.md`,
      canonical: PATH_IDENTITY,
      entity_type: "identity",
      placeholderMarkers: ["Fill this in during onboarding"],
    },
    {
      misrouted: `${PRACTICES_DIR}/core/loadup.md`,
      canonical: PATH_LOADUP,
      entity_type: "loadup",
      placeholderMarkers: [
        "Edit this file to tell Ark",
        "Examples (delete these, write your own)",
      ],
    },
  ];

  for (const c of candidates) {
    const misroutedEntry = await adapter.readEntry(uid, c.misrouted);
    if (!misroutedEntry) continue;
    const { meta: misMeta, body: misBody } = parseFrontmatter(
      misroutedEntry.body,
    );
    if (!misBody.trim()) {
      // Nothing real to migrate — just delete the empty misrouted file.
      await adapter.deleteEntry(uid, c.misrouted);
      continue;
    }

    const canonicalEntry = await adapter.readEntry(uid, c.canonical);
    const canonicalIsPlaceholder = canonicalEntry
      ? c.placeholderMarkers.some((m) => canonicalEntry.body.includes(m))
      : true;

    if (!canonicalIsPlaceholder) {
      // The canonical file already has real user content. Don't overwrite —
      // leave the misrouted file in place too so the data isn't lost.
      // (The user can manually merge if needed; we don't guess.)
      continue;
    }

    // Promote: write the misrouted body to the canonical path with proper
    // frontmatter, then delete the misrouted file.
    const now = new Date().toISOString();
    const mm = (misMeta ?? {}) as Record<string, unknown>;
    const meta: Record<string, unknown> = {
      entity_type: c.entity_type,
      practice: "core",
      created_at: typeof mm.created_at === "string" ? mm.created_at : now,
      last_updated: now,
      version: typeof mm.version === "number" ? mm.version : 1,
    };
    await adapter.writeEntry(uid, {
      path: c.canonical,
      body: serializeEntry(
        meta,
        misBody.endsWith("\n") ? misBody : misBody + "\n",
      ),
      meta,
    });
    await adapter.deleteEntry(uid, c.misrouted);
  }
}

async function healPlaceholdersInContextFiles(
  adapter: ReturnType<typeof storage>,
  uid: string,
): Promise<void> {
  // List meta only, then batch-read the bodies for context files alone. The
  // heal needs the body to detect a placeholder, but only context/*.md files
  // qualify — so we don't drag every journal entry's body through this one-shot
  // scan, and we read the qualifying few in a single round-trip.
  const metas = await adapter.listMeta(uid, `${PRACTICES_DIR}/`);
  const contextPaths = metas
    .filter((ref) => /\/context\/[^/]+\.md$/.test(ref.path))
    .map((ref) => ref.path);
  const contextEntries = await adapter.readEntries(uid, contextPaths);
  for (const e of contextEntries) {
    const { meta, body } = parseFrontmatter(e.body);
    const placeholder = CONTEXT_PLACEHOLDER_LINES.find((p) => body.includes(p));
    if (!placeholder) continue;
    // Strip the placeholder line + any blank padding around it.
    const cleaned = body
      .split(/\r?\n/)
      .filter((line) => line.trim() !== placeholder)
      .join("\n")
      .replace(/^\s*\n+/, "")
      .replace(/\n{3,}/g, "\n\n");
    // If the only thing in the file WAS the placeholder, leave it — the
    // file is still in its honest "empty" state.
    if (cleaned.trim().length === 0) continue;
    const m = (meta ?? {}) as Record<string, unknown>;
    m.last_updated = new Date().toISOString();
    await adapter.writeEntry(uid, {
      path: e.path,
      body: serializeEntry(m, cleaned.trim() + "\n"),
      meta: m,
    });
  }
}
