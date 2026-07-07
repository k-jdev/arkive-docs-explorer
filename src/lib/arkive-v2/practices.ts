// Practices — the §7 four-folder shape + the §11 practice.config schema.
//
// A practice is the unit of domain extension. Each one ships a single
// practice.config (pure YAML) and a folder tree following the universal
// structure. The runtime never hard-codes any practice — it reads the
// config and operates against the declarations.

import { storage, currentUserId } from "@/lib/storage";
import {
  PRACTICES_DIR,
  practiceConfigPath,
  practiceContextDir,
  practiceInsightStatusDir,
  practiceInstructionsPath,
  practiceJournalDir,
  practiceNameFromPath,
  practiceRoot,
  practiceSkillsDir,
  slugifyPractice,
} from "./paths";
import { defaultPracticeInstructions } from "./seeds";
import { isAuthoredPractice, isReservedPractice } from "./authored";
import { parseFrontmatter } from "./frontmatter";
import {
  ARKIVE_CORE_VERSION,
  UNIVERSAL_ENTITY_TYPES,
  UNIVERSAL_LINK_TYPES,
  type ConstraintDeclaration,
  type ContextFileDeclaration,
  type InsightFlowDeclaration,
  type JournalEntityTypeDeclaration,
  type LinkTypeDeclaration,
  type McpToolDeclaration,
  type PracticeConfigFile,
} from "./schemas";

// ============================================================================
// Color palette (used by the workspace UI for per-practice node tinting).
// ============================================================================

export const PRACTICE_PALETTE = [
  "#2E68F4", "#EAB308", "#14B8A6", "#A78BFA", "#F472B6", "#5BC0EB",
  "#F97316", "#10B981", "#EF4444", "#94A3B8", "#FB7185", "#84CC16",
] as const;

function fallbackColorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PRACTICE_PALETTE[h % PRACTICE_PALETTE.length];
}

export type PracticeSummary = {
  name: string;
  display_name: string;
  description: string;
  path: string;
  config: PracticeConfigFile | null;
  entry_count: number;
  verified: boolean;
  color: string;
  entries: Array<{ path: string; meta: Record<string, unknown>; body: string }>;
};

// ============================================================================
// Reads
// ============================================================================

export async function listPractices(): Promise<PracticeSummary[]> {
  const { parseFrontmatter } = await import("./frontmatter");
  const uid = await currentUserId();
  const adapter = storage();
  const all = await adapter.listEntries(uid, `${PRACTICES_DIR}/`);

  const byPractice = new Map<string, typeof all>();
  for (const e of all) {
    const name = practiceNameFromPath(e.path);
    if (!name) continue;
    if (!byPractice.has(name)) byPractice.set(name, []);
    byPractice.get(name)!.push(e);
  }

  const out: PracticeSummary[] = [];
  for (const [name, entries] of byPractice) {
    const configEntry = entries.find((e) => e.path === practiceConfigPath(name));
    const config = configEntry ? parsePracticeConfig(configEntry.body) : null;

    const realEntries = entries.filter((e) => e.path !== practiceConfigPath(name));
    const entriesProjection = realEntries.map((e) => {
      const { meta, body } = parseFrontmatter(e.body);
      return { path: e.path, meta: meta as Record<string, unknown>, body };
    });

    out.push({
      name,
      display_name: config?.name ?? name,
      description: config?.description ?? "",
      path: practiceRoot(name),
      config,
      entry_count: realEntries.length,
      verified: isAuthoredPractice(name),
      color: fallbackColorFor(name),
      entries: entriesProjection,
    });
  }

  out.sort((a, b) => {
    const aAuthored = isAuthoredPractice(a.name);
    const bAuthored = isAuthoredPractice(b.name);
    if (aAuthored && !bAuthored) return -1;
    if (bAuthored && !aAuthored) return 1;
    return a.display_name.localeCompare(b.display_name);
  });
  return out;
}

export async function getPracticeConfig(name: string): Promise<PracticeConfigFile | null> {
  const uid = await currentUserId();
  const entry = await storage().readEntry(uid, practiceConfigPath(name));
  if (!entry) return null;
  return parsePracticeConfig(entry.body);
}

