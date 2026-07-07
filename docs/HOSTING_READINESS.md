# Hosting-Readiness — known issues before multi-tenant deploy

What breaks or becomes unsafe when this app moves from local-first/single-user to
a **hosted, multi-tenant** product (multiple users, multiple server instances).
Each finding: location, why it breaks hosted, severity, and fix direction.

**Reflects:** branch `daydream-v1-engine` @ `7f57ee0` · 2026-06-16. Findings
verified by direct read. Companion: `ARCHITECTURE.md`, `DATA_MODEL.md`.

> **One-line summary:** the *data/persistence* layer is genuinely multi-tenant
> (storage adapter + `currentUserId()` scoping). The *wallet-signing + pending-op*
> subsystem is **not** — it lives in process-global, user-blind memory, reachable
> through routes that verify cookie-presence but not ownership. That subsystem is
> the migration blocker; the arkive/Daydream side can host as-is.

---

## Severity legend
- **P0** — cross-tenant data/action exposure or fund risk. Fix before any shared deploy.
- **P1** — breaks under horizontal scaling / multiple instances (correctness).
- **P2** — hardening / smell; not a hard blocker.

---

## P0 — cross-tenant exposure & fund risk

### P0-1 · `POST /api/pending/[id]` approves+signs with no auth/ownership
`src/app/api/pending/[id]/route.ts` (no `getSession`/`currentUserId`; signs via
`getUnlocked(op.walletId)` at `:59, 206–302`). Approves an op by **user-supplied
`id`** and signs using a key from the process-global unlocked map. Hosted, any
authenticated tenant can approve+execute **another tenant's** transaction.
**Fix:** require `getSession()`; verify `op.user_id === currentUserId()`; persist
ops per-user (see P1-1); stop holding keys server-side (P0-3).

### P0-2 · `GET /api/pending` lists every user's ops
`src/app/api/pending/route.ts:4` → `listPending()` returns the whole global map,
unfiltered. Tenant A sees tenant B's queued swaps/transfers (amounts, addresses).
**Fix:** scope the pending store by user; filter by `currentUserId()`.

### P0-3 · Decrypted private keys held in shared process memory
`src/lib/state.ts:296–308` (`globalThis.__arkive.unlocked: Map`), populated by
`src/lib/keystore.ts:222–236` (`unlockAccount`). Every concurrent user's decrypted
signing key sits in one shared heap, looked up by `walletId` with no user check.
**Fix:** go non-custodial — client-side / external signer; the server never holds
key material. The code already anticipates this (`src/lib/storage/types.ts:39–42`).

### P0-4 · Custodial keystore is the trust model
`src/lib/keystore.ts:55–90, 208–209` — server stores every user's AES-256-GCM
private-key blob (PBKDF2-SHA256, 200k iters, **user-supplied password**, no env
master key). One DB/env compromise + weak passwords = offline brute-force of all
tenants' keys. **Fix:** non-custodial signing (same direction as P0-3).

### P0-5 · `user-profile.ts` cache is not keyed by user
`src/lib/user-profile.ts:82–120` — module-global `_cached` (10s TTL), **no userId
key**. On a warm instance, user B can read user A's profile within the window —
including the `confirmation` policy that governs whether financial actions need
approval. **Fix:** key the cache by `currentUserId()`, or drop it.

---

## P1 — breaks under horizontal scaling

### P1-1 · Pending-op queue is in-process, user-blind, non-shared
`src/lib/state.ts:296–308` (`globalThis.__arkive.pending: Map`). An op enqueued
on instance A is invisible to the approval request on instance B (→ ops vanish);
the whole queue is lost on restart. **Fix:** persist pending ops in Postgres with
a `user_id` column; query/scope by `currentUserId()`.

### P1-2 · Unlocked-key map doesn't survive scaling/restart
`src/lib/state.ts:296–308` — "unlock on A → approve on B" fails (`getUnlocked`
returns undefined → "Wallet is locked"); lost on restart. **Fix:** subsumed by
non-custodial signing (P0-3); if interim, a per-user short-TTL secret store — but
holding keys server-side remains the real problem.

---

## P2 — hardening / smells (not blockers)

### P2-1 · Trading routes gate on cookie *presence*, not validity/ownership
`src/middleware.ts:1–4, 33–68` checks the session cookie **exists** (redirects/401
if missing) but does **not** validate it or scope data; `PUBLIC_PATHS` exempts
`/api/{auth,mcp,oauth,storage-import}`. The `wallets/*`, `pending/*`, `dashboard`
handlers then do no `getSession()`/ownership check. Net: not open-to-internet, but
**any authenticated tenant** can act on another's wallets/ops (this is the vector
behind P0-1/P0-2). **Fix:** add `getSession()` + ownership to each trading route.

### P2-2 · MCP tokens stored unhashed
`src/lib/mcp-tokens.ts:8–53` — personal tokens persisted verbatim. A DB read leaks
every user's live MCP credential. **Fix:** store an HMAC/hash at rest, compare on use.

### P2-3 · `auth/claim` bypasses the storage adapter
`src/app/api/auth/claim/route.ts` uses a raw `postgres` client directly (and is
postgres-only). **Fix:** route through the adapter, or document as an intentional
admin/migration path.

### P2-4 · Schema DDL runs on every cold start
`src/lib/storage/postgres.ts:46–62` (`ensureSchema`) + `readFileSync(process.cwd()
/db/schema.sql)` (`:51–52`). Reads a bundled static asset (fine on Vercel if
included) but running `CREATE` DDL per cold start is a deploy smell. **Fix:** real
migrations; ensure `db/schema.sql` ships in the deployment bundle.

---

## What's already correct (don't re-fix)

- **Storage is user-scoped**: every entry/keystore/profile/trade SQL is
  `WHERE user_id =`; `currentUserId()` hard-fails on postgres without auth
  (`src/lib/storage/index.ts:45–72`).
- **No stray filesystem access**: the only `fs`/`process.cwd` outside
  `storage/filesystem.ts` is the static schema read above — no module reads the
  local `.arkive/` directly.
- **MCP request path is per-tenant**: bearer auth + `withMcpUser()` scope
  (`src/app/api/mcp/route.ts:70–139`). (The signing tools it calls still funnel
  through the global `state.ts` maps — that's P0/P1, not the MCP layer itself.)
- **Arkive engine + Daydream**: fully multi-tenant-safe; host as-is.

---

## Suggested fix order
1. **P0-3 / P0-4** — non-custodial signing (removes the keystore + unlocked-map class entirely).
2. **P1-1 / P0-1 / P0-2** — pending ops → Postgres, `user_id`-scoped; gate + ownership-check `pending/[id]`.
3. **P2-1** — `getSession()` + ownership on all `wallets/*`, `pending/*`, `dashboard`.
4. **P0-5, P2-2** — key the profile cache by user; hash MCP tokens at rest.
5. **P2-3, P2-4** — adapter for `auth/claim`; real migrations.
