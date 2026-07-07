// Migration to arkive-core-v1.
//
// Brings any existing user (whether they were on the original v2 trading
// shape, the v3 libraries shape, or anywhere in between) to the canonical
// data-model-v1 layout. Idempotent — gated on _internal markers.
//
// Steps performed (in order):
//   1. Wrap any loose trading content under arkive/practices/trading/.
//   2. Rename libraries/ → practices/ (if present from the v3-era).
//   3. Rename library.config (yaml-in-md) → practice.config (pure YAML).
//   4. Drop per-library instructions.md (spec has no such file).
//   5. Drop arkive/stats.md (not in spec).
//   6. Convert arkive.config from yaml-in-md → pure YAML.
//   7. Rewrite every entity's frontmatter to universal shape:
//        type → entity_type, timestamp → created_at, add practice field.
//   8. Trim deprecated frontmatter fields (legacy v2 keys).
//   9. Seed arkive.index.

import { storage, currentUserId, type StoredEntry } from "@/lib/storage";
import {
  PATH_CONFIG,
  PATH_INDEX,
  PRACTICES_DIR,
  V2_ROOT,
  practiceConfigPath,
  practiceInstructionsPath,
  practiceRoot,
} from "./paths";
import { parseFrontmatter, serializeEntry } from "./frontmatter";
import {
  defaultArkiveConfig,
  serializeArkiveConfig,
} from "./arkive-config";
import { serializePracticeConfig } from "./practices";
import {
  TRADING_PRACTICE,
  WATCHLIST_MD, POSITIONS_MD, RULES_MD, INTENTIONS_MD,
  TRADING_INSTRUCTIONS_MD,
  tradingPracticeConfig,
} from "./authored/trading";
import { rebuildIndex, writeIndex } from "./arkive-index";

const MARKER = "_internal/config/system/migration-marker-core-v1.md";

export async function migrateToCoreV1IfNeeded(): Promise<{ ran: boolean; touched: number }> {
  const uid = await currentUserId();
  const adapter = storage();

  const marker = await adapter.readEntry(uid, MARKER);
  if (marker) return { ran: false, touched: 0 };

  let touched = 0;

  // 1. List EVERYTHING under arkive/
  const all = await adapter.listEntries(uid, `${V2_ROOT}/`);

  // 2. Pass 1: move legacy trading-at-root + libraries/ paths under practices/trading/
  const TRADING_ROOT = practiceRoot(TRADING_PRACTICE);
  const TRADING_SEGS = ["journal", "skills", "insights", "context"];

  for (const entry of all) {
    let newPath = entry.path;
    // libraries/<x>/ → practices/<x>/
    if (newPath.startsWith(`${V2_ROOT}/libraries/`)) {
      newPath = `${PRACTICES_DIR}/${newPath.slice(`${V2_ROOT}/libraries/`.length)}`;
    }
    // Loose trading folders at arkive root → wrap under practices/trading/
    if (newPath.startsWith(`${V2_ROOT}/`)) {
      const rest = newPath.slice(V2_ROOT.length + 1);
      const firstSeg = rest.split("/")[0];
      if (TRADING_SEGS.includes(firstSeg) && !newPath.startsWith(`${PRACTICES_DIR}/`)) {
        newPath = `${TRADING_ROOT}/${rest}`;
      }
    }
    // library.config → practice.config
    newPath = newPath.replace(/\/library\.config$/, "/practice.config");
    // Drop per-practice instructions.md (spec has no such file)
    if (/\/instructions\.md$/.test(newPath) && newPath.startsWith(`${PRACTICES_DIR}/`)) {
      await adapter.deleteEntry(uid, entry.path);
      touched++;
      continue;
    }
    // Drop the legacy stats.md (not in spec)
    if (newPath === `${V2_ROOT}/stats.md`) {
      await adapter.deleteEntry(uid, entry.path);
      touched++;
      continue;
    }
    // Move if path changed
    if (newPath !== entry.path) {
      await moveEntry(uid, adapter, entry, newPath);
      touched++;
    }
  }

  // 3. Pass 2: read everything again at the new paths + rewrite frontmatter
  const refreshed = await adapter.listEntries(uid, `${V2_ROOT}/`);
  for (const e of refreshed) {
    if (e.path === PATH_CONFIG) continue;     // handled separately below
    if (e.path === PATH_INDEX) continue;      // pure JSON
    if (e.path.endsWith("/practice.config")) {
      // Convert library.config style (yaml-in-md) → pure YAML if needed
      const converted = stripFrontmatterIfPresent(e.body);
      if (converted !== e.body) {
        await adapter.writeEntry(uid, { path: e.path, body: converted, meta: {} });
        touched++;
      }
      continue;
    }

    // Rewrite frontmatter to universal shape
    const { meta, body } = parseFrontmatter(e.body);
    const m = (meta ?? {}) as Record<string, unknown>;
    const updated = normalizeFrontmatter(m, e.path);
    if (!isSame(m, updated)) {
      const text = serializeEntry(updated, body);
      await adapter.writeEntry(uid, { path: e.path, body: text, meta: updated });
      touched++;
    }
  }

  // 4. arkive.config — convert from yaml-in-md → pure YAML
  const cfg = defaultArkiveConfig();
  await adapter.writeEntry(uid, {
    path: PATH_CONFIG,
    body: serializeArkiveConfig(cfg),
    meta: {},
  });
  touched++;

  // 5. Ensure trading practice.config exists with the canonical §12 shape.
  //    Overwrites any leftover from older migrations — this is the spec.
  await adapter.writeEntry(uid, {
    path: practiceConfigPath(TRADING_PRACTICE),
    body: serializePracticeConfig(tradingPracticeConfig()),
    meta: {},
  });
  touched++;

  // 6. Seed trading's context/ files if any are missing.
  await seedIfMissing(uid, adapter, `${TRADING_ROOT}/context/watchlist.md`, WATCHLIST_MD);
  await seedIfMissing(uid, adapter, `${TRADING_ROOT}/context/positions.md`, POSITIONS_MD);
  await seedIfMissing(uid, adapter, `${TRADING_ROOT}/context/rules.md`, RULES_MD);
  await seedIfMissing(uid, adapter, `${TRADING_ROOT}/context/intentions.md`, INTENTIONS_MD);

  // 6a. Seed the trading practice operational playbook if missing. This
  //     restores the trading "knowability" the global instructions used to
  //     carry — now scoped to the trading practice itself, so it doesn't
  //     leak across practices and the user can edit it.
  await seedIfMissing(uid, adapter, practiceInstructionsPath(TRADING_PRACTICE), TRADING_INSTRUCTIONS_MD);

  // 7. Build and persist the index.
  const idx = await rebuildIndex();
  await writeIndex(idx);
  touched++;

  // Mark migration complete
  await adapter.writeEntry(uid, {
    path: MARKER,
    body: `---
type: migration_marker
version: core-v1
ran_at: ${new Date().toISOString()}
touched: ${touched}
---

# Migration to arkive-core-v1

Touched ${touched} entries.
`,
    meta: { type: "migration_marker", version: "core-v1", touched },
  });

  return { ran: true, touched };
}

