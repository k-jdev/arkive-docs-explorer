// On-disk proof of the closed compounding loop. Drives the REAL MCP tools via
// an in-process client against a scratch .arkive.
//   PROOF 1 — accept writes durable structure (skill file + context entry).
//   PROOF 2 — full loop on a NOVEL domain: an Opus "setup agent" builds the
//             practice structure, then an insight is proposed + accepted and
//             lands in the structure it built.
//
//   set -a; . ./.env.local; set +a; STORAGE_BACKEND=filesystem node bundle.cjs

import * as fs from "node:fs";
import { buildArkiveMcp } from "@/lib/mcp-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { storage, currentUserId } from "@/lib/storage";
import { writeArkiveConfig } from "@/lib/arkive-v2/arkive-config";
import { ARKIVE_CORE_VERSION, DEFAULT_ARKIVE_DEFAULTS } from "@/lib/arkive-v2/schemas";
import { getModelClient } from "@/lib/model";

const ROOT = ".arkive/arkives";
function tree(filter: (p: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(`${dir}/${e.name}`, r);
      else if (filter(r)) out.push(r);
    }
  };
  walk(ROOT, "");
  return out;
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as { content?: Array<{ type: string; text?: string }> };
  const text = res.content?.find((c) => c.type === "text")?.text ?? "{}";
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
function readFile(p: string): string {
  try { return fs.readFileSync(`${ROOT}/${p}`, "utf8"); } catch { return "(missing)"; }
}
async function freshArkive() {
  const uid = await currentUserId();
  const a = storage();
  for (const e of await a.listEntries(uid, "")) await a.deleteEntry(uid, e.path);
  await a.writeEntry(uid, {
    path: "_internal/config/system/migration-marker-core-v1.md",
    body: `---\ntype: migration_marker\nversion: core-v1\nran_at: 2026-04-01T00:00:00.000Z\ntouched: 0\n---\nsuppressed\n`,
    meta: { type: "migration_marker", version: "core-v1", touched: 0 },
  });
  await writeArkiveConfig({
    version: ARKIVE_CORE_VERSION, identity_ref: "arkive/identity.md",
    protocol_ref: "arkive/arkive.protocol.md", practices: {}, defaults: { ...DEFAULT_ARKIVE_DEFAULTS },
  });
}

