-- Arkive Postgres schema.
-- Used when STORAGE_BACKEND=postgres. Auto-created on first connection by the adapter.
-- All tables are user-scoped via `user_id text`. Until Supabase Auth is wired in (Stage 4),
-- user_id is just the constant "_local". After auth, user_id matches auth.users.id (uuid as text).

CREATE TABLE IF NOT EXISTS arkive_entries (
  user_id     text        NOT NULL,
  path        text        NOT NULL,
  arkive      text        NOT NULL,         -- the first segment of `path` (evidence, journal, ...)
  meta        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  body        text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path)
);

-- Fast prefix queries: path LIKE 'evidence/trades/%'
CREATE INDEX IF NOT EXISTS idx_arkive_entries_prefix
  ON arkive_entries (user_id, path text_pattern_ops);

-- Fast filtering by arkive type
CREATE INDEX IF NOT EXISTS idx_arkive_entries_arkive
  ON arkive_entries (user_id, arkive);

-- Querying by metadata fields (e.g. linked_token, severity)
CREATE INDEX IF NOT EXISTS idx_arkive_entries_meta
  ON arkive_entries USING gin (meta);

-- Keystore: one row per user. Wallets array stores AES-GCM-encrypted private keys.
-- Note: this exists for backward compat with the custodial model. Once WalletConnect lands
-- (Stage 5) the hosted product will not write to this table — non-custodial only.
CREATE TABLE IF NOT EXISTS keystores (
  user_id    text        PRIMARY KEY,
  version    int         NOT NULL DEFAULT 1,
  wallets    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- Auth: users + sessions (SIWE sign-in, no Supabase Auth)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  text        UNIQUE NOT NULL,  -- always lowercased 0x… checksumless
  display_name    text,                          -- ENS or user-set, optional
  avatar_url      text,                          -- ENS avatar or set later
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id           text        PRIMARY KEY,        -- random url-safe token (256 bits)
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text,
  ip           text
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- Per-user MCP bearer tokens. Each user mints one or more tokens to point Claude
-- Code or Claude Desktop at their own data slice. Token format: arkv_<32 hex>.
-- (For Claude.ai web, use OAuth tables below — its UI only supports OAuth 2.0.)
CREATE TABLE IF NOT EXISTS mcp_tokens (
  token        text        PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        text,                           -- e.g. "laptop", "phone"
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens (user_id);

-- ============================================================================
-- OAuth 2.0 for the MCP endpoint — claude.ai's Custom Connector UI only
-- accepts OAuth, no arbitrary header. We implement Dynamic Client Registration
-- (RFC 7591) + Authorization Code Flow with PKCE per the MCP Authorization spec.
-- ============================================================================

-- Dynamically-registered OAuth clients. Each Claude.ai install (or other MCP
-- client) registers itself here when first added; we don't pre-provision.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     text        PRIMARY KEY,        -- generated: arkc_<24 hex>
  client_name   text,                            -- self-reported by the client
  redirect_uris jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Short-lived authorization codes (~10 min). Stores the PKCE challenge so we
-- can verify the matching code_verifier at the token exchange.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code            text        PRIMARY KEY,      -- generated: arko_<32 hex>
  client_id       text        NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri    text        NOT NULL,
  code_challenge  text        NOT NULL,
  scope           text,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_codes (expires_at);

-- Long-lived access tokens. Bearer-presented on every MCP request and resolved
-- to a user_id via this table.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token         text        PRIMARY KEY,        -- generated: arka_<32 hex>
  client_id     text        NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope         text,
  expires_at    timestamptz NOT NULL,
  refresh_token text        UNIQUE,             -- arkr_<32 hex>, nullable for one-shot tokens
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens (refresh_token);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON oauth_tokens (expires_at);

-- ============================================================================
-- Login keys — an ALTERNATE browser-login credential for an existing account.
-- A user signs in with their wallet first (creating the account), then mints a
-- login key. Afterward they can sign in with EITHER the wallet OR the key.
-- The key is a bearer credential equivalent to a password, so we store only an
-- HMAC of it (never the plaintext) — shown once at creation, then unrecoverable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS login_keys (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash     text        NOT NULL,            -- HMAC-SHA256(key, SESSION_SECRET), hex
  key_prefix   text        NOT NULL,            -- first chars for the UI ("arklogin_a1b2…")
  label        text,                            -- e.g. "phone", "backup"
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_login_keys_user ON login_keys (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_login_keys_hash ON login_keys (key_hash);

-- ============================================================================
-- Model provider API keys — per-user secrets the Daydream loop uses to call a
-- model on the user's behalf. The loop runs autonomously (no user present to
-- type a password), so the key is encrypted at rest with a SERVER secret
-- (AES-256-GCM; key derived from SESSION_SECRET) rather than a user password.
-- One row per (user, provider); is_active marks the provider the loop uses.
-- ============================================================================
CREATE TABLE IF NOT EXISTS model_keys (
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text        NOT NULL,            -- anthropic | openai | openrouter | ...
  key_cipher   text        NOT NULL,            -- base64(salt:iv:ciphertext+tag)
  key_hint     text        NOT NULL DEFAULT '', -- last 4 chars, plaintext, for the UI
  label        text,
  is_active    boolean     NOT NULL DEFAULT false,  -- the one the loop reaches for
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_model_keys_user ON model_keys (user_id);

-- updated_at trigger so we never have to remember to set it in app code
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_arkive_entries_updated_at ON arkive_entries;
CREATE TRIGGER trg_arkive_entries_updated_at
  BEFORE UPDATE ON arkive_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_keystores_updated_at ON keystores;
CREATE TRIGGER trg_keystores_updated_at
  BEFORE UPDATE ON keystores
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_model_keys_updated_at ON model_keys;
CREATE TRIGGER trg_model_keys_updated_at
  BEFORE UPDATE ON model_keys
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
