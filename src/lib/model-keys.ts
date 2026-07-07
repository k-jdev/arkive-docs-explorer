// Model provider API keys — per-user secrets the Daydream loop uses to call a
// model on the user's behalf.
//
// Unlike wallet keys (decrypted only when the user types a password), the
// daydream loop runs with no user present, so model keys are encrypted at rest
// with a SERVER secret (derived from SESSION_SECRET) and are server-readable
// any time. Lower stakes than wallet keys — capped spend, revocable — but we
// still never store them plaintext.
//
// One row per (user, provider). is_active marks the provider the loop reaches
// for. The UI only ever sees a masked hint (last 4 chars), never the secret.

import crypto from "node:crypto";
import postgres from "postgres";

/** Providers we accept keys for. The ones with a working ModelClient (see
 *  src/lib/model/) can be set active for the loop; others are stored for
 *  forward-compat. anthropic / openai / openrouter all have clients today. */
export const MODEL_PROVIDERS = [
  "anthropic",
  "openai",
  "openrouter",
  "google",
  "xai",
  "deepseek",
  "mistral",
] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/** Providers that have a working ModelClient implementation today. */
export const RUNNABLE_PROVIDERS: ModelProvider[] = ["anthropic", "openai", "openrouter"];

export function isModelProvider(s: string): s is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(s);
}

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
      CREATE TABLE IF NOT EXISTS model_keys (
        user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider   text        NOT NULL,
        key_cipher text        NOT NULL,
        key_hint   text        NOT NULL DEFAULT '',
        label      text,
        is_active  boolean     NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, provider)
      )
    `;
    await sql()`CREATE INDEX IF NOT EXISTS idx_model_keys_user ON model_keys (user_id)`;
  })().catch((e) => {
    _ensured = null;
    throw e;
  });
  return _ensured;
}

// ---- AES-256-GCM at rest ----------------------------------------------------

const KDF_ITERS = 200_000;
const SALT_LEN = 16;
const IV_LEN = 12;

function masterSecret(): string {
  const s = process.env.SESSION_SECRET ?? process.env.SUPABASE_SERVICE_KEY;
  if (!s) {
    throw new Error(
      "SESSION_SECRET (or SUPABASE_SERVICE_KEY) must be set to store model keys — it derives the encryption key."
    );
  }
  return s;
}

function encrypt(plaintext: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = crypto.pbkdf2Sync(masterSecret(), salt, KDF_ITERS, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // salt:iv:(ct+tag), all base64, ':' separated
  return [salt.toString("base64"), iv.toString("base64"), Buffer.concat([ct, tag]).toString("base64")].join(":");
}

function decrypt(blob: string): string {
  const [saltB64, ivB64, ctB64] = blob.split(":");
  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const ctTag = Buffer.from(ctB64, "base64");
  const ct = ctTag.subarray(0, ctTag.length - 16);
  const tag = ctTag.subarray(ctTag.length - 16);
  const key = crypto.pbkdf2Sync(masterSecret(), salt, KDF_ITERS, 32, "sha256");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

function hintFor(key: string): string {
  const trimmed = key.trim();
  return trimmed.length <= 4 ? "••••" : `…${trimmed.slice(-4)}`;
}

// ---- Public API -------------------------------------------------------------

export type ModelKeyRow = {
  provider: ModelProvider;
  keyHint: string;
  label: string | null;
  isActive: boolean;
  runnable: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Store (or replace) a user's key for a provider. If makeActive is true (or
 * it's the user's first key), this provider becomes the active one the loop
 * uses — and any other active flag is cleared (only one active at a time).
 */
export async function setModelKey(args: {
  userId: string;
  provider: ModelProvider;
  key: string;
  label?: string | null;
  makeActive?: boolean;
}): Promise<void> {
  await ensureTable();
  const cipher = encrypt(args.key.trim());
  const hint = hintFor(args.key);

  const existing = await sql()<Array<{ provider: string }>>`
    SELECT provider FROM model_keys WHERE user_id = ${args.userId} LIMIT 1
  `;
  const firstKey = existing.length === 0;
  const active = (args.makeActive ?? false) || firstKey;

  if (active) {
    await sql()`UPDATE model_keys SET is_active = false WHERE user_id = ${args.userId}`;
  }
  await sql()`
    INSERT INTO model_keys (user_id, provider, key_cipher, key_hint, label, is_active)
    VALUES (${args.userId}, ${args.provider}, ${cipher}, ${hint}, ${args.label ?? null}, ${active})
    ON CONFLICT (user_id, provider) DO UPDATE
      SET key_cipher = EXCLUDED.key_cipher,
          key_hint   = EXCLUDED.key_hint,
          label      = EXCLUDED.label,
          is_active  = CASE WHEN ${active} THEN true ELSE model_keys.is_active END
  `;
}

/** Mark a provider active (the one the loop uses); clears others. */
export async function setActiveProvider(args: {
  userId: string;
  provider: ModelProvider;
}): Promise<boolean> {
  await ensureTable();
  const found = await sql()<Array<{ provider: string }>>`
    SELECT provider FROM model_keys WHERE user_id = ${args.userId} AND provider = ${args.provider} LIMIT 1
  `;
  if (found.length === 0) return false;
  await sql()`UPDATE model_keys SET is_active = false WHERE user_id = ${args.userId}`;
  await sql()`UPDATE model_keys SET is_active = true WHERE user_id = ${args.userId} AND provider = ${args.provider}`;
  return true;
}

/** The active provider + decrypted key for the loop. Null if the user has
 *  set no model key. */
export async function getActiveModelKey(
  userId: string
): Promise<{ provider: ModelProvider; key: string } | null> {
  await ensureTable();
  const rows = await sql()<Array<{ provider: string; key_cipher: string }>>`
    SELECT provider, key_cipher FROM model_keys
    WHERE user_id = ${userId} AND is_active = true
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const provider = rows[0].provider;
  if (!isModelProvider(provider)) return null;
  return { provider, key: decrypt(rows[0].key_cipher) };
}

/** A specific provider's decrypted key, regardless of active flag. */
export async function getModelKey(userId: string, provider: ModelProvider): Promise<string | null> {
  await ensureTable();
  const rows = await sql()<Array<{ key_cipher: string }>>`
    SELECT key_cipher FROM model_keys WHERE user_id = ${userId} AND provider = ${provider} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return decrypt(rows[0].key_cipher);
}

/** List a user's stored keys for the UI — masked, never the secret. */
export async function listModelKeys(userId: string): Promise<ModelKeyRow[]> {
  await ensureTable();
  const rows = await sql()<
    Array<{
      provider: string;
      key_hint: string;
      label: string | null;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>
  >`
    SELECT provider, key_hint, label, is_active, created_at, updated_at
    FROM model_keys
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `;
  return rows
    .filter((r) => isModelProvider(r.provider))
    .map((r) => ({
      provider: r.provider as ModelProvider,
      keyHint: r.key_hint,
      label: r.label,
      isActive: r.is_active,
      runnable: RUNNABLE_PROVIDERS.includes(r.provider as ModelProvider),
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }));
}

/** Delete a provider's key. If it was the active one, the user has no active
 *  key afterward (loop falls back to env, or errors if none). */
export async function deleteModelKey(args: { userId: string; provider: ModelProvider }): Promise<boolean> {
  await ensureTable();
  const result = await sql()`
    DELETE FROM model_keys WHERE user_id = ${args.userId} AND provider = ${args.provider}
  `;
  return result.count > 0;
}