// ============================================================================
// Writes
// ============================================================================

export async function installPractice(args: {
  config: PracticeConfigFile;
  mode?: "active" | "on_demand" | "private";
}): Promise<{ name: string; path: string }> {
  const validation = validatePracticeConfig(args.config);
  if (!validation.valid) {
    throw new Error(`Invalid practice.config: ${validation.errors.join("; ")}`);
  }
  const name = args.config.name;
  const uid = await currentUserId();
  const adapter = storage();
  const root = practiceRoot(name);

  await adapter.writeEntry(uid, {
    path: practiceConfigPath(name),
    body: serializePracticeConfig(args.config),
    meta: {},
  });

  // Seed a default operational-instructions template so the AI knows the
  // user can shape behavior here. Only on first install — never overwrite
  // an existing one. The trading practice ships a full playbook elsewhere
  // (via reset/migration), so we still write a fresh one only if missing.
  const existingInstr = await adapter.readEntry(uid, practiceInstructionsPath(name));
  if (!existingInstr) {
    const template = defaultPracticeInstructions(name);
    const { meta: instrMeta } = parseFrontmatter(template);
    await adapter.writeEntry(uid, {
      path: practiceInstructionsPath(name),
      body: template,
      meta: (instrMeta ?? {}) as Record<string, unknown>,
    });
  }

  const { readArkiveConfig, writeArkiveConfig } = await import("./arkive-config");
  const cfg = await readArkiveConfig();
  cfg.practices[name] = {
    enabled: true,
    mode: args.mode ?? args.config.loading.default_mode,
    version: args.config.version,
  };
  await writeArkiveConfig(cfg);

  return { name, path: root };
}

export async function createUserPractice(args: {
  name: string;
  description?: string;
  triggers?: string[];
}): Promise<{ name: string; path: string }> {
  const slug = slugifyPractice(args.name);
  if (!slug) throw new Error("Practice name must contain at least one letter or digit.");
  if (isReservedPractice(slug)) {
    throw new Error(`'${slug}' is reserved for a built-in practice.`);
  }
  const existing = await getPracticeConfig(slug);
  if (existing) throw new Error(`Practice '${slug}' already exists.`);

  // Bare container. NO seeded entity types — declaration-first thinking is
  // the thing we're killing. The practice has empty journal_entity_types and
  // empty context_files until intake (Phase 5) or emergence (Phase 5) fills
  // them in. Until then, anything the user says about this domain captures
  // to the universal stream via capture_observation.
  const cfg: PracticeConfigFile = {
    name: slug,
    version: "0.1.0",
    based_on: ARKIVE_CORE_VERSION,
    description: args.description ?? `User-created practice: ${slug}.`,
    provides: {
      journal_entity_types: [],
      context_files: [],
      skill_format: {
        description: `Behavioral playbooks for ${slug}.`,
        required_sections: ["when_this_applies", "how_to_act"],
        versioning: "semver_per_skill",
        envelope_required: false,
      },
    },
    loading: { default_mode: "on_demand", triggers: args.triggers },
    insight_flow: { default_output: "ask_user", evidence_threshold: 3, rejection_cooldown_threshold: 10 },
  };

  return await installPractice({ config: cfg });
}

// ============================================================================
// Additive patches to an existing practice.config
// ============================================================================

/**
 * Patch shape for {@link updatePracticeConfig}. Every field is an additive
 * declaration that gets merged into the existing config. Use this AFTER
 * `create_practice` to shape the practice's entity types, context files,
 * link types, and so on without hand-editing the YAML.
 *
 * Idempotent on `name` — if an entity_type/context_file/link_type/mcp_tool/
 * constraint with the same `name` is already present, the patch REPLACES it
 * in place (so you can correct a typo by re-sending the same name with the
 * fixed body). Loading triggers and insight_flow are last-write-wins.
 */
