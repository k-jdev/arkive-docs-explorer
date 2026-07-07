// Phase 3 importer — reads .preservation/unpacked/ (Phil's preserved
// pre-rebuild data) and emits a single arkive-import.json that lands
// cleanly onto the new stream-first model.
//
// What gets DROPPED (auto-managed or stale):
//   - arkive/arkive.protocol.md        (auto-refreshed by read-bundle on v7.0.0)
//   - arkive/arkive.config             (regenerated with 3 practices)
//   - arkive/arkive.index              (auto-rebuilt on next read)
//   - arkive/practices/<*>/practice.config        (re-authored)
//   - arkive/practices/<*>/practice.instructions.md (re-authored / placeholder)
//   - _internal/config/system/migration-marker-*  (no longer relevant)
//   - arkive/identity.md (if placeholder)         (re-seeded; user fills later)
//   - arkive/loadup.md (if placeholder)           (re-seeded with substantive content from the misrouted path)
//   - arkive/practices/core/loadup.md             (RELOCATED → arkive/loadup.md)
//
// What gets PRESERVED (the user's actual content):
//   - arkive/practices/trading/journal/**/*.md    (trades, research, conversations, recaps)
//   - arkive/practices/trading/skills/**/*.md
//   - arkive/practices/trading/insights/**/*.md
//   - arkive/practices/trading/context/*.md       (overwrites the seeded placeholders)
//   - arkive/practices/watches/context/*.md       (substantive — $1.2M of state)
//   - arkive/practices/ventures/context/*.md      (substantive — Ashpool / Align / etc.)
//   - _internal/trades/<txhash>                   (159 records — power get_pnl_summary etc.)
//
// What gets RE-AUTHORED (seeds Phase 3 writes ON TOP of):
//   - arkive/identity.md (placeholder if user hasn't filled it)
//   - arkive/loadup.md (substantive content from the misrouted core/loadup.md)
//   - arkive/arkive.config (trading active, watches + ventures on_demand)
//   - arkive/practices/trading/practice.config (re-authored v2.0.0)
//   - arkive/practices/trading/practice.instructions.md (the full playbook)
//   - arkive/practices/watches/practice.config (bare)
//   - arkive/practices/watches/practice.instructions.md (placeholder)
//   - arkive/practices/ventures/practice.config (bare)
//   - arkive/practices/ventures/practice.instructions.md (placeholder)
//
// Output:
//   - arkive-import.json — directly POST-able to /api/storage-import.
//   - Console report — counts by category + the destination shape.
//
// Usage:
//   $ node scripts/rebuild-import.mjs                  # writes arkive-import.json
//   $ node scripts/rebuild-import.mjs --stdout         # prints to stdout
//   $ node scripts/rebuild-import.mjs --report-only    # report without writing

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const UNPACKED = path.join(ROOT, ".preservation/unpacked");
const OUT = path.join(ROOT, "arkive-import.json");

const args = new Set(process.argv.slice(2));
const STDOUT = args.has("--stdout");
const REPORT_ONLY = args.has("--report-only");

// ---------------------------------------------------------------------------
// 1) Build the SEED entries (re-authored universals + practice scaffolds).
//    These overwrite anything stale; preserved content writes on top.
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();
const ARKIVE_CORE_VERSION = "arkive-core-v1";
const PROTOCOL_VERSION = "v7.0.0";

function fm(meta, body) {
  // Minimal YAML — matches the codec in src/lib/arkive-v2/frontmatter.ts
  const head = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`;
        return [`${k}:`, ...v.map((x) => `  - ${typeof x === "string" ? quote(x) : x}`)].join("\n");
      }
      if (typeof v === "string") return `${k}: ${quote(v)}`;
      return `${k}: ${v}`;
    })
    .join("\n");
  return `---\n${head}\n---\n\n${body}`;
}

function quote(s) {
  if (/[:#\n[\]{}]/.test(s) || /^(true|false|null|~|\d)/i.test(s) || /^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function entry(p, body, meta = {}) {
  return { path: p, meta, body };
}

const seeds = [];

// --- Universal root files ---

seeds.push(
  entry(
    "arkive/identity.md",
    fm(
      {
        entity_type: "identity",
        practice: "core",
        created_at: NOW,
        last_updated: NOW,
        version: 1,
      },
      `# Identity\n\n[Fill this in during onboarding. Useful seeds:\n- Who you are (a sentence or two).\n- The practices you're activating + what each one captures.\n- Communication style preferences (terse vs thorough).\n- Hard limits across every practice.]\n`
    ),
    { entity_type: "identity", practice: "core", created_at: NOW, last_updated: NOW, version: 1 }
  )
);

