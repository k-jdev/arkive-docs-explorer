// Local export script: reads every arkive entry + keystore from the filesystem and
// emits a single JSON file ready to be POSTed to a hosted instance's /api/storage-import.
//
// Usage:
//   node scripts/export-local.mjs > arkive-export.json
//
// Then:
//   curl -X POST -H "content-type: application/json" \
//        --data-binary @arkive-export.json \
//        https://your-host.vercel.app/api/storage-import?token=<EXPORT_IMPORT_TOKEN>

import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), ".arkive");
const ARKIVES_ROOT = path.join(ROOT, "arkives");

const FM_DELIM = "---";

function parseFrontmatter(raw) {
  const meta = {};
  if (!raw.startsWith(FM_DELIM)) return { meta, body: raw };
  const end = raw.indexOf("\n" + FM_DELIM, FM_DELIM.length);
  if (end === -1) return { meta, body: raw };
  const yamlBlock = raw.slice(FM_DELIM.length, end).trim();
  const body = raw.slice(end + FM_DELIM.length + 1).replace(/^\n/, "");
  for (const line of yamlBlock.split("\n")) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const valRaw = m[2].trim();
    if (valRaw === "" || valRaw === "null") {
      meta[m[1]] = null;
      continue;
    }
    try {
      meta[m[1]] = JSON.parse(valRaw);
    } catch {
      meta[m[1]] = valRaw.replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body };
}

async function walk(dir, relParts, out) {
  let items;
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      await walk(full, [...relParts, it.name], out);
    } else if (it.name.endsWith(".md")) {
      const slug = it.name.replace(/\.md$/, "");
      const entryPath = [...relParts, slug].join("/");
      const raw = await fs.readFile(full, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      out.push({ path: entryPath, meta, body });
    }
  }
}

async function main() {
  const entries = [];
  // Walk all top-level dirs under arkives/. Each top-level name is an arkive type.
  let topLevel;
  try {
    topLevel = await fs.readdir(ARKIVES_ROOT, { withFileTypes: true });
  } catch (e) {
    console.error("ERROR: no .arkive/arkives directory found at", ARKIVES_ROOT);
    process.exit(1);
  }
  for (const t of topLevel) {
    if (!t.isDirectory()) continue;
    await walk(path.join(ARKIVES_ROOT, t.name), [t.name], entries);
  }

  // Keystore
  let keystore = null;
  try {
    const raw = await fs.readFile(path.join(ROOT, "keystore.json"), "utf8");
    keystore = JSON.parse(raw);
  } catch {
    keystore = null;
  }

  const out = {
    exportedAt: new Date().toISOString(),
    arkiveEntryCount: entries.length,
    keystoreWalletCount: keystore?.wallets?.length ?? 0,
    entries,
    keystore,
  };
  process.stdout.write(JSON.stringify(out, null, 2));
  // Summary to stderr so it doesn't pollute the JSON output
  process.stderr.write(`\nExported ${entries.length} arkive entries + ${out.keystoreWalletCount} wallets.\n`);
}

main().catch((e) => {
  console.error("EXPORT FAILED:", e.message);
  process.exit(1);
});
