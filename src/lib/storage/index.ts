// The single import point for persistence. Every module that needs to read or write
// state goes through `storage()` — never directly to fs or to a Postgres client.
//
// Backend selection:
//   - Default: filesystem (local dev)
//   - When STORAGE_BACKEND=postgres + DATABASE_URL set: Postgres adapter (Stage 3+)

import type { StorageAdapter, UserId } from "@/lib/storage/types";
import { FilesystemStorageAdapter } from "@/lib/storage/filesystem";
import { PostgresStorageAdapter } from "@/lib/storage/postgres";

let _instance: StorageAdapter | null = null;

export function storage(): StorageAdapter {
  if (_instance) return _instance;
  const backend = (process.env.STORAGE_BACKEND ?? "filesystem").toLowerCase();
  switch (backend) {
    case "filesystem":
      _instance = new FilesystemStorageAdapter();
      break;
    case "postgres":
      _instance = new PostgresStorageAdapter();
      break;
    default:
      throw new Error(`Unknown STORAGE_BACKEND: ${backend}`);
  }
  return _instance;
}

// Re-export types so call sites don't need to know the file layout
export type { StorageAdapter, StoredEntry, StoredEntryMeta, UserId, EncryptedKeystore } from "@/lib/storage/types";
export { LOCAL_USER_ID } from "@/lib/storage/types";

/**
 * Resolve the current user id for the calling request.
 *
 * Behavior:
 *   - In a Server Component / Route Handler with a Supabase session: returns the user's
 *     Supabase auth uuid.
 *   - In local dev with STORAGE_BACKEND=filesystem AND no Supabase session: returns
 *     LOCAL_USER_ID ("_local") so the existing single-user dev experience keeps working.
 *   - On Vercel with STORAGE_BACKEND=postgres AND no session: throws. This forces every
 *     route to be gated by auth before touching data.
 */
export async function currentUserId(): Promise<UserId> {
  // 1. MCP request context — wins because the MCP route binds the user_id from
  //    the bearer token, and there's no cookie to read in that path.
  try {
    const { currentRequestUserId } = await import("@/lib/request-context");
    const fromCtx = currentRequestUserId();
    if (fromCtx) return fromCtx;
  } catch {
    // Module load failure — fall through.
  }

  // 2. Browser session cookie. Dynamic import — `next/headers` (used by getSession)
  //    is only valid in a request scope. Background scripts fall through.
  try {
    const { getSession } = await import("@/lib/session");
    const session = await getSession();
    if (session?.userId) return session.userId;
  } catch {
    // No request context (e.g. background compaction) — fall through.
  }

  const backend = (process.env.STORAGE_BACKEND ?? "filesystem").toLowerCase();
  if (backend === "filesystem") return "_local";

  throw new Error(
    "No authenticated session. Sign in first — every request to postgres-backed storage requires auth."
  );
}