async function main() {
  await freshArkive();
  const server = buildArkiveMcp();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "projection-proof", version: "0.0.0" }, { capabilities: {} });
  await client.connect(ct);

  // ===================== PROOF 1 — accept writes structure =====================
  console.log("\n========== PROOF 1: accept writes durable structure ==========");
  await call(client, "create_practice", { name: "running", description: "Running log", triggers: ["run"] });
  await call(client, "update_practice_config", {
    name: "running",
    patch: {
      add_entity_types: [{ name: "run", folder: "runs", schema: { required: ["date", "distance_km"], optional: ["pace", "notes"] }, append_only: true }],
      add_context_files: [
        { name: "current_block.md", purpose: "Current training block", schema: "free_form", update_triggers: ["block_changed"], update_mode: "replace" },
        { name: "what_works.md", purpose: "Learned truths about this runner", schema: "free_form", update_triggers: ["insight_accepted"], update_mode: "accumulate" },
      ],
      set_insight_flow: { default_output: "context", evidence_threshold: 2, rejection_cooldown_threshold: 10 },
    },
  });
  const o1 = await call(client, "capture_observation", { body: "10k easy run, felt strong, slept 8h the night before.", routed_to: "running", kind: "run" });
  const o2 = await call(client, "capture_observation", { body: "Hard intervals but legs flat — only 5h sleep.", routed_to: "running", kind: "run" });
  const ev = [o1.path, o2.path].filter(Boolean);
  const skillIns = await call(client, "propose_insight", { practice: "running", title: "protect sleep before hard sessions", summary: "Before any hard/interval session, prioritise 8h sleep the night before — quality craters on short sleep.", evidence: ev, proposed_output: "skill" });
  const ctxIns = await call(client, "propose_insight", { practice: "running", title: "short sleep flattens hard runs", summary: "On nights under ~6h sleep, the next day's hard sessions reliably feel flat regardless of fuelling.", evidence: ev, proposed_output: "context", target_context_file: "what_works.md" });

  const before = tree((p) => p.includes("/practices/running/"));
  console.log("BEFORE accept — running/ files:"); before.forEach((f) => console.log("  " + f));

  const acc1 = await call(client, "decide_insight", { pending_path: skillIns.path, decision: "accept" });
  const acc2 = await call(client, "decide_insight", { pending_path: ctxIns.path, decision: "accept" });
  console.log("\naccept(skill)   ->", JSON.stringify(acc1.projected ?? acc1));
  console.log("accept(context) ->", JSON.stringify(acc2.projected ?? acc2));

  const after = tree((p) => p.includes("/practices/running/"));
  console.log("\nAFTER accept — running/ files:"); after.forEach((f) => console.log("  " + (before.includes(f) ? " " : "+") + " " + f));

  const skillFiles = after.filter((p) => /\/skills\/[^/]+\.md$/.test(p));
  console.log("\n--- skills/ written:", skillFiles.length, "---");
  for (const sp of skillFiles) console.log(`[${sp}]\n` + readFile(sp).split("\n").slice(0, 20).join("\n"));
  console.log("\n--- context what_works.md (the accumulate TRUTH file) ---");
  console.log(readFile("arkive/practices/running/context/what_works.md"));
  console.log("PROOF 1 VERDICT: skill files =", skillFiles.length, "| what_works has accepted entry =",
    /short sleep flattens hard runs/i.test(readFile("arkive/practices/running/context/what_works.md")));

  // ============ PROOF 2 — full loop on a NOVEL domain (model builds structure) ============
  console.log("\n\n========== PROOF 2: full loop on a NOVEL domain (language learning) ==========");
  const catalog = await call(client, "list_practice_templates", {});
  const setupModel = getModelClient({ runId: "proof-setup" });
  const sys = [
    "You are Arkive's in-chat partner, running the §2.1 'set up a new practice' flow.",
    "The user shapes only events (journal_entity_types) + state/truth (context_files). You silently set the rest.",
    "Pattern-match the user's domain to the CLOSEST structural SHAPE among the example templates, then ADAPT it.",
    "Every context file needs update_mode: 'replace' for STATE (overwritten as it changes) or 'accumulate' for TRUTH/PATTERN (learned truths; the home for accepted insights). Declare >=1 accumulate file.",
    "Return ONLY JSON: { chosen_shape, explanation (plain language for the user), practice:{name,description,triggers:[]}, journal_entity_types:[{name,folder,required:[],optional:[],append_only,status_field:[],body_appends:[]}], context_files:[{name,purpose,schema:'structured'|'free_form',update_triggers:[],update_mode:'replace'|'accumulate'}] }",
  ].join("\n");
  const userMsg = [
    "EXAMPLE TEMPLATE SHAPES (from list_practice_templates):",
    JSON.stringify(catalog.templates, null, 2),
    "",
    "The user just said: \"I want to start tracking my Spanish learning — I'm doing lessons and trying to actually get fluent.\"",
    "Design the practice structure. Return ONLY the JSON.",
  ].join("\n");
  const resp = await setupModel.complete({ system: sys, messages: [{ role: "user", content: userMsg }], maxTokens: 2000 });
  const jStart = resp.text.indexOf("{"), jEnd = resp.text.lastIndexOf("}");
  const design = JSON.parse(resp.text.slice(jStart, jEnd + 1));
  console.log("MODEL CHOSE shape:", design.chosen_shape);
  console.log("MODEL EXPLANATION:", (design.explanation || "").replace(/\s+/g, " ").slice(0, 400));
  console.log("MODEL context_files:", design.context_files.map((f: any) => `${f.name}[${f.update_mode}]`).join(", "));
  console.log("MODEL journal types:", design.journal_entity_types.map((j: any) => j.name).join(", "));

  // Execute the model's design through the REAL schema-enforcing tools.
  const pname = (design.practice.name || "language-learning").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  await call(client, "create_practice", { name: pname, description: design.practice.description, triggers: design.practice.triggers || [] });
  const patchResult = await call(client, "update_practice_config", {
    name: pname,
    patch: {
      add_entity_types: design.journal_entity_types.map((j: any) => ({
        name: j.name, folder: j.folder, schema: { required: j.required || [], optional: j.optional || [] },
        append_only: j.append_only !== false,
        ...((j.status_field?.length || j.body_appends?.length) ? { allowed_mutations: { ...(j.status_field?.length ? { status_field: j.status_field } : {}), ...(j.body_appends?.length ? { body_appends: j.body_appends } : {}) } } : {}),
      })),
      add_context_files: design.context_files.map((f: any) => ({
        name: f.name, purpose: f.purpose, schema: f.schema, update_triggers: f.update_triggers || [], update_mode: f.update_mode,
      })),
    },
  });
  console.log("\nupdate_practice_config accepted:", patchResult.path ? "YES (valid config written)" : JSON.stringify(patchResult));

  const cfg = await call(client, "get_practice_config", { practice: pname });
  const accumFile = (cfg.config?.provides?.context_files || []).find((f: any) => f.update_mode === "accumulate");
  console.log("Declared context files:", (cfg.config?.provides?.context_files || []).map((f: any) => `${f.name}[${f.update_mode}]`).join(", "));
  console.log("Accumulate TRUTH home:", accumFile?.name);

  // Propose + accept a diagnostic insight into the structure the model built.
  const lo = await call(client, "capture_observation", { body: "Spanish lesson — verb conjugations clicked after I spoke out loud instead of just reading.", routed_to: pname, kind: "lesson" });
  const li = await call(client, "propose_insight", {
    practice: pname, title: "speaking out loud beats silent review",
    summary: "Conjugations and vocab stick far better when practised out loud than read silently — speaking is the retention lever.",
    evidence: [lo.path].filter(Boolean), proposed_output: "context", target_context_file: accumFile?.name,
  });
  const laccept = await call(client, "decide_insight", { pending_path: li.path, decision: "accept" });
  console.log("\naccept(language insight) ->", JSON.stringify(laccept.projected ?? laccept));
  const landedPath = `arkive/practices/${pname}/context/${accumFile?.name}`;
  console.log(`\n--- ${accumFile?.name} (model-built TRUTH home, after accept) ---`);
  console.log(readFile(landedPath));
  console.log("PROOF 2 VERDICT: model built a valid practice =", !!patchResult.path,
    "| insight landed in model-built context =", /speaking out loud/i.test(readFile(landedPath)));

  console.log("\n=== fixture cleanliness: any .md.md? ===", tree((p) => p.endsWith(".md.md")).length === 0 ? "none (clean)" : "FOUND");
  await client.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROOF ERR:", (e as Error).message, "\n", (e as Error).stack); process.exit(2); });
