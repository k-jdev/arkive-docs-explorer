// Filesystem-backed storage adapter.
// Used for local dev — wraps the current .arkive/* layout behind the StorageAdapter interface.
// Per-user namespacing is supported (userId becomes a subdirectory) but for the local case
// everything lives under the default "_local" namespace.
//
// Contract (matches the Postgres adapter): `entry.body` is the FULL serialized
// entry text — callers build it with arkive-v2/frontmatter `serializeEntry`
// (one `---` frontmatter block + body), or, for the pure-data root files
// (arkive.config / arkive.index), the raw YAML/JSON with no frontmatter. The
// adapter persists that body VERBATIM. It does NOT add its own frontmatter and
// does NOT add a redundant extension. `meta` is a convenience parse of the body.

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  StorageAdapter,
  StoredEntry,
  StoredEntryMeta,
  UserId,
  EncryptedKeystore,
} from "@/lib/storage/types";
import { parseFrontmatter } from "@/lib/arkive-v2/frontmatter";

function userRoot(userId: UserId): string {
  // For the default local user, keep the historical paths so we don't have to migrate
  // anything yet. Other userIds get their own subdirectory.
  if (userId === "_local") return path.join(process.cwd(), ".arkive");
  return path.join(process.cwd(), ".arkive", "users", sanitize(userId));
}

function arkivesRoot(userId: UserId): string {
  return path.join(userRoot(userId), "arkives");
}

function keystorePath(userId: UserId): string {
  // For the local user we honour the legacy ARKIVE_KEYSTORE_PATH env if set
  if (userId === "_local" && process.env.ARKIVE_KEYSTORE_PATH) return process.env.ARKIVE_KEYSTORE_PATH;
  return path.join(userRoot(userId), "keystore.json");
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 64);
}

function clean(entryPath: string): string {
  return entryPath.replace(/^\/+|\/+$/g, "");
}

// Canonical on-disk path: the entry path plus a SINGLE ".md" — a path that
// already carries ".md" is used as-is (no second extension). This is the one
// place a logical entry path maps to a file.
function fsPathFor(userId: UserId, entryPath: string): string {
  const c = clean(entryPath);
  const file = c.endsWith(".md") ? c : `${c}.md`;
  return path.join(arkivesRoot(userId), file);
}

// Legacy on-disk path from the previous scheme, which appended ".md"
// unconditionally (so ".md" entries were stored as "<name>.md.md"). Used only as
// a READ/DELETE fallback so arkives written before this fix stay usable WITHOUT
// a migration. Differs from fsPathFor only for paths already ending in ".md".
function legacyFsPathFor(userId: UserId, entryPath: string): string {
  return path.join(arkivesRoot(userId), `${clean(entryPath)}.md`);
}

// Captures the body after the first frontmatter block.
const FM_REST = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/;

// Old files were written with the adapter's own frontmatter block PREPENDED on
// top of the caller's already-serialized block — two stacked blocks. When a
// second frontmatter block immediately follows the first, the first is the
// legacy adapter block; drop it and keep the canonical one. New (single-block)
// files and pure-data files pass through unchanged.
function collapseLegacyFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const m = raw.match(FM_REST);
  if (!m) return raw;
  const rest = m[1];
  return rest.startsWith("---") ? rest : raw;
}

// Inverse of fsPathFor/legacyFsPathFor: map an on-disk relative filename back to
// its logical entry path. Markdown entries keep ".md"; the pure-data root files
// (".config"/".index"), stored with an added ".md", drop it; legacy doubled
// "<name>.md.md" files map back to the "<name>.md" logical path.
function logicalFromFile(rel: string): string {
  if (rel.endsWith(".md.md")) return rel.slice(0, -3); // legacy doubled → drop one ".md"
  const candidate = rel.slice(0, -3); // drop the single ".md"
  return candidate.endsWith(".config") || candidate.endsWith(".index") ? candidate : rel;
}

// ============================================================================
// Adapter implementation
// ============================================================================

