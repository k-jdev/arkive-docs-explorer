// Arkive schemas — arkive-core-v1.
//
// Universal types only. Trading-practice-specific frontmatter shapes are
// declared in trading's practice.config (§12 of the spec), not here.

// ============================================================================
// §5. Universal frontmatter — EVERY entity in any practice must have these
// ============================================================================

export type UniversalFrontmatter = {
  /** Must match a universal or practice-declared entity type. */
  entity_type: string;
  /** Practice slug, OR "core" for the four root files. */
  practice: string;
  /** ISO 8601 timestamp. */
  created_at: string;
};

/** Universal link fields (§6). Every entity may carry any subset. */
export type UniversalLinks = {
  sources?: string[];
  evidence?: string[];
  triggered_by?: string[];
  produced?: string[];
  resulted_in?: string[];
  applied_to?: string[];
  created_from?: string[];
};

/** The six universal link types per §6. */
export const UNIVERSAL_LINK_TYPES = [
  "sources",
  "evidence",
  "triggered_by",
  "produced",
  "resulted_in",
  "applied_to",
  "created_from",
] as const;
export type UniversalLinkType = (typeof UNIVERSAL_LINK_TYPES)[number];

/** Universal entity types. Practice-declared types come from
 *  practice.config; this enum lists ONLY the universals.
 *
 *  - identity            — who the user is
 *  - protocol            — universal behavioral contract
 *  - config              — arkive.config (declarative)
 *  - index               — arkive.index (auto-maintained link graph)
 *  - loadup              — user-owned session-start preferences
 *  - observation         — raw capture in the universal stream (NEVER fails)
 *  - daydream            — the autonomous loop's own unverified thought (hypothesis,
 *                          NEVER fact); lives in the engine-owned arkive/daydreams store
 *  - insight             — pattern proposed across observations / journal entries
 *  - skill               — versioned playbook
 *  - practice_instructions — operational playbook owned by each practice
 */
export const UNIVERSAL_ENTITY_TYPES = [
  "identity",
  "protocol",
  "config",
  "index",
  "loadup",
  "observation",
  "daydream",
  "insight",
  "skill",
  "practice_instructions",
] as const;
export type UniversalEntityType = (typeof UNIVERSAL_ENTITY_TYPES)[number];

// ============================================================================
// Daydream frontmatter — the autonomous loop's own thoughts (engine substrate).
//
// Modeled on stream.ts ObservationMeta. A daydream is a HYPOTHESIS, never a
// fact (constitution C3). Daydreams are engine-owned and global — they live at
// arkive/daydreams/ (a sibling of arkive/stream/, NOT inside any practice — C7)
// and carry an optional practice tag purely for scoping. The wall between fact
// and hypothesis is enforced by folder location + read-time framing, never by
// this frontmatter.
// ============================================================================

export type DaydreamMeta = {
  entity_type: "daydream";
  /** Always "core": owned by the engine, not by a practice (C7). Scoping is
   *  via `practices` below. */
  practice: "core";
  /** ISO 8601 — moment the thought was generated. */
  created_at: string;
  /** Practice tag(s) this thought concerns; [] or omitted = cross-cutting / none.
   *  A daydream with no practices is valid on a zero-practice arkive (C1). */
  practices?: string[];

  // --- salience signals (loop-facing; drive surfacing) ---
  /** 0..1, model-assigned at generation. */
  confidence?: number;
  /** How many times the loop has re-arrived at this thought. */
  recurrence?: number;
  /** ISO — most recent run that reinforced it. */
  last_seen?: string;

  // --- presentation state (human-facing; SEPARATE from salience) ---
  /** true = appears as a read-only Notice. DERIVED from salience but stored
   *  separately, so we can later weight a thought without showing it (or show
   *  one we don't weight highly). v1 derives it from a simple rule (see loop). */
  surfaced?: boolean;

  // --- provenance ---
  /** Paths to the stream/journal entries this thought is grounded in. */
  evidence?: string[];
  /** Paths to prior DAYDREAMS this thought built on (reflective chain). */
  created_from?: string[];
  /** If this daydream graduated to an insight, the insight path. */
  promoted_to?: string;
};

// ============================================================================
// §3. Root-file frontmatter shapes
// ============================================================================

export type IdentityFrontmatter = UniversalFrontmatter & {
  entity_type: "identity";
  practice: "core";
  last_updated: string;
  version: number;
};

export type ProtocolFrontmatter = UniversalFrontmatter & {
  entity_type: "protocol";
  practice: "core";
  last_updated: string;
  version: number;
};

// ============================================================================
// §3. arkive.config — pure YAML, no frontmatter
// ============================================================================

export type ArkiveConfigPracticeRegistration = {
  enabled: boolean;
  /** active = bulk-loaded on session start.
   *  on_demand = standby; loads when conversation hits its triggers.
   *  private = never auto-loaded; explicit invitation only. */
  mode: "active" | "on_demand" | "private";
  /** Semver of the installed practice. */
  version: string;
};

/** How often the autonomous daydream loop runs (CP4). The engine stores +
 *  exposes this; an external scheduler reads it. "off" = never auto-run. */
export type DaydreamFrequency = "off" | "daily" | "frequent";

