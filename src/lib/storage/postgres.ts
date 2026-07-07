// Postgres-backed storage adapter (Supabase).
// Implements the same StorageAdapter interface as the filesystem adapter — call sites
// are unchanged. Selected via STORAGE_BACKEND=postgres.

import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import type {
  StorageAdapter,
  StoredEntry,
  StoredEntryMeta,
  UserId,
  EncryptedKeystore,
} from "@/lib/storage/types";

let _sql: ReturnType<typeof postgres> | null = null;
let _schemaPromise: Promise<void> | null = null;

function client(): ReturnType<typeof postgres> {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("STORAGE_BACKEND=postgres but DATABASE_URL is not set in env.");
  }
  // ssl: 'require' is needed for Supabase.
  // prepare: false is required for the Supavisor pooler in transaction mode.
  // Use the POOLER URL (aws-0-<region>.pooler.supabase.com:6543) for Vercel serverless —
  // direct db.<ref>.supabase.co is IPv6-only and Vercel can't reach it.
  _sql = postgres(url, {
    ssl: "require",
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
  return _sql;
}

/**
 * Idempotent schema bootstrap. Cached as a Promise (not a boolean!) so that
 * N parallel callers all await the SAME DDL execution instead of racing each
 * other into a deadlock. The DDL includes CREATE TRIGGER statements which
 * take ACCESS EXCLUSIVE locks; concurrent runs of those produce the
 * "deadlock detected" error users saw on the v2 bundle endpoint, which fires
 * 12 parallel queries on a cold lambda.
 */
async function ensureSchema(): Promise<void> {
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = (async () => {
    try {
      const sql = client();
      const schemaPath = path.join(process.cwd(), "db", "schema.sql");
      const ddl = readFileSync(schemaPath, "utf8");
      await sql.unsafe(ddl);
    } catch (e) {
      // Reset on failure so the next request can retry instead of being stuck
      // with a poisoned Promise forever.
      _schemaPromise = null;
      throw e;
    }
  })();
  return _schemaPromise;
}

export class PostgresStorageAdapter implements StorageAdapter {
  async readEntry(userId: UserId, entryPath: string): Promise<StoredEntry | null> {
    await ensureSchema();
    const sql = client();
    const rows = await sql<Array<{ path: string; meta: Record<string, unknown>; body: string }>>`
      SELECT path, meta, body
      FROM arkive_entries
      WHERE user_id = ${userId} AND path = ${entryPath}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return { path: rows[0].path, meta: rows[0].meta, body: rows[0].body };
  }

  async readEntries(userId: UserId, paths: string[]): Promise<StoredEntry[]> {
    if (paths.length === 0) return [];
    await ensureSchema();
    const sql = client();
    const rows = await sql<Array<{ path: string; meta: Record<string, unknown>; body: string }>>`
      SELECT path, meta, body
      FROM arkive_entries
      WHERE user_id = ${userId} AND path = ANY(${paths}::text[])
    `;
    return rows.map((r) => ({ path: r.path, meta: r.meta, body: r.body }));
  }

  async listEntries(userId: UserId, pathPrefix: string): Promise<StoredEntry[]> {
    await ensureSchema();
    const sql = client();

    // Empty/root prefix = return every entry the user owns. Without this branch
    // the arkive='' filter below matches zero rows (since `arkive` is always
    // the first path segment, never empty), which silently broke export, reset,
    // and the v1→v2 migration enumeration.
    if (pathPrefix === "" || pathPrefix === "/") {
      const all = await sql<Array<{ path: string; meta: Record<string, unknown>; body: string }>>`
        SELECT path, meta, body
        FROM arkive_entries
        WHERE user_id = ${userId}
        ORDER BY path
      `;
      return all.map((r) => ({ path: r.path, meta: r.meta, body: r.body }));
    }

    const arkive = pathPrefix.split("/")[0];
    const prefixLike = pathPrefix.endsWith("/") ? `${pathPrefix}%` : `${pathPrefix}%`;
    // Match either the exact prefix as a complete entry or any descendant path.
    const rows = await sql<Array<{ path: string; meta: Record<string, unknown>; body: string }>>`
      SELECT path, meta, body
      FROM arkive_entries
      WHERE user_id = ${userId}
        AND arkive = ${arkive}
        AND (path = ${pathPrefix} OR path LIKE ${prefixLike})
      ORDER BY path
    `;
    return rows.map((r) => ({ path: r.path, meta: r.meta, body: r.body }));
  }

  async listMeta(userId: UserId, pathPrefix: string): Promise<StoredEntryMeta[]> {
    await ensureSchema();
    const sql = client();

    // `meta` is its own JSONB column, so this never reads/transfers the (much
    // larger) body text — an index-only-style read of the system catalog.
    if (pathPrefix === "" || pathPrefix === "/") {
      const all = await sql<Array<{ path: string; meta: Record<string, unknown> }>>`
        SELECT path, meta
        FROM arkive_entries
        WHERE user_id = ${userId}
        ORDER BY path
      `;
      return all.map((r) => ({ path: r.path, meta: r.meta }));
    }

    const arkive = pathPrefix.split("/")[0];
    const prefixLike = `${pathPrefix}%`;
    const rows = await sql<Array<{ path: string; meta: Record<string, unknown> }>>`
      SELECT path, meta
      FROM arkive_entries
      WHERE user_id = ${userId}
        AND arkive = ${arkive}
        AND (path = ${pathPrefix} OR path LIKE ${prefixLike})
      ORDER BY path
    `;
    return rows.map((r) => ({ path: r.path, meta: r.meta }));
  }

  async writeEntry(userId: UserId, entry: StoredEntry): Promise<void> {
    await ensureSchema();
    const sql = client();
    const arkive = entry.path.split("/")[0];
    await sql`
      INSERT INTO arkive_entries (user_id, path, arkive, meta, body)
      VALUES (${userId}, ${entry.path}, ${arkive}, ${sql.json(entry.meta as never)}, ${entry.body})
      ON CONFLICT (user_id, path)
      DO UPDATE SET meta = EXCLUDED.meta, body = EXCLUDED.body
    `;
  }

  async deleteEntry(userId: UserId, entryPath: string): Promise<boolean> {
    await ensureSchema();
    const sql = client();
    const result = await sql`
      DELETE FROM arkive_entries
      WHERE user_id = ${userId} AND path = ${entryPath}
    `;
    return result.count > 0;
  }

  async readKeystore(userId: UserId): Promise<EncryptedKeystore | null> {
    await ensureSchema();
    const sql = client();
    const rows = await sql<Array<{ version: number; wallets: unknown[] }>>`
      SELECT version, wallets FROM keystores WHERE user_id = ${userId} LIMIT 1
    `;
    if (rows.length === 0) return null;
    return { version: rows[0].version, wallets: rows[0].wallets as EncryptedKeystore["wallets"] };
  }

  async writeKeystore(userId: UserId, keystore: EncryptedKeystore): Promise<void> {
    await ensureSchema();
    const sql = client();
    await sql`
      INSERT INTO keystores (user_id, version, wallets)
      VALUES (${userId}, ${keystore.version}, ${sql.json(keystore.wallets as never)})
      ON CONFLICT (user_id)
      DO UPDATE SET version = EXCLUDED.version, wallets = EXCLUDED.wallets
    `;
  }
}