export class FilesystemStorageAdapter implements StorageAdapter {
  async readEntry(userId: UserId, entryPath: string): Promise<StoredEntry | null> {
    const c = clean(entryPath);
    const canonical = fsPathFor(userId, c);
    const legacy = legacyFsPathFor(userId, c);
    let raw: string | null = null;
    try {
      raw = await fs.readFile(canonical, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      if (legacy !== canonical) {
        try {
          raw = await fs.readFile(legacy, "utf8"); // backward-compat: old ".md.md" file
        } catch (e2) {
          if ((e2 as NodeJS.ErrnoException).code !== "ENOENT") throw e2;
        }
      }
    }
    if (raw === null) return null;
    const body = collapseLegacyFrontmatter(raw);
    const { meta } = parseFrontmatter(body);
    return { path: c, meta, body };
  }

  async readEntries(userId: UserId, paths: string[]): Promise<StoredEntry[]> {
    // Local disk — parallel single reads are already cheap (no network RTT).
    const results = await Promise.all(paths.map((p) => this.readEntry(userId, p)));
    return results.filter((e): e is StoredEntry => e !== null);
  }

  async listEntries(userId: UserId, pathPrefix: string): Promise<StoredEntry[]> {
    const cleaned = clean(pathPrefix);
    const baseDir = path.join(arkivesRoot(userId), cleaned);
    const out: StoredEntry[] = [];
    const seen = new Set<string>();

    const walk = async (dir: string, relParts: string[]): Promise<void> => {
      let items: import("node:fs").Dirent[];
      try {
        items = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of items) {
        if (it.name.startsWith(".")) continue; // skip .DS_Store and friends
        const full = path.join(dir, it.name);
        if (it.isDirectory()) {
          await walk(full, [...relParts, it.name]);
        } else if (it.name.endsWith(".md")) {
          const rel = [cleaned, ...relParts, it.name].filter(Boolean).join("/");
          const logical = logicalFromFile(rel);
          if (seen.has(logical)) continue; // de-dupe a canonical+legacy pair for the same entry
          seen.add(logical);
          const entry = await this.readEntry(userId, logical);
          if (entry) out.push(entry);
        }
      }
    };
    await walk(baseDir, []);
    return out;
  }

  async listMeta(userId: UserId, pathPrefix: string): Promise<StoredEntryMeta[]> {
    // The filesystem keeps metadata only inside each file's frontmatter, so we
    // still read the files here — but we return path + meta only, so callers
    // don't retain or re-parse bodies. (A sidecar catalog, Phase 2, removes the
    // per-file read entirely; the hosted Postgres backend already does via its
    // separate `meta` column.)
    const entries = await this.listEntries(userId, pathPrefix);
    return entries.map((e) => ({ path: e.path, meta: e.meta }));
  }

  async writeEntry(userId: UserId, entry: StoredEntry): Promise<void> {
    const c = clean(entry.path);
    const canonical = fsPathFor(userId, c);
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    // Body is already the full serialized entry (callers use frontmatter.serializeEntry,
    // or raw YAML/JSON for config/index). Persist VERBATIM — no second frontmatter block.
    const content = entry.body.trimEnd() + "\n";
    await fs.writeFile(canonical, content, { mode: 0o600 });
    // Lazy migration: remove a stale legacy "<name>.md.md" so rewrites of an
    // entry that predates this fix don't leave a duplicate alongside the clean file.
    const legacy = legacyFsPathFor(userId, c);
    if (legacy !== canonical) {
      try {
        await fs.unlink(legacy);
      } catch {
        /* no legacy file — fine */
      }
    }
  }

  async deleteEntry(userId: UserId, entryPath: string): Promise<boolean> {
    const c = clean(entryPath);
    const canonical = fsPathFor(userId, c);
    const legacy = legacyFsPathFor(userId, c);
    let removed = false;
    for (const fp of legacy !== canonical ? [canonical, legacy] : [canonical]) {
      try {
        await fs.unlink(fp);
        removed = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return removed;
  }

  async readKeystore(userId: UserId): Promise<EncryptedKeystore | null> {
    const p = keystorePath(userId);
    try {
      const raw = await fs.readFile(p, "utf8");
      return JSON.parse(raw) as EncryptedKeystore;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async writeKeystore(userId: UserId, keystore: EncryptedKeystore): Promise<void> {
    const p = keystorePath(userId);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(keystore, null, 2), { mode: 0o600 });
  }
}