// loadup gets the substantive content from the misrouted practices/core/loadup.md
// — read it from the preservation and use the body verbatim. If for some
// reason it's missing, fall back to the default placeholder.
let loadupBody;
try {
  const raw = await fs.readFile(path.join(UNPACKED, "arkive/practices/core/loadup.md"), "utf8");
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  loadupBody = m ? m[1].trim() : raw.trim();
} catch {
  loadupBody = `# Loadup\n\nEdit this file to tell Ark what you want at the start of every session.\nKeep it brief — this runs every time.\n\n## What I want at session start\n\nBy default: a one-line "what's new since last time".\n`;
}
seeds.push(
  entry(
    "arkive/loadup.md",
    fm(
      {
        entity_type: "loadup",
        practice: "core",
        created_at: NOW,
        last_updated: NOW,
        version: 1,
      },
      loadupBody.endsWith("\n") ? loadupBody : loadupBody + "\n"
    ),
    { entity_type: "loadup", practice: "core", created_at: NOW, last_updated: NOW, version: 1 }
  )
);

// arkive.config — pure YAML body, no frontmatter
const arkiveConfigYaml = [
  `version: ${ARKIVE_CORE_VERSION}`,
  `identity_ref: identity.md`,
  `protocol_ref: arkive.protocol.md`,
  ``,
  `practices:`,
  `  trading:`,
  `    enabled: true`,
  `    mode: active`,
  `    version: 2.0.0`,
  `  watches:`,
  `    enabled: true`,
  `    mode: on_demand`,
  `    version: 0.1.0`,
  `  ventures:`,
  `    enabled: true`,
  `    mode: on_demand`,
  `    version: 0.1.0`,
  ``,
  `defaults:`,
  `  weekly_recap: true`,
  `  monthly_retrospective: true`,
  `  insight_evidence_threshold: 3`,
  `  rejection_cooldown_threshold: 10`,
  `  conversation_timeout_min: 30`,
  `  recent_window_days: 30`,
  `  recent_max_entries: 200`,
  ``,
].join("\n");
seeds.push(entry("arkive/arkive.config", arkiveConfigYaml, {}));

// --- Watches + ventures bare configs ---
// Trading's config + instructions are re-authored by the existing reset/migration
// path on first read (since they're already in seeds.ts). For watches and
// ventures we write bare configs + placeholder instructions explicitly.

function bareConfigYaml(name, description, triggers) {
  const trigBlock = triggers && triggers.length
    ? [`  triggers:`, ...triggers.map((t) => `    - ${t}`)].join("\n") + "\n"
    : "";
  return [
    `name: ${name}`,
    `version: 0.1.0`,
    `based_on: ${ARKIVE_CORE_VERSION}`,
    `description: ${quote(description)}`,
    ``,
    `provides:`,
    `  journal_entity_types: []`,
    `  context_files: []`,
    `  skill_format:`,
    `    description: ${quote(`Behavioral playbooks for ${name}.`)}`,
    `    required_sections: [when_this_applies, how_to_act]`,
    `    versioning: semver_per_skill`,
    `    envelope_required: false`,
    ``,
    `loading:`,
    `  default_mode: on_demand`,
    trigBlock,
    `insight_flow:`,
    `  default_output: ask_user`,
    `  evidence_threshold: 3`,
    `  rejection_cooldown_threshold: 10`,
    ``,
  ].join("\n");
}

