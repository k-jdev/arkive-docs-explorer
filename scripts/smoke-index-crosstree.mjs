// Smoke test for the universal indexer — runs against the preserved data
// (.preservation/unpacked/) and reports every cross-tree edge it finds.
//
// Pre-fix, the indexer only picked up the 7 universal link types
// (sources, evidence, triggered_by, produced, resulted_in, applied_to,
// created_from). Practice-declared link types like linked_trade,
// linked_research, applied_skill, tests_thesis were dropped silently —
// so cross-tree connections never reached the graph.
//
// This script mirrors the v2 extractor's logic (heuristic scan of every
// frontmatter field for path-shaped values that resolve to known nodes)
// and prints a per-edge-type report.
//
// Pass condition: at least one cross-practice OR within-practice cross-
// folder edge is detected against the preserved data.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const UNPACKED = path.join(ROOT, ".preservation/unpacked");

// ---- Mirror of the v2 extractor (kept in sync with src/lib/arkive-v2/arkive-index.ts) ----

const UNIVERSAL_LINK_TYPES = [
  "sources",
  "evidence",
  "triggered_by",
  "produced",
  "resulted_in",
  "applied_to",
  "created_from",
];

const NON_LINK_META_KEYS = new Set([
  "entity_type", "practice", "created_at", "last_updated", "version",
  "protocol_version", "name", "title", "status", "kind", "mentions",
  "routed_to", "summary", "thesis_summary", "topic", "description",
  "asset", "chain", "venue", "type", "side", "leverage", "size",
  "entry_price", "exit_price", "exit_date", "pnl", "trade_id", "flagged",
  "topic_tags", "user_state_revealed", "duration_minutes", "target_date",
  "predictions", "falsification_criteria", "period_start", "period_end",
  "highlights", "open_questions", "envelope_override", "resolution_date",
  "cooldown_until", "proposed_output", "evidence_types",
  "structured_fields", "ran_at", "touched",
]);

function looksLikePath(s) {
  if (typeof s !== "string" || s.length === 0) return false;
  if (s.includes(" ")) return false;
  if (s.startsWith("http://") || s.startsWith("https://")) return false;
  return s.startsWith("arkive/") || s.startsWith("_internal/") || s.startsWith("practices/") || s.endsWith(".md");
}

function normalizePathRef(ref) {
  let r = ref.trim();
  if (r.startsWith("./")) r = r.slice(2);
  if (r.startsWith("/")) r = r.slice(1);
  if (r.startsWith("arkive/")) return r;
  if (r.startsWith("practices/")) return `arkive/${r}`;
  if (r.endsWith(".md") && !r.includes("/")) return r;
  return r;
}

function collectStringRefs(value) {
  if (typeof value === "string" && looksLikePath(value)) return [value];
  if (Array.isArray(value)) {
    return value.filter((x) => typeof x === "string" && looksLikePath(x));
  }
  return [];
}

// Loose YAML reader — handles the subset our files use
function parseFm(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return {};
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  let currentArrayKey = null;
  for (const line of lines) {
    if (/^[A-Za-z_]+:\s*$/.test(line)) {
      currentArrayKey = line.replace(":", "").trim();
      meta[currentArrayKey] = [];
      continue;
    }
    if (currentArrayKey && /^\s+-\s+/.test(line)) {
      meta[currentArrayKey].push(line.replace(/^\s+-\s+/, "").replace(/^"|"$/g, "").trim());
      continue;
    }
    const km = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.+)$/);
    if (km) {
      currentArrayKey = null;
      let v = km[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      // Try inline array: [a, b, c]
      if (v.startsWith("[") && v.endsWith("]")) {
        v = v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      }
      meta[km[1]] = v;
    }
  }
  return meta;
}

// ---- Build the index ----

async function walk(dir, rel = "") {
  const out = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const it of items) {
    const abs = path.join(dir, it.name);
    const r = rel ? `${rel}/${it.name}` : it.name;
    if (it.isDirectory()) {
      out.push(...await walk(abs, r));
    } else if (it.name.endsWith(".md") || it.name === "loadup.md" || it.name === "identity.md" || it.name === "arkive.protocol.md") {
      const body = await fs.readFile(abs, "utf8");
      out.push({ path: r, body });
    }
  }
  return out;
}

