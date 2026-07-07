# Arkive Architecture — current-state map

A true picture of what exists and runs today: the surfaces, routes, MCP tools,
engine modules, storage, and auth model. Read this with `DATA_MODEL.md` (which
covers data *shapes*); this doc covers *surfaces and control flow*.

**Reflects:** branch `daydream-v1-engine` @ `7f57ee0` · 2026-06-16.
Companion docs: `DATA_MODEL.md`, `DAYDREAM_v1_UI_SCOPE.md`, `HOSTING_READINESS.md`.

---

## 1. The two surfaces (different auth models — important)

The repo is two products sharing storage + MCP:

| Surface | What it is | Auth model |
|---|---|---|
| **Arkive knowledge engine** | The arkive substrate: stream, practices, insights, daydreams, index. | Multi-user. Every `arkive-v2/*` route gates on `getSession()` + scopes by `currentUserId()`. |
| **Local trading layer** | Wallets, pending-op approval queue, PnL dashboard — drives on-chain/Hyperliquid execution. | Single-user/local. `wallets/*`, `pending/*`, `dashboard` routes do **not** call `getSession()`; they run off an in-memory keystore-unlock state. See `HOSTING_READINESS.md`. |

Frameworks: Next.js 15 App Router, TypeScript, SIWE auth + OAuth (for MCP),
storage adapter over filesystem (dev) / Postgres (hosted).

---

## 2. API routes (30)

All `arkive-v2/*` routes: `runtime="nodejs"`, `dynamic="force-dynamic"`,
`getSession()`-gated, `currentUserId()`-scoped.