export type PracticeConfigPatch = {
  /** Replace the description string. */
  set_description?: string;
  /** Replace `loading.default_mode`. */
  set_loading_default_mode?: "active" | "on_demand" | "private";
  /** Replace `loading.triggers` wholesale. */
  set_loading_triggers?: string[];
  /** Patch any subset of insight_flow defaults. */
  set_insight_flow?: Partial<InsightFlowDeclaration>;

  /** Append-only journal entity types. Schema.required must be non-empty. */
  add_entity_types?: JournalEntityTypeDeclaration[];
  /** Context files (state-of-the-world). */
  add_context_files?: ContextFileDeclaration[];
  /** Practice-specific link types (cannot collide with universals). */
  add_link_types?: LinkTypeDeclaration[];
  /** Practice-specific MCP tool declarations. */
  add_mcp_tools?: McpToolDeclaration[];
  /** Practice constraints (human-readable rules the runtime enforces). */
  add_constraints?: ConstraintDeclaration[];

  /** Remove a previously-declared name. Use sparingly — removing an
   *  entity_type does NOT delete the on-disk entries. */
  remove_entity_type?: string;
  remove_context_file?: string;
  remove_link_type?: string;
  remove_mcp_tool?: string;
  remove_constraint?: string;

  /** Replace the skill_format declaration wholesale. */
  set_skill_format?: PracticeConfigFile["provides"]["skill_format"];

  /** Bump the practice's semver. The runtime does NOT do this for you —
   *  pass an explicit value when you're making a meaningful change. */
  bump_version?: string;
};

export async function updatePracticeConfig(
  name: string,
  patch: PracticeConfigPatch
): Promise<{ name: string; version: string; path: string }> {
  if (!name) throw new Error("practice name is required");
  if (isReservedPractice(name)) {
    throw new Error(
      `'${name}' is a built-in practice and cannot be modified via update_practice_config.`
    );
  }
  const cfg = await getPracticeConfig(name);
  if (!cfg) throw new Error(`Practice '${name}' is not installed.`);

  // Apply scalar patches
  if (patch.set_description !== undefined) cfg.description = patch.set_description;
  if (patch.set_loading_default_mode) cfg.loading.default_mode = patch.set_loading_default_mode;
  if (patch.set_loading_triggers) cfg.loading.triggers = patch.set_loading_triggers;
  if (patch.set_insight_flow) cfg.insight_flow = { ...cfg.insight_flow, ...patch.set_insight_flow };
  if (patch.set_skill_format) cfg.provides.skill_format = patch.set_skill_format;
  if (patch.bump_version) cfg.version = patch.bump_version;

  // Upsert helpers — replace-in-place by name, else append.
  const upsertByName = <T extends { name: string }>(arr: T[], item: T): T[] => {
    const idx = arr.findIndex((x) => x.name === item.name);
    if (idx >= 0) {
      const copy = arr.slice();
      copy[idx] = item;
      return copy;
    }
    return [...arr, item];
  };

  if (patch.add_entity_types) {
    for (const et of patch.add_entity_types) {
      cfg.provides.journal_entity_types = upsertByName(cfg.provides.journal_entity_types, et);
    }
  }
  if (patch.add_context_files) {
    for (const cf of patch.add_context_files) {
      cfg.provides.context_files = upsertByName(cfg.provides.context_files, cf);
    }
  }
  if (patch.add_link_types) {
    cfg.provides.link_types ??= [];
    for (const lt of patch.add_link_types) {
      cfg.provides.link_types = upsertByName(cfg.provides.link_types, lt);
    }
  }
  if (patch.add_mcp_tools) {
    cfg.provides.mcp_tools ??= [];
    for (const t of patch.add_mcp_tools) {
      cfg.provides.mcp_tools = upsertByName(cfg.provides.mcp_tools, t);
    }
  }
  if (patch.add_constraints) {
    cfg.provides.constraints ??= [];
    for (const c of patch.add_constraints) {
      cfg.provides.constraints = upsertByName(cfg.provides.constraints, c);
    }
  }

  // Removals
  if (patch.remove_entity_type) {
    cfg.provides.journal_entity_types = cfg.provides.journal_entity_types.filter(
      (e) => e.name !== patch.remove_entity_type
    );
  }
  if (patch.remove_context_file) {
    cfg.provides.context_files = cfg.provides.context_files.filter(
      (c) => c.name !== patch.remove_context_file
    );
  }
  if (patch.remove_link_type && cfg.provides.link_types) {
    cfg.provides.link_types = cfg.provides.link_types.filter(
      (l) => l.name !== patch.remove_link_type
    );
  }
  if (patch.remove_mcp_tool && cfg.provides.mcp_tools) {
    cfg.provides.mcp_tools = cfg.provides.mcp_tools.filter(
      (t) => t.name !== patch.remove_mcp_tool
    );
  }
  if (patch.remove_constraint && cfg.provides.constraints) {
    cfg.provides.constraints = cfg.provides.constraints.filter(
      (c) => c.name !== patch.remove_constraint
    );
  }

  const validation = validatePracticeConfig(cfg);
  if (!validation.valid) {
    throw new Error(`Patched practice.config is invalid: ${validation.errors.join("; ")}`);
  }

  const uid = await currentUserId();
  await storage().writeEntry(uid, {
    path: practiceConfigPath(name),
    body: serializePracticeConfig(cfg),
    meta: {},
  });

  // Keep arkive.config in sync if the version was bumped
  if (patch.bump_version) {
    const { readArkiveConfig, writeArkiveConfig } = await import("./arkive-config");
    const arkiveCfg = await readArkiveConfig();
    if (arkiveCfg.practices[name]) {
      arkiveCfg.practices[name].version = cfg.version;
      await writeArkiveConfig(arkiveCfg);
    }
  }

  return { name, version: cfg.version, path: practiceConfigPath(name) };
}

