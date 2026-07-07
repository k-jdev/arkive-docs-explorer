// OAuth 2.0 + PKCE for the MCP endpoint.
//
// claude.ai's Custom Connector UI doesn't allow arbitrary headers — only
// OAuth fields — so we implement the MCP Authorization spec: dynamic client
// registration (RFC 7591) + authorization code flow with PKCE (RFC 7636).
//
// Flow:
//   1. Client GET /api/mcp without a token → 401 with
//      WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"
//   2. Client fetches the metadata, discovers the auth server, fetches its
//      metadata (RFC 8414).
//   3. Client POSTs to /api/oauth/register, receives a generated client_id.
//   4. Client opens /api/oauth/authorize?response_type=code&client_id=…&
//      redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…
//      in the user's browser.
//   5. Our authorize handler requires the user to be signed in (SIWE session),
//      auto-grants on first hit, generates an auth code, redirects to
//      redirect_uri with ?code=…&state=…
//   6. Client POSTs to /api/oauth/token with grant_type=authorization_code,
//      code, code_verifier, client_id, redirect_uri. We verify PKCE, mint an
//      access token (+ refresh token), store it, return it.
//   7. Subsequent MCP requests carry Authorization: Bearer <access_token>.
//      /api/mcp resolves it via oauth_tokens → user_id.

import crypto from "node:crypto";
import postgres from "postgres";

const ACCESS_TOKEN_TTL_DAYS = 30;
const CODE_TTL_MS = 10 * 60 * 1000;

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

// ============================================================================
// Token / code generation
// ============================================================================

function genId(prefix: string, bytes = 16): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString("hex")}`;
}

export const newClientId = () => genId("arkc", 12);
export const newAuthCode = () => genId("arko", 24);
export const newAccessToken = () => genId("arka", 24);
export const newRefreshToken = () => genId("arkr", 24);

// ============================================================================
// Clients (dynamic registration)
// ============================================================================

export type OauthClient = {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  createdAt: Date;
};

export async function registerClient(args: {
  clientName?: string | null;
  redirectUris: string[];
}): Promise<OauthClient> {
  if (!args.redirectUris.length) throw new Error("redirect_uris is required");
  for (const uri of args.redirectUris) {
    try {
      new URL(uri);
    } catch {
      throw new Error(`Invalid redirect_uri: ${uri}`);
    }
  }
  const clientId = newClientId();
  await sql()`
    INSERT INTO oauth_clients (client_id, client_name, redirect_uris)
    VALUES (${clientId}, ${args.clientName ?? null}, ${JSON.stringify(args.redirectUris)}::jsonb)
  `;
  return {
    clientId,
    clientName: args.clientName ?? null,
    redirectUris: args.redirectUris,
    createdAt: new Date(),
  };
}

export async function getClient(clientId: string): Promise<OauthClient | null> {
  const rows = await sql()<
    Array<{ client_id: string; client_name: string | null; redirect_uris: string[]; created_at: Date }>
  >`
    SELECT client_id, client_name, redirect_uris, created_at
    FROM oauth_clients WHERE client_id = ${clientId}
  `;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    clientId: r.client_id,
    clientName: r.client_name,
    redirectUris: r.redirect_uris,
    createdAt: new Date(r.created_at),
  };
}

// ============================================================================
// Authorization codes
// ============================================================================

export async function issueAuthCode(args: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string | null;
}): Promise<string> {
  const code = newAuthCode();
  const expires = new Date(Date.now() + CODE_TTL_MS);
  await sql()`
    INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, scope, expires_at)
    VALUES (${code}, ${args.clientId}, ${args.userId}, ${args.redirectUri},
            ${args.codeChallenge}, ${args.scope ?? null}, ${expires})
  `;
  return code;
}

export type ResolvedAuthCode = {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string | null;
  expiresAt: Date;
};

export async function consumeAuthCode(code: string): Promise<ResolvedAuthCode | null> {
  // Single-use: DELETE … RETURNING so a code can't be exchanged twice.
  const rows = await sql()<
    Array<{
      client_id: string;
      user_id: string;
      redirect_uri: string;
      code_challenge: string;
      scope: string | null;
      expires_at: Date;
    }>
  >`
    DELETE FROM oauth_codes WHERE code = ${code}
    RETURNING client_id, user_id, redirect_uri, code_challenge, scope, expires_at
  `;
  if (!rows.length) return null;
  const r = rows[0];
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  return {
    clientId: r.client_id,
    userId: r.user_id,
    redirectUri: r.redirect_uri,
    codeChallenge: r.code_challenge,
    scope: r.scope,
    expiresAt: new Date(r.expires_at),
  };
}

// ============================================================================
// Access tokens
// ============================================================================

export type IssuedTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export async function issueAccessToken(args: {
  clientId: string;
  userId: string;
  scope?: string | null;
}): Promise<IssuedTokenSet> {
  const access = newAccessToken();
  const refresh = newRefreshToken();
  const ttl = ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60;
  const expires = new Date(Date.now() + ttl * 1000);
  await sql()`
    INSERT INTO oauth_tokens (token, client_id, user_id, scope, expires_at, refresh_token)
    VALUES (${access}, ${args.clientId}, ${args.userId}, ${args.scope ?? null}, ${expires}, ${refresh})
  `;
  return { accessToken: access, refreshToken: refresh, expiresIn: ttl };
}

export async function resolveAccessToken(token: string): Promise<{ userId: string } | null> {
  if (!token) return null;
  // Bumps last_used_at as a side effect of the lookup so we can spot stale tokens later.
  const rows = await sql()<Array<{ user_id: string; expires_at: Date }>>`
    UPDATE oauth_tokens
    SET last_used_at = now()
    WHERE token = ${token}
    RETURNING user_id, expires_at
  `;
  if (!rows.length) return null;
  if (new Date(rows[0].expires_at).getTime() < Date.now()) {
    // Best-effort cleanup
    await sql()`DELETE FROM oauth_tokens WHERE token = ${token}`.catch(() => {});
    return null;
  }
  return { userId: rows[0].user_id };
}

export async function rotateRefreshToken(args: {
  refreshToken: string;
  clientId: string;
}): Promise<IssuedTokenSet | null> {
  // Single-use refresh: delete the row, mint a fresh pair.
  const rows = await sql()<Array<{ user_id: string; scope: string | null }>>`
    DELETE FROM oauth_tokens
    WHERE refresh_token = ${args.refreshToken} AND client_id = ${args.clientId}
    RETURNING user_id, scope
  `;
  if (!rows.length) return null;
  return issueAccessToken({ clientId: args.clientId, userId: rows[0].user_id, scope: rows[0].scope });
}

// ============================================================================
// PKCE
// ============================================================================

/**
 * Verify that base64url(sha256(code_verifier)) === code_challenge per RFC 7636 §4.6.
 * Only supports method=S256 (we advertise that as the only supported method).
 */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier) return false;
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  const computed = hash.toString("base64url");
  // Constant-time compare
  if (computed.length !== codeChallenge.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(codeChallenge));
  } catch {
    return false;
  }
}