**Arkive engine** (`src/app/api/arkive-v2/`)
- `bundle` — GET → `readArkive()` session bundle (the workspace's primary feed).
- `entry` — GET `?path=` → one file, validated against `V2_ROOT`.
- `insight` — POST → accept/reject a pending insight (pending→accepted/rejected).
- `identity` / `loadup` / `practice-instructions` — POST → write the respective file.
- `index-graph` — GET → `buildIndex()` link graph.
- `export` — GET → zip of all entries. `reset` — POST → **destructive** wipe + re-seed.
- `daydream/run` — POST → `runDaydreamPass()` + cost summary (the only daydream route).

**Auth / identity**
- `auth/siwe/nonce` (GET, public), `auth/siwe/verify` (POST, mints session).
- `auth/mcp-token` (GET/POST/DELETE, session-gated) — personal MCP tokens.
- `auth/claim` (postgres-only) — reassigns `_local` rows to a real user.
- `auth/sign-out`, `auth/clear-session`.
- `oauth/{register,authorize,token}` + `.well-known/oauth-*` — full OAuth/DCR for MCP clients.

**MCP**
- `api/mcp` — GET/POST/DELETE; bearer-auth (OAuth `arka_…` or personal `arkv_…`),
  runs dispatch inside `withMcpUser(userId, …)` so tools resolve per-tenant.

**Trading layer** (no `getSession()` — see `HOSTING_READINESS.md`)
- `wallets` (GET/POST), `wallets/[id]` (DELETE), `wallets/[id]/unlock` (POST/DELETE).
- `pending` (GET — lists ops), `pending/[id]` (GET/POST — approve+execute).
- `dashboard` (GET — PnL/positions), `hidden-tokens` (GET/POST/DELETE, session-gated).
- `storage-import` (POST, `IMPORT_TOKEN`-gated).

---

## 3. Pages (7)

Under `src/app/(workspace)/` — each a thin server shell rendering a `"use client"`
component that **fetches over HTTP** (no page imports server libs for data):
- `/` → redirect to `/dashboard` · `/dashboard` → `<ArkiveStats/>` · `/arkives` →
  `<ArkiveWorkspace/>` (file explorer) · `/wallets` → `<WalletDashboard/>` ·
  `/pending` → `<PendingList/>` · `/connect` → `<McpTokenManager/>`.
- `/auth/sign-in` → SIWE sign-in.

---

## 4. MCP tools (70)

Registered in `src/lib/mcp-server.ts`. By domain:

| Group | Count | Examples |
|---|---|---|
| Wallets / chains | 6 | `list_wallets`, `add_watch_wallet`, `resolve_ens`, `sync_wallet_from_chain` |
| Balances + prices | 8 | `get_balance`, `get_portfolio`, `get_token_price`, `get_pair_info` |
| Safety | 1 | `analyze_token_safety` |
| Swaps | 6 | `get_quote`, `simulate_swap`, `request_swap`, `get_swap_status` |
| Transfers / approvals | 4 | `request_transfer`, `request_approve_token`, `request_wrap_eth` |
| Limit / TWAP orders | 5 | `request_limit_order`, `request_twap_order`, `list_open_orders` |
| LP / liquidity (v2/v3) | 6 | `request_add_liquidity_v2/v3`, `list_lp_positions_v2/v3` |
| Portfolio / PnL | 8 | `get_positions`, `get_pnl_summary`, `get_realized_pnl`, `set_cost_basis` |
| Hidden tokens | 3 | `hide_token`, `unhide_token`, `list_hidden_tokens` |
| Hyperliquid (`hl_*`) | 10 | `hl_request_order`, `hl_get_state`, `hl_get_fills` |
| **Arkive engine** | 15 | `read_arkive`, `write_entity`, `propose_insight`, `decide_insight`, `scan_emergence`, `capture_observation` (`mcp-server.ts:2751–3306`) |

All have real handlers. Only MVP note: `cancel_limit_order` relies on UniswapX
deadline expiry rather than an on-chain reactor cancel (`mcp-server.ts:2331`).
Execution tools enqueue to the `/pending` human-gated queue, never auto-execute.

---

## 5. Arkive-v2 engine modules (`src/lib/arkive-v2/`)

| Module | Role |
|---|---|
| `stream.ts` | Universal observation stream; `capture()` never fails. |
| `write-entity.ts` | Universal entity writers (§16 validation + §13 index update). |
| `read-bundle.ts` | `readArkive()` session-start loader → `ArkiveBundle`. |
| `arkive-index.ts` | Auto-maintained JSON link graph. |
| `arkive-config.ts` / `schemas.ts` | `arkive.config` + universal types/frontmatter. |
| `practices.ts` / `authored/` | Practice CRUD + the authored-practice registry (today: trading). |
| `emergence.ts` | Zero-token pattern/practice-suggestion scan. |
| `migrate.ts` / `frontmatter.ts` / `paths.ts` / `seeds.ts` | Migration, YAML codec, path constants, core seeds. |
| **`daydream.ts`** | *(engine v1)* the daydream store (hypotheses, `arkive/daydreams/`). |
| **`daydream-loop.ts`** | *(engine v1)* `runDaydreamPass()` — the autonomous loop. |
| **`propose-insight.ts`** | *(engine v1)* the single shared propose path (C5). |

Model client (`src/lib/model/`): `types.ts` (interface), `index.ts`
(`getModelClient` factory + metering boundary), `anthropic.ts` (only file
importing the provider SDK; default `claude-opus-4-8`), `stub.ts`
(`DAYDREAM_MODEL=stub`, zero-cost testing). See `DAYDREAM_v1_ENGINE_SCOPE.md`.

---

## 6. Storage

`storage()` selects backend via `STORAGE_BACKEND` (default `filesystem`)
(`src/lib/storage/index.ts`). **Full parity** — `filesystem.ts` and `postgres.ts`
both implement all 6 `StorageAdapter` methods; no stubs either side.
`currentUserId()` resolves: MCP request-context → session cookie → `_local`
(filesystem) or **throw** (postgres). All entry/keystore SQL is `WHERE user_id =`
scoped. Engine-internal data (metering ledger, trades, profile) lives under
`_internal/*` via `internal-store.ts`.

---

## 7. The Daydream engine — status

Built and wired end-to-end (store → metered model client → loop → shared propose
path → run route), with a by-construction cost ledger and an env-gated stub.
**Reachable only via `POST /api/arkive-v2/daydream/run`** — no UI surface, no
scheduler/cron, and `daydream_frequency` defaults `"off"`, so it never self-fires.
UI build is scoped in `DAYDREAM_v1_UI_SCOPE.md`. Note: daydreams already appear as
**index-graph nodes** but are **absent from the file-explorer tree**.

---

## 8. Quick map: "where does X live?"

- A new MCP tool → `src/lib/mcp-server.ts` (`server.tool(...)`).
- A new arkive write → through `write-entity.ts` (never raw storage).
- A new HTTP route → `src/app/api/...` following the `arkive-v2/*` gated pattern.
- Reading the session bundle → `read-bundle.ts` / `GET /api/arkive-v2/bundle`.
- Anything multi-tenant-sensitive → check `HOSTING_READINESS.md` first.
