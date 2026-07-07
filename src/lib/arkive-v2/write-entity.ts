// Universal write tools — §16 entity validation + §13 atomic index update.
//
// These are the ONLY entity writers callers should reach for. Every write
// validates universal frontmatter, enforces append-only semantics per the
// practice's declarations, and triggers an arkive.index update.
//
// Trading-specific writers wrap these — they enrich the frontmatter with
// trading-required fields, then call writeEntity.

import { storage, currentUserId, type StoredEntry } from "@/lib/storage";
import {
  PATH_CONFIG,
  PATH_INDEX,
  PATH_PROTOCOL,
  PRACTICES_DIR,
  STREAM_DIR,
  V2_ROOT,
  practiceContextDir,
  practiceInsightStatusDir,
  practiceJournalDir,
  practiceRoot,
  practiceSkillsDir,
  slugifyPractice,
} from "./paths";
import { parseFrontmatter, serializeEntry } from "./frontmatter";
import { updateIndexForEntry } from "./arkive-index";
import { getPracticeConfig } from "./practices";
import {
  UNIVERSAL_ENTITY_TYPES,
  type JournalEntityTypeDeclaration,
} from "./schemas";

export type WriteResult = { path: string; created: boolean };

/**
 * Resolve (practice, subpath) → full storage path. "core" is the universal
 * namespace and routes to the arkive root, NOT under practices/. This is
 * the bug that produced practices/core/identity.md instead of
 * arkive/identity.md.
 */
function resolveFullPath(practice: string, subpath: string): string {
  const cleaned = subpath.replace(/^\/+/, "");
  if (practice === "core") return `${V2_ROOT}/${cleaned}`;
  return `${practiceRoot(practice)}/${cleaned}`;
}

/**
 * Universal entity write — §16 validation, then commit, then atomic index update.
 *
 * Resolves the target practice + entity_type from the inputs and validates:
 *   - Universal required fields (entity_type, practice, created_at) present
 *   - Practice + entity type combination is declared
 *   - Practice-required fields present (per practice.config schema)
 *   - Append-only constraint honored (refuses overwrite of journal entries
 *     unless an allowed_mutation is declared and `mutation` is set)
 *   - Path safety: no '..', must end in .md (where applicable)
 */