export type ArkiveConfigDefaults = {
  weekly_recap: boolean;
  monthly_retrospective: boolean;
  insight_evidence_threshold: number;
  rejection_cooldown_threshold: number;
  conversation_timeout_min: number;
  recent_window_days: number;
  recent_max_entries: number;
  /** Cadence for the autonomous daydream loop. Defaults to "off" — the loop
   *  costs model tokens, so it never runs until the user opts in. */
  daydream_frequency: DaydreamFrequency;
};

export type ArkiveConfigFile = {
  /** Hard-coded "arkive-core-v1" for this spec version. */
  version: string;
  identity_ref: string;
  protocol_ref: string;
  practices: Record<string, ArkiveConfigPracticeRegistration>;
  defaults: ArkiveConfigDefaults;
};

export const ARKIVE_CORE_VERSION = "arkive-core-v1";

export const DEFAULT_ARKIVE_DEFAULTS: ArkiveConfigDefaults = {
  weekly_recap: true,
  monthly_retrospective: true,
  insight_evidence_threshold: 3,
  rejection_cooldown_threshold: 10,
  conversation_timeout_min: 30,
  recent_window_days: 30,
  recent_max_entries: 200,
  daydream_frequency: "off",
};

// ============================================================================
// §11. practice.config — pure YAML, no frontmatter
// ============================================================================

export type EntityTypeSchema = {
  required: string[];
  optional?: string[];
};

export type AllowedMutations = {
  /** Status-field transitions, format "<from>_to_<to>". */
  status_field?: string[];
  /** Named sections that may be appended to the body. */
  body_appends?: string[];
};

export type JournalEntityTypeDeclaration = {
  name: string;
  folder: string;
  schema: EntityTypeSchema;
  append_only: boolean;
  allowed_mutations?: AllowedMutations;
};

export type ContextFileDeclaration = {
  name: string;
  purpose: string;
  schema: "structured" | "free_form";
  structured_fields?: Array<{ [field: string]: string }>;
  update_triggers: string[];
  /**
   * How the runtime updates this Class-2 context file (both modes are still
   * Class-2 full-body replaces per §4 — this only controls whether prior
   * content is preserved):
   *   - "replace"    — STATE context: overwrite with the new state (current
   *                    program, open positions, current metrics). DEFAULT.
   *   - "accumulate" — TRUTH/PATTERN context: a growing record of learned
   *                    truths/rules. The runtime reads the current body and
   *                    APPENDS a new entry (non-destructive). This is where
   *                    accepted insights land.
   * Omitted ⇒ "replace" (back-compatible: existing context files are state).
   */
  update_mode?: "replace" | "accumulate";
};

export type SkillFormatDeclaration = {
  description: string;
  required_sections: string[];
  optional_sections?: string[];
  versioning: "semver_per_skill" | "integer_per_skill";
  envelope_required: boolean;
};

export type LinkTypeDeclaration = {
  name: string;
  description: string;
};

export type McpToolDeclaration = {
  name: string;
  description: string;
  requires_gate: "none" | "one_tap" | "hard_confirm";
};

export type ConstraintDeclaration = {
  name: string;
  description: string;
};

export type LoadingDeclaration = {
  default_mode: "active" | "on_demand" | "private";
  triggers?: string[];
};

export type InsightFlowDeclaration = {
  default_output: "skill" | "context" | "both" | "ask_user";
  evidence_threshold: number;
  evidence_types?: string[];
  rejection_cooldown_threshold: number;
};

export type StarterPackDeclaration = {
  seed_skills?: string[];
  seed_context?: string[];
  initial_intentions?: string[];
};

export type PracticeConfigFile = {
  // Required identification
  name: string;
  version: string;       // semver
  based_on: string;      // typically "arkive-core-v1"
  description: string;

  // Optional metadata
  author?: string;
  license?: string;

  // What this practice provides
  provides: {
    journal_entity_types: JournalEntityTypeDeclaration[];
    context_files: ContextFileDeclaration[];
    skill_format: SkillFormatDeclaration;
    link_types?: LinkTypeDeclaration[];
    mcp_tools?: McpToolDeclaration[];
    constraints?: ConstraintDeclaration[];
  };

  loading: LoadingDeclaration;
  insight_flow: InsightFlowDeclaration;
  starter_pack?: StarterPackDeclaration;
};

// ============================================================================
// §4 / §8. Insight + Skill frontmatter shapes (universal)
// ============================================================================

export type InsightFrontmatter = UniversalFrontmatter & {
  entity_type: "insight";
  status: "pending" | "accepted" | "rejected";
  evidence: string[];
  triggered_by?: string[];
  proposed_output: "skill" | "context" | "both" | "ask_user";
  /**
   * For a context/both insight: which of the practice's declared context files
   * the accepted insight should land in (e.g. "rules.md"). Chosen by the model
   * at propose-time (placement = judgment). The runtime resolves the file's
   * update_mode to decide replace vs accumulate. Omitted ⇒ the accept path
   * falls back to the practice's first accumulate (TRUTH) context file.
   */
  target_context_file?: string;
  resolution_date?: string;
  cooldown_until?: string;
};

export type SkillFrontmatter = UniversalFrontmatter & {
  entity_type: "skill";
  last_updated: string;
  version: number;
  name: string;
  status: "active" | "paused" | "retired";
  /** Practice-specific risk_envelope (or whatever the practice requires). */
  [key: string]: unknown;
};