// ---- Helpers -----------------------------------------------------------------

async function moveEntry(
  uid: string,
  adapter: ReturnType<typeof storage>,
  entry: StoredEntry,
  newPath: string
): Promise<void> {
  const existing = await adapter.readEntry(uid, newPath);
  if (existing) return;
  await adapter.writeEntry(uid, { path: newPath, body: entry.body, meta: entry.meta });
  await adapter.deleteEntry(uid, entry.path);
}

async function seedIfMissing(
  uid: string,
  adapter: ReturnType<typeof storage>,
  path: string,
  body: string
): Promise<void> {
  const existing = await adapter.readEntry(uid, path);
  if (existing) return;
  const { meta } = parseFrontmatter(body);
  await adapter.writeEntry(uid, { path, body, meta: meta as Record<string, unknown> });
}

function stripFrontmatterIfPresent(text: string): string {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1].trim() + "\n" : text;
}

/**
 * Convert legacy frontmatter to universal-spec frontmatter:
 *   type → entity_type
 *   timestamp / last_updated → created_at (if no created_at present)
 *   add practice field if missing (derived from path)
 *   coalesce trade-entry/trade-exit → trade
 *   coalesce library_instructions/library_config → practice_instructions/practice_config
 */
function normalizeFrontmatter(
  m: Record<string, unknown>,
  path: string
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...m };

  // type → entity_type
  if (out.type && !out.entity_type) {
    let t = String(out.type);
    if (t === "trade-entry" || t === "trade-exit") t = "trade";
    if (t === "library_instructions") t = "practice_instructions";
    if (t === "library_config") t = "practice_config";
    if (t === "review") t = "retrospective";
    out.entity_type = t;
  }
  delete out.type;

  // timestamp → created_at fallback
  if (!out.created_at) {
    if (typeof out.timestamp === "string") out.created_at = out.timestamp;
    else out.created_at = new Date().toISOString();
  }
  delete out.timestamp;

  // practice field derivation
  if (!out.practice) {
    // arkive root files
    if (
      path === `${V2_ROOT}/identity.md` ||
      path === `${V2_ROOT}/arkive.protocol.md`
    ) {
      out.practice = "core";
    } else {
      const m = path.match(/^arkive\/practices\/([^/]+)/);
      if (m) out.practice = m[1];
    }
  }

  // Strip deprecated legacy fields
  delete out.flagged;
  delete out.protocol_version;
  delete out.auto_seeded;
  delete out.instructions_version;
  delete out.library;
  delete out.title; // titles live in the markdown body, not frontmatter

  return out;
}

function isSame(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
  for (const k of ka) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}