export async function writeEntity(args: {
  practice: string;
  entity_type: string;
  /** Subpath relative to the practice root. */
  subpath: string;
  /** Frontmatter — universal + practice-required fields. created_at + entity_type
   *  + practice are auto-filled from args if missing. */
  meta?: Record<string, unknown>;
  /** Markdown body. */
  body: string;
  /** When set, allows overwrite of an existing entry per the declared mutation.
   *  E.g. `{ status_field: "open_to_closed" }` for a trade. */
  mutation?: { status_field?: string; body_append?: string };
}): Promise<WriteResult> {
  if (!args.practice) throw new Error("practice is required");
  if (!args.entity_type) throw new Error("entity_type is required");
  if (!args.subpath) throw new Error("subpath is required");
  if (args.subpath.includes("..")) throw new Error("subpath must not contain ..");
  if (args.subpath.startsWith("/")) throw new Error("subpath must be relative");

  // Stream observations don't go through write_entity. Capture is the only
  // path into the stream — gives us the never-fails guarantee and prevents
  // accidental structured-vs-raw confusion.
  if (args.practice === "core" && args.subpath.startsWith("stream/")) {
    throw new Error(
      "Stream observations are written via capture_observation, not write_entity. " +
        "write_entity is for structured (projection) entries."
    );
  }
  if (args.entity_type === "observation") {
    throw new Error(
      "entity_type 'observation' is reserved for the stream; use capture_observation."
    );
  }

  // "core" is the universal namespace — files at the arkive root, NOT a
  // practice. Guard the auto-managed roots so the AI can't accidentally
  // clobber them (protocol auto-refreshes; config is pure YAML; index is a
  // JSON graph rebuilt from frontmatter).
  const fullPath = resolveFullPath(args.practice, args.subpath);
  if (args.practice === "core") {
    if (fullPath === PATH_PROTOCOL) {
      throw new Error(
        "arkive.protocol.md is auto-managed — it refreshes on every read_arkive when " +
          "PROTOCOL_VERSION advances. Don't write to it directly."
      );
    }
    if (fullPath === PATH_CONFIG) {
      throw new Error(
        "arkive.config is pure YAML (no frontmatter) and is regenerated/edited via the " +
          "config helpers, not write_entity."
      );
    }
    if (fullPath === PATH_INDEX) {
      throw new Error(
        "arkive.index is an auto-built link graph. Use updateIndexForEntry to refresh."
      );
    }
  }
  const uid = await currentUserId();
  const adapter = storage();

  // Canonical practice identity — the slug the path uses. Stamping the raw
  // (possibly display-name) value into frontmatter would let the index tag one
  // practice under two spellings; normalize so meta.practice always matches the
  // directory the file actually lives in.
  const canonicalPractice = args.practice === "core" ? "core" : slugifyPractice(args.practice);

  // Build the canonical meta
  const now = new Date().toISOString();
  const meta: Record<string, unknown> = {
    entity_type: args.entity_type,
    practice: canonicalPractice,
    created_at: now,
    ...(args.meta ?? {}),
  };
  // Don't let caller override the three universals to something inconsistent
  meta.entity_type = args.entity_type;
  meta.practice = canonicalPractice;
  if (!meta.created_at) meta.created_at = now;

  // Validate against practice.config (if installed)
  const cfg = await getPracticeConfig(args.practice);

  // Refuse to write into a practice that isn't installed. Without this, a write
  // to an unknown/misspelled/display-name practice fell through validation
  // (cfg null) and was committed as a fresh file in an orphan directory — the
  // tool reported success while the user's actual practice stayed empty. Now it
  // fails loudly and actionably. ("core" is the universal root, not a practice.)
  if (args.practice !== "core" && !cfg) {
    throw new Error(
      `Practice '${args.practice}' is not installed (no practice.config found). ` +
        `Create it first with create_practice, or re-check the practice slug — ` +
        `it must match what create_practice returned (e.g. "trading-rules", not ` +
        `"Trading Rules"). To record something in the meantime, use ` +
        `capture_observation (it never fails).`
    );
  }

  // Class 2 — Mutable state. Replaced in place; no mutation required.
  // Today: declared context files + practice.instructions.md. The instructions
  // file uses entity_type "practice_instructions" (universal).
  const isClass2Write =
    args.entity_type === "practice_instructions" ||
    args.subpath === "practice.instructions.md" ||
    (cfg !== null && isDeclaredContextFile(cfg, args.entity_type));

  if (cfg) {
    const isUniversal = (UNIVERSAL_ENTITY_TYPES as readonly string[]).includes(args.entity_type);
    if (!isUniversal) {
      const entityDecl = cfg.provides.journal_entity_types.find(
        (e) => e.name === args.entity_type
      );
      if (!entityDecl && !knownContextOrSkillFile(cfg, args.entity_type)) {
        throw new Error(
          `entity_type '${args.entity_type}' not declared by practice '${args.practice}'. ` +
            `If the user just said something worth remembering and there's no fit yet, ` +
            `capture it to the stream via capture_observation instead — that never fails.`
        );
      }
      if (entityDecl) {
        const missing = entityDecl.schema.required.filter((f) => !(f in meta));
        if (missing.length > 0) {
          throw new Error(
            `entity_type '${args.entity_type}' missing required fields: ${missing.join(", ")}`
          );
        }
      }
    }
  }

  const existing = await adapter.readEntry(uid, fullPath);
  if (existing) {
    // Class 2 (context files + practice.instructions.md) — overwrite the
    // body with what the caller provided. Preserve created_at from the
    // existing meta so the file's age stays honest; everything else is
    // replaced. No mutation flag required.
    if (isClass2Write && !args.mutation) {
      const { meta: existingMeta } = parseFrontmatter(existing.body);
      const em = (existingMeta ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = {
        ...meta,
        created_at:
          (typeof em.created_at === "string" && em.created_at) || (meta.created_at as string),
        last_updated: new Date().toISOString(),
      };
      const text = serializeEntry(merged, args.body);
      await adapter.writeEntry(uid, { path: fullPath, body: text, meta: merged });
      await updateIndexForEntry(fullPath);
      return { path: fullPath, created: false };
    }

    // Class 1 (journal) — overwrite refused unless a Class 3 declared
    // exception is set.
    if (!args.mutation) {
      throw new Error(
        `Entry already exists at ${fullPath}. Class 1 (journal) entries are append-only. ` +
          `For Class 2 (context files, practice.instructions.md), call write_entity with the ` +
          `same entity_type to replace the body. For a Class 3 declared exception, pass mutation ` +
          `(e.g. mutation: { status_field: 'open_to_closed' }). Otherwise, write a new entry at a different path.`
      );
    }
    const result = await applyMutation(uid, adapter, existing, meta, args.body, args.mutation, cfg);
    await updateIndexForEntry(fullPath);
    return result;
  }

  // Fresh write — serialize + commit
  // For Class 2 writes, also stamp last_updated so the file behaves like state.
  if (isClass2Write) {
    meta.last_updated = new Date().toISOString();
  }
  const text = serializeEntry(meta, args.body);
  await adapter.writeEntry(uid, { path: fullPath, body: text, meta });
  await updateIndexForEntry(fullPath);
  return { path: fullPath, created: true };
}

/**
 * Append a markdown section to an existing entry. Only allowed when the
 * practice's allowed_mutations.body_appends includes the named section.
 * Creates the file if missing AND createIfMissing is set.
 */
export async function appendToEntity(args: {
  practice: string;
  entity_type: string;
  subpath: string;
  section_name: string;
  body: string;
  createIfMissing?: { meta: Record<string, unknown>; initialBody?: string };
}): Promise<WriteResult> {
  if (!args.section_name) throw new Error("section_name is required");
  const fullPath = resolveFullPath(args.practice, args.subpath);

  // Class 2 files (practice.instructions.md) are never append-targets,
  // regardless of practice config. Guard before the cfg lookup so the
  // refusal is consistent across both fresh and damaged states.
  if (
    args.entity_type === "practice_instructions" ||
    args.subpath === "practice.instructions.md"
  ) {
    throw new Error(
      `Cannot append to practice.instructions.md — it is Class 2 (state). ` +
        `Read the current body, splice in your change, then call write_entity to replace.`
    );
  }
  // Stream observations are immutable; appending isn't a meaningful op.
  if (args.entity_type === "observation" || args.subpath.startsWith("../stream/")) {
    throw new Error(
      `Cannot append to a stream observation — observations are immutable raw signal. ` +
        `Capture a new one or promote via projection.`
    );
  }

  const cfg = await getPracticeConfig(args.practice);
  // Same orphan-write guard as writeEntity: never append into an uninstalled
  // practice (it would create a stray file in a directory no practice owns).
  if (args.practice !== "core" && !cfg) {
    throw new Error(
      `Practice '${args.practice}' is not installed (no practice.config found). ` +
        `Create it first with create_practice, or re-check the practice slug. ` +
        `To record something now, use capture_observation (it never fails).`
    );
  }
  if (cfg) {
    // Context files are state, not history. Appending sections to them
    // creates the bug where placeholders pile up next to real content
    // (e.g. "_No rules captured yet._" followed by an "## Entry Sizing"
    // append). Refuse and tell the caller to use write_entity instead.
    if (isDeclaredContextFile(cfg, args.entity_type)) {
      throw new Error(
        `Cannot append to context file '${args.entity_type}' (Class 2). ` +
          `Read the current body via read_entity, compute the new full body ` +
          `(add/edit/remove sections), then call write_entity to replace.`
      );
    }
    const decl = cfg.provides.journal_entity_types.find((e) => e.name === args.entity_type);
    if (decl?.append_only === true && decl.allowed_mutations?.body_appends) {
      if (!decl.allowed_mutations.body_appends.includes(args.section_name)) {
        throw new Error(
          `Section '${args.section_name}' not in allowed_mutations.body_appends for ${args.entity_type}. ` +
            `append_to_entity on a journal entry only works for the entity type's declared body_appends (Class 3).`
        );
      }
    }
  }

  const uid = await currentUserId();
  const adapter = storage();
  const existing = await adapter.readEntry(uid, fullPath);
  const sectionHeader = `\n\n## ${humanize(args.section_name)}\n\n`;

  if (!existing) {
    if (!args.createIfMissing) {
      throw new Error(`No entry at ${fullPath} and createIfMissing not set.`);
    }
    const meta: Record<string, unknown> = {
      entity_type: args.entity_type,
      practice: args.practice === "core" ? "core" : slugifyPractice(args.practice),
      created_at: new Date().toISOString(),
      ...args.createIfMissing.meta,
    };
    const body =
      (args.createIfMissing.initialBody ?? "").trimEnd() + sectionHeader + args.body.trim() + "\n";
    const text = serializeEntry(meta, body);
    await adapter.writeEntry(uid, { path: fullPath, body: text, meta });
    await updateIndexForEntry(fullPath);
    return { path: fullPath, created: true };
  }

  const { meta, body } = parseFrontmatter(existing.body);
  const newBody = body.replace(/\s+$/, "") + sectionHeader + args.body.trim() + "\n";
  const text = serializeEntry(meta as Record<string, unknown>, newBody);
  await adapter.writeEntry(uid, {
    path: fullPath,
    body: text,
    meta: meta as Record<string, unknown>,
  });
  await updateIndexForEntry(fullPath);
  return { path: fullPath, created: false };
}

/** Read a single entry. Null if missing. Routes "core" to the arkive root. */
export async function readEntity(args: {
  practice: string;
  subpath: string;
}): Promise<{ path: string; meta: Record<string, unknown>; body: string } | null> {
  const fullPath = resolveFullPath(args.practice, args.subpath);
  const uid = await currentUserId();
  const entry = await storage().readEntry(uid, fullPath);
  if (!entry) return null;
  const { meta, body } = parseFrontmatter(entry.body);
  return { path: fullPath, meta: meta as Record<string, unknown>, body };
}

/** List entries under (practice, optional subpath). Meta-only — no body.
 *  Routes "core" to the arkive root. */
export async function listEntries(args: {
  practice: string;
  subpath?: string;
}): Promise<Array<{ path: string; meta: Record<string, unknown> }>> {
  const root = args.practice === "core" ? V2_ROOT : practiceRoot(args.practice);
  const prefix = args.subpath
    ? `${root}/${args.subpath.replace(/^\/+/, "").replace(/\/+$/, "")}/`
    : `${root}/`;
  const uid = await currentUserId();
  const entries = await storage().listEntries(uid, prefix);
  return entries.map((e) => {
    const { meta } = parseFrontmatter(e.body);
    return { path: e.path, meta: meta as Record<string, unknown> };
  });
}

// ---- Internals ----

function knownContextOrSkillFile(
  cfg: ReturnType<typeof getPracticeConfig> extends Promise<infer T> ? T : never,
  entity_type: string
): boolean {
  if (!cfg) return false;
  // Match against declared context file entity types (e.g. "watchlist", "rules")
  if (cfg.provides.context_files.some((c) => c.name.replace(/\.md$/, "") === entity_type)) return true;
  // Skills are universal
  if (entity_type === "skill") return true;
  // Insights are universal
  if (entity_type === "insight") return true;
  return false;
}

/** True when the entity_type names a declared context file (e.g. "rules"
 *  → matches context_files entry "rules.md"). Used to decide whether a
 *  write should overwrite (context = state) or refuse-without-mutation
 *  (journal = events). */
function isDeclaredContextFile(
  cfg: ReturnType<typeof getPracticeConfig> extends Promise<infer T> ? T : never,
  entity_type: string
): boolean {
  if (!cfg) return false;
  return cfg.provides.context_files.some(
    (c) => c.name.replace(/\.md$/, "") === entity_type
  );
}

async function applyMutation(
  uid: string,
  adapter: ReturnType<typeof storage>,
  existing: StoredEntry,
  newMeta: Record<string, unknown>,
  newBody: string,
  mutation: { status_field?: string; body_append?: string },
  cfg: Awaited<ReturnType<typeof getPracticeConfig>>
): Promise<WriteResult> {
  const { meta, body } = parseFrontmatter(existing.body);
  const existingMeta = meta as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...existingMeta };

  if (mutation.status_field) {
    // Validate the transition is declared
    if (cfg) {
      const decl = cfg.provides.journal_entity_types.find(
        (e) => e.name === existingMeta.entity_type
      );
      if (decl?.allowed_mutations?.status_field) {
        if (!decl.allowed_mutations.status_field.includes(mutation.status_field)) {
          throw new Error(
            `Status transition '${mutation.status_field}' not declared on ${existingMeta.entity_type}`
          );
        }
      }
    }
    const [, to] = mutation.status_field.split("_to_");
    merged.status = to;
  }

  // Allow caller to also patch additional fields via newMeta
  for (const [k, v] of Object.entries(newMeta)) {
    if (k === "entity_type" || k === "practice" || k === "created_at") continue;
    merged[k] = v;
  }
  merged.last_updated = new Date().toISOString();

  const finalBody = mutation.body_append
    ? body.replace(/\s+$/, "") + `\n\n## ${humanize(mutation.body_append)}\n\n${newBody.trim()}\n`
    : body;
  const text = serializeEntry(merged, finalBody);
  await adapter.writeEntry(uid, { path: existing.path, body: text, meta: merged });
  return { path: existing.path, created: false };
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