// ============================================================================
// §16 validation
// ============================================================================

export function validatePracticeConfig(cfg: PracticeConfigFile): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!cfg.name) errors.push("name is required");
  if (!cfg.version) errors.push("version is required");
  if (!cfg.based_on) errors.push("based_on is required");
  if (!cfg.provides) errors.push("provides is required");
  if (cfg.name && (UNIVERSAL_ENTITY_TYPES as readonly string[]).includes(cfg.name)) {
    errors.push(`practice name '${cfg.name}' conflicts with a universal entity type`);
  }
  for (const et of cfg.provides?.journal_entity_types ?? []) {
    if ((UNIVERSAL_ENTITY_TYPES as readonly string[]).includes(et.name)) {
      errors.push(`entity_type '${et.name}' conflicts with a universal entity type`);
    }
    if (et.append_only === false && !et.allowed_mutations) {
      errors.push(`entity_type '${et.name}': append_only=false requires allowed_mutations`);
    }
    for (const t of et.allowed_mutations?.status_field ?? []) {
      if (!/^[a-z0-9_]+_to_[a-z0-9_]+$/i.test(t)) {
        errors.push(`entity_type '${et.name}' status transition '${t}' not in <from>_to_<to> form`);
      }
    }
  }
  for (const lt of cfg.provides?.link_types ?? []) {
    if ((UNIVERSAL_LINK_TYPES as readonly string[]).includes(lt.name)) {
      errors.push(`link_type '${lt.name}' conflicts with a universal link type`);
    }
  }
  for (const t of cfg.provides?.mcp_tools ?? []) {
    if (!["none", "one_tap", "hard_confirm"].includes(t.requires_gate)) {
      errors.push(`mcp_tool '${t.name}' has invalid requires_gate '${t.requires_gate}'`);
    }
  }
  if (cfg.loading && !["active", "on_demand", "private"].includes(cfg.loading.default_mode)) {
    errors.push(`loading.default_mode '${cfg.loading.default_mode}' must be active|on_demand|private`);
  }
  if (cfg.insight_flow && !["skill", "context", "both", "ask_user"].includes(cfg.insight_flow.default_output)) {
    errors.push(`insight_flow.default_output '${cfg.insight_flow.default_output}' invalid`);
  }
  return { valid: errors.length === 0, errors };
}

// ============================================================================
// practice.config YAML codec
// ============================================================================