function bareInstructionsMd(name) {
  return fm(
    {
      entity_type: "practice_instructions",
      practice: name,
      created_at: NOW,
      last_updated: NOW,
      version: 1,
    },
    `# ${name} practice — operational playbook

How you want me to act inside the ${name} practice. Edit freely; this is
your file.

## What this practice tracks

[Briefly: what does this practice capture? What entities, what state, what
decisions?]

## How I should act

- [Be brief vs. thorough?]
- [Ask before logging, or just log silently?]
- [Defaults that should apply by default]
- [Anti-patterns — things I should NEVER do here]

## Anything else

[Notes about your domain, terminology you use, common workflows.]
`
  );
}

seeds.push(
  entry(
    "arkive/practices/watches/practice.config",
    bareConfigYaml("watches", "Watch reselling — sourcing, deals, inventory, capital state.", ["watch", "deal", "broker", "rolex", "fp journe", "ap", "rm"]),
    {}
  )
);
seeds.push(
  entry(
    "arkive/practices/watches/practice.instructions.md",
    bareInstructionsMd("watches"),
    { entity_type: "practice_instructions", practice: "watches", created_at: NOW, last_updated: NOW, version: 1 }
  )
);
seeds.push(
  entry(
    "arkive/practices/ventures/practice.config",
    bareConfigYaml("ventures", "Crypto ventures — Ashpool, Align, decisions, stakeholders.", ["ashpool", "align", "venture", "project"]),
    {}
  )
);
seeds.push(
  entry(
    "arkive/practices/ventures/practice.instructions.md",
    bareInstructionsMd("ventures"),
    { entity_type: "practice_instructions", practice: "ventures", created_at: NOW, last_updated: NOW, version: 1 }
  )
);

// arkive.protocol.md is NOT seeded — read-bundle.ts auto-writes it on the
// first session, keyed by PROTOCOL_VERSION. Same for arkive.index (auto-built).
// Trading practice.config + practice.instructions.md are seeded by migrate.ts
// on first read since they're already in seeds.ts.

// ---------------------------------------------------------------------------
// 2) Walk the preserved tree and KEEP the substantive content.
// ---------------------------------------------------------------------------

const preserved = [];
const dropped = [];
const relocated = [];

async function walkPreserved(dir, rel = "") {
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const abs = path.join(dir, item.name);
    const r = rel ? `${rel}/${item.name}` : item.name;
    if (item.isDirectory()) {
      await walkPreserved(abs, r);
      continue;
    }
    const body = await fs.readFile(abs, "utf8");
    decideAndRoute(r, body);
  }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  // Very loose meta parse — we just need a few fields. The full codec runs
  // server-side when the file gets written.
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (km) meta[km[1]] = km[2].replace(/^"|"$/g, "");
  }
  return { meta, body: m[2] };
}

