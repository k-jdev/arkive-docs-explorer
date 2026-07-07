// Storage adapter interface — the boundary between persistence and business logic.
// Today: filesystem-backed (single-user, local).
// Soon: Postgres-backed (multi-user, hosted on Vercel).
//
// Every persistence call in the codebase routes through this interface so we can swap
// backends without touching call sites. Scoped by `userId` from day one — for the local
// filesystem adapter, userId is a constant "_local" namespace.

/** An opaque user identifier. For local dev: "_local". For hosted: Supabase auth.users.id. */
export type UserId = string;

/** A persisted arkive entry. Mirrors the in-app Entry type but without the recursive arkives import. */
export type StoredEntry = {
  /** Path relative to arkive root, e.g. "evidence/trades/0xabc". No .md extension. */
  path: string;
  /** Frontmatter as a typed map. JSON-serializable. */
  meta: Record<string, unknown>;
  /** Markdown body. */
  body: string;
};

/** An entry's path + metadata WITHOUT its body. Returned by `listMeta` so
 *  that counting, grouping, and building path/meta indexes never pay to load
 *  (Postgres) or re-parse (filesystem) body text — the system-catalog pattern:
 *  consult cheap metadata to plan access, fetch a body only when you need it. */
export type StoredEntryMeta = {
  path: string;
  meta: Record<string, unknown>;
};

/** Storage operations every adapter implements. All operations are user-scoped. */
export interface StorageAdapter {
  // ---------- arkive entries ----------

  /** Read one entry by exact path. Returns null if not found. */
  readEntry(userId: UserId, path: string): Promise<StoredEntry | null>;

  /** Read many entries by exact path in ONE round-trip. Missing paths are
   *  omitted (no nulls). Order is not guaranteed — callers match by path.
   *  Used after a listMeta pass to pull bodies for a small, capped slice
   *  without an N+1 round-trip storm. */
  readEntries(userId: UserId, paths: string[]): Promise<StoredEntry[]>;

  /** List entries under a path prefix (recursive). Returns [] if the prefix doesn't exist. */
  listEntries(userId: UserId, pathPrefix: string): Promise<StoredEntry[]>;

  /** List path + metadata (NO bodies) under a path prefix (recursive). Same
   *  selection semantics as listEntries, but never returns body text — used
   *  by counts, tallies, and path/meta indexes so a session-start load doesn't
   *  drag every body into memory. Returns [] if the prefix doesn't exist. */
  listMeta(userId: UserId, pathPrefix: string): Promise<StoredEntryMeta[]>;

  /** Create or overwrite an entry. Atomic. */
  writeEntry(userId: UserId, entry: StoredEntry): Promise<void>;

  /** Delete an entry. Returns true if it existed and was removed, false if it didn't exist. */
  deleteEntry(userId: UserId, path: string): Promise<boolean>;

  // ---------- keystore (wallet keys) ----------
  //
  // Note: this surface exists only for backward-compatibility with the local-dev keystore.
  // Once non-custodial wallets land (Stage 5), the server stops storing keys at all and this
  // becomes obsolete for the hosted product.

  /** Read the encrypted keystore JSON for a user. Returns null if none exists. */
  readKeystore(userId: UserId): Promise<EncryptedKeystore | null>;

  /** Write the encrypted keystore JSON for a user. Overwrites. */
  writeKeystore(userId: UserId, keystore: EncryptedKeystore): Promise<void>;
}

/** Shape of the encrypted keystore — same as today's on-disk format, just typed. */
export type EncryptedKeystore = {
  version: number;
  wallets: Array<{
    id: string;
    address: `0x${string}`;
    label: string;
    createdAt: number;
    purpose?: string;
    tags?: string[];
    cipher: {
      salt: string;
      iv: string;
      ct: string;
    };
  }>;
};

/** Convenience: the local-dev user id. Used until auth lands. */
export const LOCAL_USER_ID: UserId = "_local";