export function serializePracticeConfig(cfg: PracticeConfigFile): string {
  const out: string[] = [];
  out.push(`name: ${cfg.name}`);
  out.push(`version: ${cfg.version}`);
  out.push(`based_on: ${cfg.based_on}`);
  out.push(`description: ${quoteIfNeeded(cfg.description)}`);
  if (cfg.author) out.push(`author: ${quoteIfNeeded(cfg.author)}`);
  if (cfg.license) out.push(`license: ${cfg.license}`);
  out.push("");
  out.push("provides:");
  out.push("  journal_entity_types:");
  for (const et of cfg.provides.journal_entity_types) {
    out.push(`    - name: ${et.name}`);
    out.push(`      folder: ${et.folder}`);
    out.push(`      schema:`);
    out.push(`        required: [${et.schema.required.join(", ")}]`);
    if (et.schema.optional?.length) out.push(`        optional: [${et.schema.optional.join(", ")}]`);
    out.push(`      append_only: ${et.append_only}`);
    if (et.allowed_mutations) {
      out.push("      allowed_mutations:");
      if (et.allowed_mutations.status_field) {
        out.push("        status_field:");
        for (const s of et.allowed_mutations.status_field) out.push(`          - ${s}`);
      }
      if (et.allowed_mutations.body_appends) {
        out.push("        body_appends:");
        for (const s of et.allowed_mutations.body_appends) out.push(`          - ${s}`);
      }
    }
  }
  out.push("");
  out.push("  context_files:");
  for (const cf of cfg.provides.context_files) {
    out.push(`    - name: ${cf.name}`);
    out.push(`      purpose: ${quoteIfNeeded(cf.purpose)}`);
    out.push(`      schema: ${cf.schema}`);
    if (cf.structured_fields?.length) {
      out.push("      structured_fields:");
      for (const f of cf.structured_fields) {
        for (const [k, v] of Object.entries(f)) out.push(`        - ${k}: ${v}`);
      }
    }
    out.push(`      update_triggers: [${cf.update_triggers.join(", ")}]`);
    if (cf.update_mode) out.push(`      update_mode: ${cf.update_mode}`);
  }
  out.push("");
  out.push("  skill_format:");
  out.push(`    description: ${quoteIfNeeded(cfg.provides.skill_format.description)}`);
  out.push(`    required_sections: [${cfg.provides.skill_format.required_sections.join(", ")}]`);
  if (cfg.provides.skill_format.optional_sections) {
    out.push(`    optional_sections: [${cfg.provides.skill_format.optional_sections.join(", ")}]`);
  }
  out.push(`    versioning: ${cfg.provides.skill_format.versioning}`);
  out.push(`    envelope_required: ${cfg.provides.skill_format.envelope_required}`);
  if (cfg.provides.link_types?.length) {
    out.push("");
    out.push("  link_types:");
    for (const lt of cfg.provides.link_types) {
      out.push(`    - name: ${lt.name}`);
      out.push(`      description: ${quoteIfNeeded(lt.description)}`);
    }
  }
  if (cfg.provides.mcp_tools?.length) {
    out.push("");
    out.push("  mcp_tools:");
    for (const t of cfg.provides.mcp_tools) {
      out.push(`    - name: ${t.name}`);
      out.push(`      description: ${quoteIfNeeded(t.description)}`);
      out.push(`      requires_gate: ${t.requires_gate}`);
    }
  }
  if (cfg.provides.constraints?.length) {
    out.push("");
    out.push("  constraints:");
    for (const c of cfg.provides.constraints) {
      out.push(`    - name: ${c.name}`);
      out.push(`      description: ${quoteIfNeeded(c.description)}`);
    }
  }
  out.push("");
  out.push("loading:");
  out.push(`  default_mode: ${cfg.loading.default_mode}`);
  if (cfg.loading.triggers?.length) {
    out.push("  triggers:");
    for (const t of cfg.loading.triggers) out.push(`    - ${t}`);
  }
  out.push("");
  out.push("insight_flow:");
  out.push(`  default_output: ${cfg.insight_flow.default_output}`);
  out.push(`  evidence_threshold: ${cfg.insight_flow.evidence_threshold}`);
  if (cfg.insight_flow.evidence_types) {
    out.push(`  evidence_types: [${cfg.insight_flow.evidence_types.join(", ")}]`);
  }
  out.push(`  rejection_cooldown_threshold: ${cfg.insight_flow.rejection_cooldown_threshold}`);
  if (cfg.starter_pack) {
    out.push("");
    out.push("starter_pack:");
    out.push(`  seed_skills: [${(cfg.starter_pack.seed_skills ?? []).join(", ")}]`);
    out.push(`  seed_context: [${(cfg.starter_pack.seed_context ?? []).join(", ")}]`);
    if (cfg.starter_pack.initial_intentions?.length) {
      out.push("  initial_intentions:");
      for (const i of cfg.starter_pack.initial_intentions) out.push(`    - ${quoteIfNeeded(i)}`);
    }
  }
  out.push("");
  return out.join("\n");
}