function decideAndRoute(relPath, body) {
  // Skip the export's manifest
  if (relPath === "manifest.json") {
    dropped.push({ path: relPath, reason: "export manifest, not a stored entry" });
    return;
  }
  // The misrouted loadup — already captured into the seed above
  if (relPath === "arkive/practices/core/loadup.md") {
    relocated.push({ from: relPath, to: "arkive/loadup.md" });
    return;
  }
  // Universal root files re-authored above
  if (
    relPath === "arkive/arkive.protocol.md" ||
    relPath === "arkive/arkive.config" ||
    relPath === "arkive/arkive.index"
  ) {
    dropped.push({ path: relPath, reason: "auto-managed; re-seeded by runtime" });
    return;
  }
  // Identity placeholder → keep our re-authored seed
  if (relPath === "arkive/identity.md") {
    if (body.includes("Fill this in during onboarding")) {
      dropped.push({ path: relPath, reason: "placeholder; re-seeded" });
      return;
    }
    // User-edited identity — preserve
    preserved.push({ path: relPath, body, meta: parseFrontmatter(body).meta, category: "identity" });
    return;
  }
  // Loadup placeholder at the canonical path
  if (relPath === "arkive/loadup.md") {
    dropped.push({ path: relPath, reason: "placeholder; substantive content imported from practices/core/loadup.md" });
    return;
  }
  // Practice configs + instructions → re-authored
  const cfgMatch = relPath.match(/^arkive\/practices\/([^/]+)\/practice\.config$/);
  if (cfgMatch) {
    dropped.push({ path: relPath, reason: `practice.config re-authored for ${cfgMatch[1]}` });
    return;
  }
  const instrMatch = relPath.match(/^arkive\/practices\/([^/]+)\/practice\.instructions\.md$/);
  if (instrMatch) {
    dropped.push({ path: relPath, reason: `practice.instructions.md re-authored for ${instrMatch[1]}` });
    return;
  }
  // Stale migration marker
  if (relPath.startsWith("_internal/config/system/migration-marker")) {
    dropped.push({ path: relPath, reason: "obsolete migration marker" });
    return;
  }
  // _internal/trades/* — keep all (powers PnL math)
  if (relPath.startsWith("_internal/trades/")) {
    preserved.push({
      path: relPath,
      body,
      meta: parseFrontmatter(body).meta,
      category: "internal_trade",
    });
    return;
  }
  // Practice content — KEEP everything under journal/skills/insights/context
  const ptMatch = relPath.match(/^arkive\/practices\/([^/]+)\/(journal|skills|insights|context)\//);
  if (ptMatch) {
    const [, practice, area] = ptMatch;
    preserved.push({
      path: relPath,
      body,
      meta: parseFrontmatter(body).meta,
      category: `${practice}:${area}`,
    });
    return;
  }
  // Anything else — surface for review, default to drop
  dropped.push({ path: relPath, reason: "unclassified; review" });
}

await walkPreserved(UNPACKED);

// ---------------------------------------------------------------------------
// 3) Compose the final entry list. Order: seeds first (so preserved
//    content overwrites placeholders), then preserved.
// ---------------------------------------------------------------------------

const allEntries = [...seeds, ...preserved.map((p) => ({
  path: p.path,
  meta: p.meta ?? {},
  body: p.body,
}))];

// Sanity: every path must be a string + no duplicates that would silently clobber
const seen = new Set();
const dupes = [];
for (const e of allEntries) {
  if (typeof e.path !== "string" || !e.path) {
    throw new Error(`Bad entry: ${JSON.stringify(e).slice(0, 200)}`);
  }
  if (seen.has(e.path)) dupes.push(e.path);
  seen.add(e.path);
}

// ---------------------------------------------------------------------------
// 4) Report + write
// ---------------------------------------------------------------------------

const byCategory = {};
for (const p of preserved) {
  byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
}

const report = {
  exportedAt: NOW,
  totals: {
    seeds: seeds.length,
    preserved: preserved.length,
    dropped: dropped.length,
    relocated: relocated.length,
    final_entries: allEntries.length,
    duplicate_paths: dupes,
  },
  preserved_by_category: byCategory,
  relocated,
  dropped_summary: dropped.reduce((m, d) => {
    m[d.reason] = (m[d.reason] ?? 0) + 1;
    return m;
  }, {}),
};

console.log("=== IMPORTER REPORT ===");
console.log(JSON.stringify(report, null, 2));

if (REPORT_ONLY) process.exit(0);

const payload = {
  exportedAt: NOW,
  entries: allEntries,
  keystore: null,
};

const json = JSON.stringify(payload, null, 2);
if (STDOUT) {
  process.stdout.write(json);
} else {
  await fs.writeFile(OUT, json);
  console.log(`\nWrote ${allEntries.length} entries to ${path.relative(ROOT, OUT)} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB).`);
  console.log("\nTo POST to production:");
  console.log("  curl -X POST -H \"x-import-token: $IMPORT_TOKEN\" -H \"content-type: application/json\" \\");
  console.log("       --data-binary @arkive-import.json \\");
  console.log("       https://<your-deploy>/api/storage-import");
  console.log("\nThen sign in and POST /api/auth/claim to move data from _local to your user_id.");
}
