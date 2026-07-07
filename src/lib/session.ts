// Server-side session management.
//
// After SIWE verification, we mint a random session token, persist it in `sessions`
// scoped to a user_id, and set an httpOnly cookie. Subsequent requests read the cookie,
// look up the session, and resolve to the user_id.
//
// No Supabase Auth involvement — pure Postgres-backed sessions, our domain only.

import crypto from "node:crypto";
import { cookies } from "next/headers";
import postgres from "postgres";

const COOKIE_NAME = "arkive_session";
const SESSION_TTL_DAYS = 30;

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

export type Session = {
  id: string;
  userId: string;
  walletAddress: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/** Generate a fresh URL-safe session token. */
function newSessionId(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Lowercase + checksum-strip an address for DB equality. */
export function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

/**
 * Idempotent user lookup-or-create by wallet address.
 * Returns the user's id (uuid).
 */
export async function upsertUserByWallet(args: {
  address: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}): Promise<{ id: string; isNew: boolean }> {
  const addr = normalizeAddress(args.address);
  const s = sql();
  const existing = await s<Array<{ id: string }>>`SELECT id FROM users WHERE wallet_address = ${addr} LIMIT 1`;
  if (existing.length > 0) {
    await s`UPDATE users SET last_seen_at = now() WHERE id = ${existing[0].id}`;
    return { id: existing[0].id, isNew: false };
  }
  const inserted = await s<Array<{ id: string }>>`
    INSERT INTO users (wallet_address, display_name, avatar_url)
    VALUES (${addr}, ${args.displayName ?? null}, ${args.avatarUrl ?? null})
    RETURNING id
  `;
  return { id: inserted[0].id, isNew: true };
}

/**
 * Create a session for the given user and set the cookie on the response.
 */
export async function createSession(args: {
  userId: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<string> {
  const id = newSessionId();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await sql()`
    INSERT INTO sessions (id, user_id, expires_at, user_agent, ip)
    VALUES (${id}, ${args.userId}, ${expires}, ${args.userAgent ?? null}, ${args.ip ?? null})
  `;
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
  return id;
}

/**
 * Resolve the current session from cookies. Returns null if no session or expired.
 * Lazily deletes expired session rows it finds.
 */
export async function getSession(): Promise<Session | null> {
  // DEV BYPASS — remove when .env.local is configured
  if (process.env.NODE_ENV === "development" && !process.env.DATABASE_URL) {
    return { id: "dev", userId: "_local", walletAddress: "0xdev", displayName: "Dev User", avatarUrl: null };
  }
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAME)?.value;
  if (!sessionId) return null;
  return resolveSession(sessionId);
}

/** Variant used from middleware where we have the request cookie store. */
export async function getSessionFromCookies(jar: { get(name: string): { value: string } | undefined }): Promise<Session | null> {
  const c = jar.get(COOKIE_NAME);
  if (!c?.value) return null;
  return resolveSession(c.value);
}

async function resolveSession(sessionId: string): Promise<Session | null> {
  const rows = await sql()<
    Array<{
      session_id: string;
      user_id: string;
      expires_at: Date;
      wallet_address: string;
      display_name: string | null;
      avatar_url: string | null;
    }>
  >`
    SELECT s.id as session_id, s.user_id, s.expires_at,
           u.wallet_address, u.display_name, u.avatar_url
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  if (new Date(r.expires_at).getTime() < Date.now()) {
    // Best-effort cleanup
    await sql()`DELETE FROM sessions WHERE id = ${sessionId}`.catch(() => {});
    return null;
  }
  return {
    id: r.session_id,
    userId: r.user_id,
    walletAddress: r.wallet_address,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
  };
}

/** Sign out: delete the row + clear the cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAME)?.value;
  if (sessionId) {
    await sql()`DELETE FROM sessions WHERE id = ${sessionId}`.catch(() => {});
  }
  cookieStore.set(COOKIE_NAME, "", { path: "/", expires: new Date(0) });
}

// ---------- nonce: signed-cookie-based, no DB round-trip ----------
//
// Browser asks for a nonce → server generates random + HMACs it with a secret →
// returns {nonce, hmac}. Browser includes both in the SIWE message. On verify, we
// recompute HMAC and reject mismatches. Stateless, prevents replay across users.

const NONCE_SECRET = () => {
  const s = process.env.SESSION_SECRET ?? process.env.SUPABASE_SERVICE_KEY;
  if (!s) throw new Error("SESSION_SECRET (or SUPABASE_SERVICE_KEY as fallback) must be set");
  return s;
};

export function makeNonce(): { nonce: string; signature: string } {
  // SIWE requires nonce to match /^[a-zA-Z0-9]{8,}$/. Hex stays in that set;
  // base64url does not (it includes '-' and '_'). 16 hex chars = 64 bits of entropy.
  const nonce = crypto.randomBytes(8).toString("hex");
  const signature = crypto.createHmac("sha256", NONCE_SECRET()).update(nonce).digest("base64url");
  return { nonce, signature };
}

export function verifyNonce(nonce: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", NONCE_SECRET()).update(nonce).digest("base64url");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