export function parsePracticeConfig(text: string): PracticeConfigFile {
  const cfg: PracticeConfigFile = {
    name: "",
    version: "",
    based_on: "",
    description: "",
    provides: {
      journal_entity_types: [],
      context_files: [],
      skill_format: {
        description: "",
        required_sections: [],
        versioning: "semver_per_skill",
        envelope_required: false,
      },
    },
    loading: { default_mode: "on_demand" },
    insight_flow: { default_output: "ask_user", evidence_threshold: 3, rejection_cooldown_threshold: 10 },
  };

  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const indent = line.length - line.trimStart().length;
    if (indent !== 0) { i++; continue; }
    const m = line.trim().match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const [, k, v] = m;
    if (k === "provides") { i = parseProvides(lines, i + 1, cfg); continue; }
    if (k === "loading") { i = parseLoading(lines, i + 1, cfg); continue; }
    if (k === "insight_flow") { i = parseInsightFlow(lines, i + 1, cfg); continue; }
    if (k === "starter_pack") { i = parseStarterPack(lines, i + 1, cfg); continue; }
    setRootScalar(cfg, k, v);
    i++;
  }
  return cfg;
}

function setRootScalar(cfg: PracticeConfigFile, key: string, value: string) {
  const v = value.trim();
  switch (key) {
    case "name": cfg.name = v; break;
    case "version": cfg.version = v; break;
    case "based_on": cfg.based_on = v; break;
    case "description": cfg.description = unquote(v); break;
    case "author": cfg.author = unquote(v); break;
    case "license": cfg.license = v; break;
  }
}

function parseProvides(lines: string[], start: number, cfg: PracticeConfigFile): number {
  let i = start;
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");
    const indent = line.length - line.trimStart().length;
    if (indent === 0 && line.trim()) return i;
    if (!line.trim()) { i++; continue; }
    const content = line.trim();
    if (indent === 2) {
      if (content.startsWith("journal_entity_types:")) { i = parseJournalEntityTypes(lines, i + 1, cfg); continue; }
      if (content.startsWith("context_files:")) { i = parseContextFiles(lines, i + 1, cfg); continue; }
      if (content.startsWith("skill_format:")) { i = parseSkillFormat(lines, i + 1, cfg); continue; }
      if (content.startsWith("link_types:")) { i = parseLinkTypes(lines, i + 1, cfg); continue; }
      if (content.startsWith("mcp_tools:")) { i = parseMcpTools(lines, i + 1, cfg); continue; }
      if (content.startsWith("constraints:")) { i = parseConstraints(lines, i + 1, cfg); continue; }
    }
    i++;
  }
  return i;
}

