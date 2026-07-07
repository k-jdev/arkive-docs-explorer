// Per-user MCP bearer tokens.
//
// Each user mints one or more tokens to point Claude (Code, web, or any other MCP
// client) at their own data slice on the hosted deployment. The token format is
// `arkv_<32 hex>` so it's easy to spot in env vars and grep'able in logs.
//
// Tokens are stored verbatim (not hashed). Rationale: leakage requires server-side
// access (DB read or env), at which point all bets are off; the trade-off favors
// being able to surface the token in the UI for users to re-copy. If we want to
// raise the bar later, switch to storing only HMACs and revoke-on-leak.

import crypto from "node:crypto";
import postgres from "postgres";

const TOKEN_PREFIX = "arkv_";

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

export type McpToken = {
  token: string;
  userId: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

function generateToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(16).toString("hex");
}

/** Create a new token for the given user. Returns the full token string ONCE. */
export async function createMcpToken(args: {
  userId: string;
  label?: string | null;
}): Promise<string> {
  const token = generateToken();
  await sql()`
    INSERT INTO mcp_tokens (token, user_id, label)
    VALUES (${token}, ${args.userId}, ${args.label ?? null})
  `;
  return token;
}

/**
 * Resolve a bearer token to its owning user_id (and bumps last_used_at).
 * Returns null if the token doesn't exist.
 */
export async function resolveMcpToken(token: string): Promise<{ userId: string } | null> {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const rows = await sql()<Array<{ user_id: string }>>`
    UPDATE mcp_tokens
    SET last_used_at = now()
    WHERE token = ${token}
    RETURNING user_id
  `;
  if (rows.length === 0) return null;
  return { userId: rows[0].user_id };
}

/** List a user's tokens for the management UI. */
export async function listMcpTokens(userId: string): Promise<McpToken[]> {
  const rows = await sql()<
    Array<{
      token: string;
      user_id: string;
      label: string | null;
      created_at: Date;
      last_used_at: Date | null;
    }>
  >`
    SELECT token, user_id, label, created_at, last_used_at
    FROM mcp_tokens
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    token: r.token,
    userId: r.user_id,
    label: r.label,
    createdAt: new Date(r.created_at),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : null,
  }));
}

/** Revoke a token. Scoped by user_id so users can't revoke each other's tokens. */
export async function revokeMcpToken(args: { userId: string; token: string }): Promise<boolean> {
  const result = await sql()`
    DELETE FROM mcp_tokens
    WHERE token = ${args.token} AND user_id = ${args.userId}
  `;
  return result.count > 0;
}