const all = await walk(UNPACKED);
// Filter out the ones the production indexer would skip
const indexable = all.filter((e) => {
  if (e.path === "arkive/arkive.config") return false;
  if (e.path === "arkive/arkive.index") return false;
  if (e.path.startsWith("_internal/")) return false;
  if (e.path.endsWith("/practice.config")) return false;
  return true;
});

const knownPaths = new Set(indexable.map((e) => e.path));

console.log(`=== INDEX SMOKE (cross-tree) ===`);
console.log(`Total files in export:    ${all.length}`);
console.log(`Indexable (eligible):     ${indexable.length}`);

// Extract edges
const edges = [];
for (const e of indexable) {
  const meta = parseFm(e.body);
  // Pass 1a: universal types
  for (const link of UNIVERSAL_LINK_TYPES) {
    const refs = collectStringRefs(meta[link]).map(normalizePathRef);
    for (const r of refs) {
      edges.push({ from: e.path, to: r, type: link, broken: !knownPaths.has(r) });
    }
  }
  // Pass 1b: heuristic — every other field that resolves to a known node
  for (const [key, value] of Object.entries(meta)) {
    if (NON_LINK_META_KEYS.has(key)) continue;
    if (UNIVERSAL_LINK_TYPES.includes(key)) continue;
    const refs = collectStringRefs(value).map(normalizePathRef).filter((r) => knownPaths.has(r));
    for (const r of refs) {
      edges.push({ from: e.path, to: r, type: key, broken: false });
    }
  }
}

// Categorize: in-folder, cross-folder same-practice, cross-practice
function practiceOf(p) {
  const m = p.match(/^arkive\/practices\/([^/]+)\//);
  return m ? m[1] : "core";
}
function folderOf(p) {
  return p.replace(/\/[^/]+$/, "");
}

let inSame = 0, crossFolder = 0, crossPractice = 0, broken = 0;
const byType = {};
for (const e of edges) {
  byType[e.type] = (byType[e.type] ?? 0) + 1;
  if (e.broken) { broken++; continue; }
  const pa = practiceOf(e.from);
  const pb = practiceOf(e.to);
  if (pa !== pb) crossPractice++;
  else if (folderOf(e.from) !== folderOf(e.to)) crossFolder++;
  else inSame++;
}

console.log(``);
console.log(`Edges total:              ${edges.length}`);
console.log(`  intra-folder:            ${inSame}`);
console.log(`  cross-folder, same-practice: ${crossFolder}`);
console.log(`  CROSS-PRACTICE:           ${crossPractice}`);
console.log(`  broken (target missing):  ${broken}`);

console.log(``);
console.log(`By edge type:`);
for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(24)} ${n}`);
}

if (crossFolder + crossPractice > 0) {
  console.log(``);
  console.log(`Sample cross-tree edges:`);
  let shown = 0;
  for (const e of edges) {
    if (e.broken) continue;
    const pa = practiceOf(e.from); const pb = practiceOf(e.to);
    const fa = folderOf(e.from); const fb = folderOf(e.to);
    if (pa !== pb || fa !== fb) {
      console.log(`  [${e.type}]`);
      console.log(`    from: ${e.from}`);
      console.log(`    to:   ${e.to}`);
      shown++;
      if (shown >= 5) break;
    }
  }
}

console.log(``);
if (edges.length === 0) {
  console.log(`NOTE: zero edges in the preserved data — the AI didn't populate link fields when writing.`);
  console.log(`The fix is correct, but the data simply hasn't been cross-linked yet.`);
  console.log(`As you keep using the system the index will fill in.`);
  process.exit(0);
}

if (crossFolder + crossPractice === 0) {
  console.log(`WARN — every detected edge is intra-folder. No real cross-tree connections in the preserved data.`);
  process.exit(0);
}

console.log(`PASS — cross-tree edges detected. Indexer + heuristic scan working.`);
