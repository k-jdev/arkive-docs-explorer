// Dev helper — mints a session row for the most recent user and prints the
// cookie value, so a local preview browser can be signed in without a wallet.
// Usage: node scripts/dev-session.mjs
import postgres from "postgres";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!url) throw new Error("DATABASE_URL not found in .env.local");

const sql = postgres(url, { ssl: "require", max: 1, prepare: false });

const users = await sql`SELECT id, wallet_address FROM users ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`;
if (users.length === 0) throw new Error("No users in DB");

const id = crypto.randomBytes(32).toString("base64url");
const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${id}, ${users[0].id}, ${expires})`;
console.log(JSON.stringify({ cookie: id, wallet: users[0].wallet_address }));
await sql.end();
