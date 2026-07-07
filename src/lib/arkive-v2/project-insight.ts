// Projection on accept — the compounding loop's final step (§4 / §9).
//
// When a pending insight is ACCEPTED, the runtime turns it into durable
// structure per its proposed_output — a versioned skill in skills/ and/or a
// learned truth written into a context file — carrying provenance back to the
// insight and its evidence. This is the single shared projection used by the
// one accept path (decide_insight), so BOTH loops' insights (the in-chat
// propose_insight tool and the autonomous daydream loop) graduate identically.
//
// What it does NOT do (explicitly deferred): let the user override placement,
// ask the user questions, or restructure existing context (merge/split/move).
// Writes go through the schema-enforcing writeEntity — never freehand.

import { readEntity, writeEntity } from "./write-entity";
import { getPracticeConfig } from "./practices";
import { slugify } from "./paths";
import { storage, currentUserId } from "@/lib/storage";
import type { ContextFileDeclaration, PracticeConfigFile } from "./schemas";

export type ProjectionResult = {
  skill?: { path: string; version: number; archived?: string };
  context?: { path: string; file: string; mode: "replace" | "accumulate" };
  note?: string;
};

export type ProjectInsightArgs = {
  practice: string;
  /** Path to the (already-accepted) insight — used for provenance + title. */
  insightPath: string;
  /** The insight body (the pattern/summary) — becomes the written content. */
  summary: string;
  proposedOutput: "skill" | "context" | "both" | "ask_user";
  /** Declared context file the conclusion should land in (e.g. "rules.md"). */
  targetContextFile?: string;
  evidence: string[];
};

// Matches the seed placeholder lines ("_No rules captured yet._") so accumulate
// drops the stub rather than stacking real content beneath it.
const PLACEHOLDER_RE = /^_[^\n]*\._\s*$/gm;

function titleFromInsightPath(p: string): string {
  const base = (p.split("/").pop() ?? p).replace(/\.md$/, "");
  const noDate = base.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return noDate.replace(/-/g, " ").trim() || "insight";
}

function humanize(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function provenanceFooter(insightPath: string, evidence: string[]): string {
  const lines = [`_Source: accepted insight \`${insightPath}\`_`];
  if (evidence.length) lines.push(`_Evidence: ${evidence.map((e) => `\`${e}\``).join(", ")}_`);
  return lines.join("\n");
}

function buildSkillBody(
  title: string,
  summary: string,
  requiredSections: string[],
  insightPath: string,
  evidence: string[]
): string {
  const sections = requiredSections.length ? requiredSections : ["when_this_applies", "how_to_act"];
  const out: string[] = [`# ${humanize(title)}`, "", summary, ""];
  for (const s of sections) {
    out.push(`## ${humanize(s)}`, "");
    out.push(/how|act|\bdo\b|apply|response|protocol/i.test(s) ? summary : "_To be refined as this skill is used._", "");
  }
  out.push(provenanceFooter(insightPath, evidence), "");
  return out.join("\n");
}

async function projectSkill(
  args: ProjectInsightArgs,
  title: string,
  cfg: PracticeConfigFile | null
): Promise<ProjectionResult["skill"]> {
  const name = slugify(title);
  const subpath = `skills/${name}.md`;
  const existing = await readEntity({ practice: args.practice, subpath });

  let version = 1;
  let archived: string | undefined;
  if (existing) {
    // §3 versioning: archive the old version, then write the new one.
    const oldVersion = typeof existing.meta.version === "number" ? existing.meta.version : 1;
    version = oldVersion + 1;
    const archiveSub = `skills/_archive/${name}-v${oldVersion}.md`;
    const ar = await writeEntity({
      practice: args.practice,
      entity_type: "skill",
      subpath: archiveSub,
      body: existing.body,
      meta: { ...existing.meta, version: oldVersion, status: "retired", archived_from: subpath },
    });
    archived = ar.path;
    // The new active skill must be written at the SAME path; skills are not
    // Class-2, so an in-place overwrite is refused. Delete the old active file
    // first (it's preserved in _archive).
    const uid = await currentUserId();
    await storage().deleteEntry(uid, existing.path);
  }

  const body = buildSkillBody(
    title,
    args.summary,
    cfg?.provides.skill_format.required_sections ?? [],
    args.insightPath,
    args.evidence
  );
  const wr = await writeEntity({
    practice: args.practice,
    entity_type: "skill",
    subpath,
    body,
    meta: {
      name,
      version,
      status: "active",
      last_updated: new Date().toISOString(),
      created_from: archived ? [archived] : [],
      triggered_by: [args.insightPath],
    },
  });
  return { path: wr.path, version, archived };
}

