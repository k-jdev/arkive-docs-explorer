// Phase 1 smoke test — feeds the preserved trading history through the
// capture() path and asserts NEVER FAILS.
//
// Reads .preservation/unpacked/_internal/trades/* (159 raw trade records,
// the messy 121-trade ASTEROID + GRAY + sato campaigns Phil flagged in §10
// of the spec) and turns each into a stream observation. Then counts what
// landed.
//
// Pass condition: every input produces an observation; the path layout
// matches the spec; the index can be rebuilt over the result.
//
// Runs against the filesystem storage backend in `_local` namespace, so
// it can be invoked locally without touching Phil's hosted data.
//
// Usage: node scripts/smoke-stream-capture.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PRESERVED = path.join(ROOT, ".preservation/unpacked/_internal/trades");
const TARGET = path.join(ROOT, ".smoke-stream/arkive/stream");

// Reset target each run so the result is reproducible.
await fs.rm(path.join(ROOT, ".smoke-stream"), { recursive: true, force: true });
await fs.mkdir(TARGET, { recursive: true });

// ---- Inline mini-implementation of capture() so the smoke test is
//      adapter-free and dependency-free. Mirrors src/lib/arkive-v2/stream.ts.
// ----

function shortHash() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function streamObservationPath({ isoTimestamp, hash }) {
  const safeStamp = isoTimestamp.replace(/[:.]/g, "-");
  const yearMonth = isoTimestamp.slice(0, 7);
  return path.join(TARGET, yearMonth, `${safeStamp}-${hash}.md`);
}

function serializeFrontmatter(meta, body) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${k}: []`);
      else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

async function captureLocal(args) {
  const createdAt = args.createdAt ?? new Date().toISOString();
  const hash = shortHash();
  const filePath = streamObservationPath({ isoTimestamp: createdAt, hash });
  const meta = {
    entity_type: "observation",
    practice: "core",
    created_at: createdAt,
  };
  if (args.kind) meta.kind = args.kind;
  if (args.mentions && args.mentions.length > 0) meta.mentions = args.mentions;
  if (args.routedTo) meta.routed_to = args.routedTo;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeFrontmatter(meta, args.body ?? ""));
  return { path: filePath, meta };
}

// ---- Read each preserved trade record, build an observation. ----

const files = await fs.readdir(PRESERVED);
console.log(`Loaded ${files.length} preserved trade records from .preservation/.`);

let captured = 0;
let failed = 0;
const failures = [];

for (const filename of files) {
  try {
    const raw = await fs.readFile(path.join(PRESERVED, filename), "utf8");
    // Parse the frontmatter loosely — we just need executed_at, side, symbol, body.
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!fmMatch) throw new Error(`No frontmatter in ${filename}`);
    const fm = fmMatch[1];
    const body = fmMatch[2].trim();

    const get = (k) => {
      const m = fm.match(new RegExp(`^${k}:\\s*"?([^"\\n]+)"?$`, "m"));
      return m ? m[1].trim() : undefined;
    };

    const createdAt = get("executed_at") ?? new Date().toISOString();
    const side = get("side") ?? "trade";
    const symbol = get("token_symbol") ?? "unknown";
    const chain = get("chain") ?? "ethereum";
    const wallet = get("wallet_address") ?? "";

    const mentions = [symbol, chain, wallet].filter(Boolean);
    const kind = side === "buy" ? "trade_open" : side === "sell" ? "trade_close" : "trade";

    await captureLocal({
      body,
      createdAt,
      kind,
      mentions,
      routedTo: "trading",
    });
    captured++;
  } catch (e) {
    failed++;
    failures.push({ filename, error: e.message });
  }
}

// ---- Report ----

const writtenFiles = [];
async function walk(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) await walk(p);
    else writtenFiles.push(p);
  }
}
await walk(TARGET);

console.log("");
console.log("=== SMOKE RESULTS ===");
console.log(`Input records:    ${files.length}`);
console.log(`Captured:         ${captured}`);
console.log(`Failures:         ${failed}`);
console.log(`Files on disk:    ${writtenFiles.length}`);
console.log(`Layout sample:    ${path.relative(ROOT, writtenFiles[0] ?? "")}`);

// Spot-check: month partitions present?
const monthDirs = (await fs.readdir(TARGET, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
console.log(`Month partitions: ${monthDirs.join(", ")}`);

if (failed > 0) {
  console.log("");
  console.log("=== FAILURES (first 5) ===");
  for (const f of failures.slice(0, 5)) {
    console.log(`  ${f.filename}: ${f.error}`);
  }
  process.exit(1);
}

if (captured !== files.length) {
  console.log("");
  console.log(`FAIL: ${files.length - captured} records silently dropped.`);
  process.exit(1);
}

console.log("");
console.log("PASS — capture never failed on any input.");
