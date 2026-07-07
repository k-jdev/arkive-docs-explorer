// UI-facing types — mirror the arkive-core-v1 bundle shape from read-bundle.ts.

export type Entry = { path: string; meta: Record<string, unknown>; body: string };

export type LoadedPractice = {
  name: string;
  mode: "active" | "on_demand" | "private";
  /** Full practice.config — declarations only, no I/O. */
  config: {
    name: string;
    version: string;
    based_on: string;
    description: string;
    provides: {
      journal_entity_types: Array<{
        name: string;
        folder: string;
        schema: { required: string[]; optional?: string[] };
        append_only: boolean;
      }>;
      context_files: Array<{ name: string; purpose: string; schema: "structured" | "free_form" }>;
      skill_format: {
        description: string;
        required_sections: string[];
        envelope_required: boolean;
      };
      mcp_tools?: Array<{ name: string; requires_gate: "none" | "one_tap" | "hard_confirm" }>;
    };
    loading: { default_mode: "active" | "on_demand" | "private"; triggers?: string[] };
  } | null;
  /** Per-practice operational playbook (mutable). */
  instructions: Entry | null;
  context: Entry[];
  /** Recent journal entries with full bodies (capped at ~15 per Phase 4). */
  recent_journal: Entry[];
  /** Older journal entries — paths + meta only. The UI lists them but doesn't load bodies until clicked. */
  older_journal_summary: EntryRef[];
  /** Aggregate journal counts by entity_type (powers stats / "X trades, Y research"). */
  journal_by_entity_type: Record<string, { count: number; latest_date: string | null }>;
  /** Skills index — paths + name + status. Skills are never bulk-loaded. */
  skill_index: EntryRef[];
  pending_insights: Entry[];
  entry_count: number;
  /** Every on-disk path inside this practice (no bodies). */
  all_paths: string[];
};

export type EntryRef = {
  path: string;
  entity_type: string;
  title?: string;
  created_at?: string;
};

export type ArkiveConfig = {
  version: string;
  identity_ref: string;
  protocol_ref: string;
  practices: Record<
    string,
    { enabled: boolean; mode: "active" | "on_demand" | "private"; version: string }
  >;
  defaults: {
    weekly_recap: boolean;
    monthly_retrospective: boolean;
    insight_evidence_threshold: number;
    rejection_cooldown_threshold: number;
    conversation_timeout_min: number;
    recent_window_days: number;
    recent_max_entries: number;
    /** Cadence for the autonomous daydream loop. Mirrors ArkiveConfigDefaults. */
    daydream_frequency: "off" | "daily" | "frequent";
  };
};

export type CapabilityManifest = {
  protocol_version: string;
  universal_entity_types: string[];
  universal_link_types: string[];
  installed_practices: Array<{
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
      status: "empty" | "awaiting_structure" | "partially_populated" | "populated";
      journal_entry_count: number;
      context_file_count: number;
      skill_count: number;
      pending_insight_count: number;
      last_activity: string | null;
    };
  }>;
  stream: {
    observation_count: number;
    routing_hints_seen: Record<string, number>;
  };
  /** Emergence — observation clusters above threshold the AI may
   *  formulate into propose_insight calls. */
  pattern_candidates: Array<{
    group_by: "kind" | "mention";
    key: string;
    sample_paths: string[];
    count: number;
    most_routed_to?: string;
    threshold_progress: number;
    most_recent_date: string;
  }>;
  /** Nonexistent practices the user has been routing observations to. */
  practice_suggestions: Array<{
    proposed_name: string;
    observation_count: number;
    sample_paths: string[];
    first_seen: string;
    last_seen: string;
  }>;
};

export type Bundle = {
  current_date: string;
  /** Top-of-bundle capability surface (Phase 4 §7). */
  capability: CapabilityManifest;
  protocol: { path: string; body: string } | null;
  identity: Entry | null;
  /** User-controlled session-start preferences. Single source of truth
   *  for what the AI surfaces when you open Ark. */
  loadup: Entry | null;
  config: ArkiveConfig;
  practices: LoadedPractice[];
  /** Recent slice of the universal observation stream — newest first,
   *  bodies included. The freshest raw signal from the user; structured
   *  practice content is what gets surfaced from the rest of the bundle. */
  recent_observations: Entry[];
  /** Total observation count on disk. */
  observation_count: number;
  /** Surfaced daydreams (the loop's hypotheses) shown as read-only Notices.
   *  Mirrors ArkiveBundle.notices (Daydream[]); the loose Entry shape carries
   *  the same {path, meta, body} wire shape, like recent_observations. The
   *  daydream salience signals live in meta (confidence, recurrence, surfaced,
   *  evidence, created_from, practices). */
  notices: Entry[];
  /** Count of surfaced daydreams — Notices tab badge. */
  daydream_count: number;
  /** Every daydream file path on disk — powers the explorer's daydreams branch. */
  daydream_paths: string[];
  extra_paths: string[];
  index_version: string;
  index_last_updated: string;
};

export type TreeNode = {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
};

export type Tab =
  | { kind: "overview"; id: "__overview__"; title: string }
  | { kind: "daydreams"; id: "__daydreams__"; title: string }
  | { kind: "landing"; id: "__landing__"; title: string }
  | { kind: "file"; id: string; title: string };