function resolveContextTarget(
  cfg: PracticeConfigFile | null,
  target?: string
): ContextFileDeclaration | undefined {
  const files = cfg?.provides.context_files ?? [];
  if (files.length === 0) return undefined;
  if (target) {
    const want = target.endsWith(".md") ? target : `${target}.md`;
    const hit = files.find((f) => f.name === want || f.name === target);
    if (hit) return hit;
  }
  // Prefer an accumulate (TRUTH) file — the natural home for a conclusion.
  return files.find((f) => (f.update_mode ?? "replace") === "accumulate") ?? files[0];
}

async function projectContext(
  args: ProjectInsightArgs,
  title: string,
  cfg: PracticeConfigFile | null
): Promise<{ context?: ProjectionResult["context"]; note?: string }> {
  const decl = resolveContextTarget(cfg, args.targetContextFile);
  if (!decl) {
    return {
      note:
        "no context file declared for this practice — the accepted insight has no home yet " +
        "(Part B: new practices need declared context_files). Insight kept in insights/accepted/.",
    };
  }
  const fileStem = decl.name.replace(/\.md$/, "");
  const subpath = `context/${decl.name}`;
  // Fail SAFE: a file that forgot to declare update_mode (bug / hand-edit /
  // migration) defaults to "accumulate" (append) rather than "replace"
  // (overwrite) — so a missing mode can never silently WIPE accumulated truths.
  // STATE files declare "replace" explicitly, so they're unaffected.
  const mode: "replace" | "accumulate" = decl.update_mode ?? "accumulate";
  const existing = await readEntity({ practice: args.practice, subpath });

  const section = `## ${humanize(title)}\n\n${args.summary}\n\n${provenanceFooter(args.insightPath, args.evidence)}\n`;

  let body: string;
  if (mode === "accumulate") {
    // TRUTH/PATTERN context grows: append a new entry, preserving prior truths.
    const cur = (existing?.body ?? "").replace(PLACEHOLDER_RE, "").trim();
    body = cur ? `${cur}\n\n${section}` : section;
  } else {
    // STATE context: the insight IS the new state — overwrite (Class-2 replace).
    body = section;
  }

  const wr = await writeEntity({
    practice: args.practice,
    entity_type: fileStem,
    subpath,
    body,
    meta: { created_from: [args.insightPath], ...(args.evidence.length ? { evidence: args.evidence } : {}) },
  });
  return { context: { path: wr.path, file: decl.name, mode } };
}

/**
 * Project an accepted insight into durable structure. Never throws on a
 * projection miss — returns a note so the caller can surface it; the
 * pending→accepted move has already happened regardless.
 */
export async function projectAcceptedInsight(args: ProjectInsightArgs): Promise<ProjectionResult> {
  const cfg = await getPracticeConfig(args.practice);
  const title = titleFromInsightPath(args.insightPath);
  const result: ProjectionResult = {};

  const wantSkill = args.proposedOutput === "skill" || args.proposedOutput === "both";
  // ask_user has no interactive path yet (deferred) → default to writing as
  // context, the conservative, non-destructive home. Remove this when the
  // interactive accept UX lands.
  const wantContext =
    args.proposedOutput === "context" ||
    args.proposedOutput === "both" ||
    args.proposedOutput === "ask_user";

  if (wantSkill) result.skill = await projectSkill(args, title, cfg);
  if (wantContext) {
    const { context, note } = await projectContext(args, title, cfg);
    if (context) result.context = context;
    if (note) result.note = note;
  }
  return result;
}
