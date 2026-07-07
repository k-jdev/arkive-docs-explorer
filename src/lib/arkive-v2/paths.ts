// Arkive path constants — arkive-core-v1.
//
// Per the Open Data Model Specification (v1):
//
//   arkive/
//   ├── identity.md            ← universal root file
//   ├── arkive.protocol.md     ← universal root file
//   ├── arkive.config          ← universal root file (PURE YAML)
//   ├── arkive.index           ← universal root file (auto-maintained JSON)
//   │
//   └── practices/
//       └── <practice-name>/
//           ├── practice.config
//           ├── journal/<entity-subfolders>/
//           ├── skills/        +  _archive/
//           ├── insights/      pending/ accepted/ rejected/
//           └── context/<files>
//
// Cross-practice files (the four root files) stay at arkive root.
// Everything practice-specific lives under arkive/practices/<name>/.

export const V2_ROOT = "arkive";

// ---- Four universal root files ---------------------------------------------

export const PATH_IDENTITY = `${V2_ROOT}/identity.md`;
export const PATH_PROTOCOL = `${V2_ROOT}/arkive.protocol.md`;
/**
 * User-controlled session-start preferences. Brief; the user mutates
 * this file to say what they want surfaced at the top of every session
 * (e.g. "tell me my open trade positions" or "show me overdue watch
 * payments"). Single source of truth for session-start behavior — the
 * MCP `instructions` field defers entirely to it.
 */
export const PATH_LOADUP = `${V2_ROOT}/loadup.md`;
/** Pure YAML — declares installed practices + global defaults. */
export const PATH_CONFIG = `${V2_ROOT}/arkive.config`;
/** Auto-maintained typed link graph in JSON. Rebuildable from frontmatter scan. */
export const PATH_INDEX = `${V2_ROOT}/arkive.index`;

// ---- Universal stream ------------------------------------------------------
//
// Single global stream of raw observations. Writes here NEVER fail — no
// schema validation, no required practice-routing decision. Practices
// retrieve relevant observations via the routing layer; emergence + intake
// projects observations into structured journal entries (with a
// `created_from` link back to the source observations) once structure is
// genuinely earned (§3 of the rebuild spec).
//
// Layout: arkive/stream/<YYYY-MM>/<isoTimestamp>-<8charHash>.md
//   - Monthly partitioning so any single folder stays walkable.
//   - One file per observation — no concurrent-write contention, easy to
//     append, easy to project.

export const STREAM_DIR = `${V2_ROOT}/stream`;

/** Bucket a timestamp into YYYY-MM. */
export function streamMonthPartition(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7);
}

/** Build a stream observation path from a timestamp + short hash. */
export function streamObservationPath(args: {
  isoTimestamp: string;
  shortHash: string;
}): string {
  const safeStamp = args.isoTimestamp.replace(/[:.]/g, "-");
  return `${STREAM_DIR}/${streamMonthPartition(args.isoTimestamp)}/${safeStamp}-${args.shortHash}.md`;
}

// ---- Daydreams -------------------------------------------------------------
//
// The autonomous loop's own thought store — a sibling of the stream at the
// arkive root, NOT inside any practice (constitution C7). Same monthly
// partitioning + one-file-per-thought layout as the stream:
//   arkive/daydreams/<YYYY-MM>/<safeTimestamp>-<8charHash>.md
// Daydreams are hypotheses, never fact (C3); the wall is folder location +
// read-time framing, never a frontmatter flag.

export const DAYDREAMS_DIR = `${V2_ROOT}/daydreams`;

/** Build a daydream path from a timestamp + short hash. Mirrors
 *  streamObservationPath — reuses streamMonthPartition for identical bucketing. */
export function daydreamPath(args: {
  isoTimestamp: string;
  shortHash: string;
}): string {
  const safeStamp = args.isoTimestamp.replace(/[:.]/g, "-");
  return `${DAYDREAMS_DIR}/${streamMonthPartition(args.isoTimestamp)}/${safeStamp}-${args.shortHash}.md`;
}

// ---- Practices --------------------------------------------------------------

export const PRACTICES_DIR = `${V2_ROOT}/practices`;

/** Build a practice's root path: arkive/practices/<slug>.
 *
 *  The name is ALWAYS slugified here so every path helper (config, journal,
 *  context, …) routes to the same canonical directory. create_practice stores
 *  under slugifyPractice(name); without normalizing here, a later write that
 *  passed the display name ("Trading Rules" instead of "trading-rules") would
 *  resolve to a different, unregistered directory — the write would "succeed"
 *  into an orphan folder while the real practice stayed empty. slugifyPractice
 *  is idempotent, so an already-slugged name is unchanged. */
export const practiceRoot = (practice: string) => `${PRACTICES_DIR}/${slugifyPractice(practice)}`;

/** Practice config file (pure YAML body, no frontmatter). */
export const practiceConfigPath = (practice: string) =>
  `${practiceRoot(practice)}/practice.config`;

/** Practice operational playbook — markdown the user (or practice author)
 *  edits to tell the AI HOW to act inside this specific practice. Loaded
 *  at session start for every active practice. Trading ships a full one;
 *  user-created practices get a minimal template. */
export const practiceInstructionsPath = (practice: string) =>
  `${practiceRoot(practice)}/practice.instructions.md`;

/** Practice's journal root — practice declares <entity-type> subfolders. */
export const practiceJournalDir = (practice: string) => `${practiceRoot(practice)}/journal`;

/** Practice's skills root + archive. */
export const practiceSkillsDir = (practice: string) => `${practiceRoot(practice)}/skills`;
export const practiceSkillsArchiveDir = (practice: string) =>
  `${practiceRoot(practice)}/skills/_archive`;

/** Practice's insights root + three status subfolders. */
export const practiceInsightsDir = (practice: string) =>
  `${practiceRoot(practice)}/insights`;
export const practiceInsightStatusDir = (
  practice: string,
  status: "pending" | "accepted" | "rejected"
) => `${practiceRoot(practice)}/insights/${status}`;

/** Practice's context root — practice declares the files. */
export const practiceContextDir = (practice: string) =>
  `${practiceRoot(practice)}/context`;

// ---- Helpers ---------------------------------------------------------------

export function slugifyPractice(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function practiceNameFromPath(path: string): string | null {
  if (!path.startsWith(`${PRACTICES_DIR}/`)) return null;
  const rest = path.slice(PRACTICES_DIR.length + 1);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

export function slugifyToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoWeek(d: Date = new Date()): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  const week = 1 + Math.round((diff / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function shortHash(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

