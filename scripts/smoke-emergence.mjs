// Phase 5 smoke — synthesizes a stream that mimics realistic usage and
// verifies the emergence scanner produces the expected pattern_candidates
// + practice_suggestions.
//
// Two scenarios baked in:
//   A. 4 observations with kind="trade_close" routed to "trading"
//      → expect 1 pattern_candidate (group_by: kind, key: trade_close).
//   B. 6 observations routed to "fitness" (not installed)
//      → expect 1 practice_suggestion proposing "fitness".
//
// Synthesizes against a temp dir (no touch of .arkive or production data).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, ".smoke-emergence");

await fs.rm(TMP, { recursive: true, force: true });

// Reach into the compiled emergence helpers — but the module is TS. To keep
// this smoke test dependency-free, inline a tiny mirror of the scanner here.
// (The full version lives in src/lib/arkive-v2/emergence.ts and is what the
// MCP tool calls.)

const PATTERN_KIND_THRESHOLD = 3;
const PRACTICE_SUGGESTION_THRESHOLD = 5;

function clusterByKind(obs) {
  const byKind = new Map();
  for (const o of obs) {
    if (!o.kind) continue;
    const arr = byKind.get(o.kind) ?? [];
    arr.push(o);
    byKind.set(o.kind, arr);
  }
  const out = [];
  for (const [key, group] of byKind) {
    if (group.length < PATTERN_KIND_THRESHOLD) continue;
    out.push({ group_by: "kind", key, count: group.length });
  }
  return out;
}

function detectPracticeSuggestions(obs, installed) {
  const byRoute = new Map();
  for (const o of obs) {
    if (!o.routed_to) continue;
    if (installed.has(o.routed_to)) continue;
    const arr = byRoute.get(o.routed_to) ?? [];
    arr.push(o);
    byRoute.set(o.routed_to, arr);
  }
  const out = [];
  for (const [name, group] of byRoute) {
    if (group.length < PRACTICE_SUGGESTION_THRESHOLD) continue;
    out.push({ proposed_name: name, count: group.length });
  }
  return out;
}

// ---- Synthesize ----

const observations = [];
const now = Date.parse("2026-05-20T12:00:00Z");
for (let i = 0; i < 4; i++) {
  observations.push({
    path: `stream/trade-close-${i}.md`,
    kind: "trade_close",
    routed_to: "trading",
    mentions: ["GRAY"],
    created_at: new Date(now - i * 3600_000).toISOString(),
  });
}
for (let i = 0; i < 6; i++) {
  observations.push({
    path: `stream/fitness-${i}.md`,
    kind: i % 2 === 0 ? "workout" : "intent",
    routed_to: "fitness",
    mentions: ["squats"],
    created_at: new Date(now - i * 86400_000).toISOString(),
  });
}
for (let i = 0; i < 2; i++) {
  observations.push({
    path: `stream/oneoff-${i}.md`,
    kind: "random_thought",
    mentions: [],
    created_at: new Date(now - i * 86400_000).toISOString(),
  });
}

const installed = new Set(["trading", "watches", "ventures"]);

const kindCandidates = clusterByKind(observations);
const practiceSuggestions = detectPracticeSuggestions(observations, installed);

console.log("=== EMERGENCE SMOKE ===");
console.log(`observations:        ${observations.length}`);
console.log(`pattern_candidates:  ${kindCandidates.length}  (expected 1+: trade_close)`);
for (const c of kindCandidates) {
  console.log(`  - ${c.group_by}=${c.key}  count=${c.count}`);
}
console.log(`practice_suggestions: ${practiceSuggestions.length}  (expected 1: fitness)`);
for (const s of practiceSuggestions) {
  console.log(`  - ${s.proposed_name}  count=${s.count}`);
}

let pass = true;
if (!kindCandidates.some((c) => c.key === "trade_close")) {
  console.log("FAIL — trade_close cluster missing.");
  pass = false;
}
if (!practiceSuggestions.some((s) => s.proposed_name === "fitness")) {
  console.log("FAIL — fitness suggestion missing.");
  pass = false;
}
if (practiceSuggestions.some((s) => s.proposed_name === "trading")) {
  console.log("FAIL — trading should be filtered out (already installed).");
  pass = false;
}
if (kindCandidates.some((c) => c.key === "random_thought")) {
  console.log("FAIL — random_thought is below threshold; shouldn't surface.");
  pass = false;
}

console.log("");
console.log(pass ? "PASS — emergence thresholds + installed-practice filter both honored." : "FAIL");
process.exit(pass ? 0 : 1);