function parseJournalEntityTypes(lines: string[], start: number, cfg: PracticeConfigFile): number {
  let i = start;
  let current: JournalEntityTypeDeclaration | null = null;
  const flush = () => { if (current) { cfg.provides.journal_entity_types.push(current); current = null; } };
  let inAllowedMutations: "status_field" | "body_appends" | null = null;
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");
    if (!line.trim()) { i++; continue; }
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (indent <= 2) { flush(); return i; }
    if (content.startsWith("- name:")) {
      flush();
      current = {
        name: content.slice(7).trim(),
        folder: "",
        schema: { required: [] },
        append_only: true,
      };
      inAllowedMutations = null;
    } else if (current) {
      const itemMatch = content.match(/^-\s+(.+)$/);
      if (itemMatch && inAllowedMutations) {
        const val = itemMatch[1].trim();
        current.allowed_mutations ??= {};
        if (inAllowedMutations === "status_field") {
          current.allowed_mutations.status_field ??= [];
          current.allowed_mutations.status_field.push(val);
        } else {
          current.allowed_mutations.body_appends ??= [];
          current.allowed_mutations.body_appends.push(val);
        }
      } else {
        const m = content.match(/^([A-Za-z_]+):\s*(.*)$/);
        if (m) {
          const [, k, v] = m;
          if (k === "folder") current.folder = v.trim();
          else if (k === "append_only") current.append_only = v.trim() === "true";
          else if (k === "required") current.schema.required = parseListInline(v);
          else if (k === "optional") current.schema.optional = parseListInline(v);
          else if (k === "allowed_mutations") { current.allowed_mutations = {}; inAllowedMutations = null; }
          else if (k === "status_field") inAllowedMutations = "status_field";
          else if (k === "body_appends") inAllowedMutations = "body_appends";
        }
      }
    }
    i++;
  }
  flush();
  return i;
}

function parseContextFiles(lines: string[], start: number, cfg: PracticeConfigFile): number {
  let i = start;
  let current: ContextFileDeclaration | null = null;
  let inStructuredFields = false;
  const flush = () => { if (current) { cfg.provides.context_files.push(current); current = null; } };
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");
    if (!line.trim()) { i++; continue; }
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (indent <= 2) { flush(); return i; }
    if (content.startsWith("- name:")) {
      flush();
      current = { name: content.slice(7).trim(), purpose: "", schema: "free_form", update_triggers: [] };
      inStructuredFields = false;
    } else if (current) {
      const itemMatch = content.match(/^-\s+([A-Za-z_]+):\s*(.+)$/);
      if (itemMatch && inStructuredFields) {
        current.structured_fields ??= [];
        current.structured_fields.push({ [itemMatch[1]]: itemMatch[2].trim() });
      } else {
        const m = content.match(/^([A-Za-z_]+):\s*(.*)$/);
        if (m) {
          const [, k, v] = m;
          if (k === "purpose") current.purpose = unquote(v);
          else if (k === "schema") current.schema = v.trim() as ContextFileDeclaration["schema"];
          else if (k === "update_triggers") current.update_triggers = parseListInline(v);
          else if (k === "update_mode") current.update_mode = v.trim() as ContextFileDeclaration["update_mode"];
          else if (k === "structured_fields") inStructuredFields = true;
        }
      }
    }
    i++;
  }
  flush();
  return i;
}

function parseSkillFormat(lines: string[], start: number, cfg: PracticeConfigFile): number {
  let i = start;
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");
    if (!line.trim()) { i++; continue; }
    const indent = line.length - line.trimStart().length;
    if (indent <= 2) return i;
    const m = line.trim().match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const [, k, v] = m;
    if (k === "description") cfg.provides.skill_format.description = unquote(v);
    else if (k === "required_sections") cfg.provides.skill_format.required_sections = parseListInline(v);
    else if (k === "optional_sections") cfg.provides.skill_format.optional_sections = parseListInline(v);
    else if (k === "versioning") cfg.provides.skill_format.versioning = v.trim() as never;
    else if (k === "envelope_required") cfg.provides.skill_format.envelope_required = v.trim() === "true";
    i++;
  }
  return i;
}

function parseLinkTypes(lines: string[], start: number, cfg: PracticeConfigFile): number {
  return parseSimpleList(lines, start, (entry) => {
    cfg.provides.link_types ??= [];
    cfg.provides.link_types.push({ name: entry.name ?? "", description: unquote(entry.description ?? "") });
  });
}

function parseMcpTools(lines: string[], start: number, cfg: PracticeConfigFile): number {
  return parseSimpleList(lines, start, (entry) => {
    cfg.provides.mcp_tools ??= [];
    cfg.provides.mcp_tools.push({
      name: entry.name ?? "",
      description: unquote(entry.description ?? ""),
      requires_gate: (entry.requires_gate as "none" | "one_tap" | "hard_confirm") ?? "none",
    });
  });
}

