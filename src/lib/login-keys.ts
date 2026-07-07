// Login keys — an alternate browser-login credential for an existing account.
//
// Flow: a user signs in with their wallet (which creates the account), then
// mints a login key here. Afterward they can sign in with EITHER the wallet
// OR the key string. A login key is bearer-equivalent to a password, so we
// store only an HMAC of it — the plaintext is shown ONCE at creation and is
// thereafter unrecoverable (mint a new one if lost).
//
// Postgres-direct, same pattern as session.ts / mcp-tokens.ts. The table is
// ensured lazily so the login path works even before the storage adapter's
// ensureSchema has run on a cold instance.

import crypto from "node:crypto";
import postgres from "postgres";

const KEY_PREFIX = "arklogin_";

let _sql: ReturnType<typeof postgres> | null = null;
function sql() {
  if (_sql) return _sql;
  _sql = postgres(process.env.DATABASE_URL!, {
    ssl: "require",
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
  return _sql;
}

let _ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    await sql()`
      CREATE TABLE IF NOT EXISTS login_keys (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key_hash     text        NOT NULL,
        key_prefix   text        NOT NULL,
        label        text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz
      )
    `;
    await sql()`CREATE INDEX IF NOT EXISTS idx_login_keys_user ON login_keys (user_id)`;
    await sql()`CREATE UNIQUE INDEX IF NOT EXISTS idx_login_keys_hash ON login_keys (key_hash)`;
  })().catch((e) => {
    _ensured = null; // allow retry on transient failure
    throw e;
  });
  return _ensured;
}

/** Secret used to HMAC the login key. Same source as the SIWE nonce secret. */
function hmacSecret(): string {
  const s = process.env.SESSION_SECRET ?? process.env.SUPABASE_SERVICE_KEY;
  if (!s) throw new Error("SESSION_SECRET (or SUPABASE_SERVICE_KEY) must be set to use login keys.");
  return s;
}

function hashKey(key: string): string {
  return crypto.createHmac("sha256", hmacSecret()).update(key).digest("hex");
}

export type LoginKeyRow = {
  id: string;
  keyPrefix: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

/**
 * Mint a login key for a user. Returns the FULL key string ONCE — it is not
 * recoverable afterward (only its HMAC is stored).
 */
export async function createLoginKey(args: {
  userId: string;
  label?: string | null;
}): Promise<{ key: string; id: string }> {
  await ensureTable();
  // 32 bytes of entropy, base64url. Prefixed for grep-ability + UI display.
  const key = KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, KEY_PREFIX.length + 6); // "arklogin_" + 6 chars
  const rows = await sql()<Array<{ id: string }>>`
    INSERT INTO login_keys (user_id, key_hash, key_prefix, label)
    VALUES (${args.userId}, ${keyHash}, ${keyPrefix}, ${args.label ?? null})
    RETURNING id
  `;
  return { key, id: rows[0].id };
}

/**
 * Verify a presented login key → resolve the owning user_id. Bumps last_used.
 * Constant-time at the DB layer (lookup by HMAC, not by comparing plaintext).
 * Returns null if the key is malformed or unknown.
 */
export async function verifyLoginKey(key: string): Promise<{ userId: string } | null> {
  if (!key || !key.startsWith(KEY_PREFIX)) return null;
  await ensureTable();
  const keyHash = hashKey(key);
  const rows = await sql()<Array<{ user_id: string }>>`
    UPDATE login_keys
    SET last_used_at = now()
    WHERE key_hash = ${keyHash}
    RETURNING user_id
  `;
  if (rows.length === 0) return null;
  return { userId: rows[0].user_id };
}

/** List a user's login keys for the management UI (masked — no secret). */
export async function listLoginKeys(userId: string): Promise<LoginKeyRow[]> {
  await ensureTable();
  const rows = await sql()<
    Array<{
      id: string;
      key_prefix: string;
      label: string | null;
      created_at: Date;
      last_used_at: Date | null;
    }>
  >`
    SELECT id, key_prefix, label, created_at, last_used_at
    FROM login_keys
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    keyPrefix: r.key_prefix,
    label: r.label,
    createdAt: new Date(r.created_at),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : null,
  }));
}

/** Revoke a login key. Scoped by user_id so a user can't revoke another's. */
export async function revokeLoginKey(args: { userId: string; id: string }): Promise<boolean> {
  await ensureTable();
  const result = await sql()`
    DELETE FROM login_keys
    WHERE id = ${args.id} AND user_id = ${args.userId}
  `;
  return result.count > 0;
}