function parseConstraints(lines: string[], start: number, cfg: PracticeConfigFile): number {
  return parseSimpleList(lines, start, (entry) => {
    cfg.provides.constraints ??= [];
    cfg.provides.constraints.push({ name: entry.name ?? "", description: unquote(entry.description ?? "") });
  });
}

function parseLoading(lines: string[], start: number, cfg: PracticeConfigFile): number {
  let i = start;
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");
    if (!line.trim()) { i++; continue; }
    const indent = line.length - line.trimStart().length;
    if (indent === 0 && line.trim()) return i;
    const content = line.trim();
    const m = content.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (k === "default_mode") cfg.loading.default_mode = v.trim() as never;
      else if (k === "triggers") cfg.loading.triggers = [];
    }
    const item = content.match(/^-\s+(.+)$/);
    if (item && cfg.loading.triggers) cfg.loading.triggers.push(item[1].trim());
    i++;
  }
  return i;
}

function parseInsightFlow(lines: string[], start: number, cfg: PracticeConfigFile): number {
  let i = start;
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");
    if (!line.trim()) { i++; continue; }
    const indent = line.length - line.trimStart().length;
    if (indent === 0 && line.trim()) return i;
    const m = line.trim().match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const [, k, v] = m;
    if (k === "default_output") cfg.insight_flow.default_output = v.trim() as never;
    else if (k === "evidence_threshold") cfg.insight_flow.evidence_threshold = Number(v) || 0;
    else if (k === "evidence_types") cfg.insight_flow.evidence_types = parseListInline(v);
    else if (k === "rejection_cooldown_threshold") cfg.insight_flow.rejection_cooldown_threshold = Number(v) || 0;
    i++;
  }
  return i;
}

function parseStarterPack(lines: string[], start: number, cfg: PracticeConfigFile): number {
  let i = start;
  cfg.starter_pack = {};
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");
    if (!line.trim()) { i++; continue; }
    const indent = line.length - line.trimStart().length;
    if (indent === 0 && line.trim()) return i;
    const content = line.trim();
    const m = content.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m && cfg.starter_pack) {
      const [, k, v] = m;
      if (k === "seed_skills") cfg.starter_pack.seed_skills = parseListInline(v);
      else if (k === "seed_context") cfg.starter_pack.seed_context = parseListInline(v);
      else if (k === "initial_intentions") cfg.starter_pack.initial_intentions = [];
    }
    const item = content.match(/^-\s+(.+)$/);
    if (item && cfg.starter_pack?.initial_intentions) cfg.starter_pack.initial_intentions.push(unquote(item[1].trim()));
    i++;
  }
  return i;
}

function parseListInline(s: string): string[] {
  const m = s.match(/^\[(.*)\]$/);
  if (!m) return [];
  return m[1].split(",").map((x) => x.trim()).filter(Boolean);
}

function parseSimpleList(
  lines: string[],
  start: number,
  push: (entry: Record<string, string>) => void
): number {
  let i = start;
  let current: Record<string, string> | null = null;
  const flush = () => { if (current) { push(current); current = null; } };
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, "");
    if (!line.trim()) { i++; continue; }
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (indent <= 2) { flush(); return i; }
    if (content.startsWith("- name:")) {
      flush();
      current = { name: content.slice(7).trim() };
    } else if (current) {
      const m = content.match(/^([A-Za-z_]+):\s*(.+)$/);
      if (m) current[m[1]] = m[2].trim();
    }
    i++;
  }
  flush();
  return i;
}

function quoteIfNeeded(s: string): string {
  if (/[:#\n]/.test(s) || s.startsWith(" ") || s.endsWith(" ")) return JSON.stringify(s);
  return s;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  return t;
}

// ---- Re-exports + back-compat shims ----
export {
  practiceJournalDir,
  practiceSkillsDir,
  practiceContextDir,
  practiceInsightStatusDir,
};

/** @deprecated v5: kept while UI consumers still call by old name. */
export const listLibraries = listPractices;
/** @deprecated v5: use createUserPractice. */
export const createLibrary = createUserPractice;
