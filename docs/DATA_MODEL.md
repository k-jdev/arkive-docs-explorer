# Arkive Data Model

A map of every place data lives, who owns it, what shape it has, and where in
the codebase it's defined. Read this before changing any of it.

This describes **arkive-core-v1** with the **stream-first** model
(`arkive.protocol.md` v7.5.0). The core engine is **practice-agnostic** — it
knows the universal shape and nothing about any specific domain. Packaged
("authored") practices like trading are isolated under
`src/lib/arkive-v2/authored/` and discovered through a registry (§9).

---

## 0. The big picture

```
┌──────────────────────────────────────────────────────────────────────┐
│ STORAGE                                                               │
│   StorageAdapter (filesystem | postgres). One row/file per "entry"    │
│   keyed by (user_id, path). Knows nothing about arkives — just        │
│   { path, meta, body } blobs.                                         │
├──────────────────────────────────────────────────────────────────────┤
│ APPLICATION DOMAINS                                                   │
│   ARKIVE SUBSTRATE          INTERNAL STORE        WALLET / TRADING     │
│   paths: arkive/*           paths: _internal/*    in-process state     │
│   user-visible markdown     hidden from UI        + DB tables          │
│   stream + practices        trades, profile,      + keystore           │
│   typed link graph          migration markers     + pending ops        │
├──────────────────────────────────────────────────────────────────────┤
│ AUTH / SESSIONS / OAUTH                                               │
│   SIWE sign-in → users + sessions; MCP bearer tokens; OAuth 2.0 + PKCE │
└──────────────────────────────────────────────────────────────────────┘
```

The **arkive substrate** is the user-facing memory layer (what you see in
`/arkives`). The **internal store** is everything the app must remember that
isn't part of that graph. The **wallet/trading domain** is its own subsystem.
Everything is scoped by `userId`.

---

## 1. Storage layer

**Files:** `src/lib/storage/{types,index,filesystem,postgres}.ts`, `db/schema.sql`.

A thin interface — the rest of the app talks to it, never to a filesystem or
DB client directly.

```ts
type StoredEntry = { path: string; meta: Record<string, unknown>; body: string };

interface StorageAdapter {
  readEntry(userId, path): Promise<StoredEntry | null>;
  listEntries(userId, pathPrefix): Promise<StoredEntry[]>;   // recursive
  writeEntry(userId, entry): Promise<void>;
  deleteEntry(userId, path): Promise<boolean>;
  readKeystore(userId): Promise<EncryptedKeystore | null>;   // wallet domain (§6)
  writeKeystore(userId, keystore): Promise<void>;
}
```

Backend via `STORAGE_BACKEND`: `filesystem` (local dev, `user_id = "_local"`,
`.arkive/` in repo root) or `postgres` (Vercel + Supabase, real auth uuid).
Both substrate and internal store share one `arkive_entries` table,
distinguished by path prefix (`arkive/*` vs `_internal/*`).

`currentUserId()` (`storage/index.ts`) resolves: MCP request context (bearer
token) → browser session cookie (SIWE) → `_local` (filesystem only, else throw).
**There is no unscoped read.**

---

## 2. The arkive substrate

**Files:** `src/lib/arkive-v2/*`. Key files:

| File | Contents |
|------|----------|
| `paths.ts` | Universal path constants + generic practice helpers, slugifiers, date helpers. **No domain-specific paths.** |
| `schemas.ts` | Universal frontmatter, universal entity + link types, `practice.config` shape |
| `frontmatter.ts` | YAML codec — `parseFrontmatter` / `serializeEntry` |
| `stream.ts` | Capture (never-fails) + stream reads (§2.2) |
| `emergence.ts` | Cluster observations → pattern + practice candidates (§2.4) |
| `practices.ts` | Install / read / patch practices — generic (§2.3) |
| `write-entity.ts` | The three-mutation-class write contract (§4) |
| `read-bundle.ts` | `readArkive()` — single session-start load (§2.5) |
| `arkive-index.ts` | Typed provenance graph (§3) |
| `arkive-config.ts` | `arkive.config` reader/writer |
| `seeds.ts` | **Core seeds only** — protocol, identity, loadup, bare practice helpers |
| `migrate.ts` | One-time migration to arkive-core-v1 |
| `authored/index.ts` | The authored-practice registry (§9) |
| `authored/trading.ts` | The trading practice — config, instructions, seeds, paths (§9) |

### 2.1 Canonical on-disk layout

```
arkive/
├── identity.md            # who the user is (append-only, cross-practice)
├── arkive.protocol.md     # universal behavior contract (system-managed, v7.5.0)
├── arkive.config          # installed practices + defaults (PURE YAML)
├── arkive.index           # auto-maintained typed link graph (JSON)
├── loadup.md              # user-owned session-start preferences
│
├── stream/                # the universal observation stream
│   └── <YYYY-MM>/<isoTimestamp>-<8charHash>.md
│
└── practices/
    └── <practice-name>/
        ├── practice.config            # declares this domain's CONTENTS (YAML)
        ├── practice.instructions.md   # operational playbook for this practice
        ├── journal/<entity-type>/…    # append-only history (Class 1)
        ├── context/…                  # mutable current state (Class 2)
        ├── skills/   (+ _archive/)     # versioned playbooks
        └── insights/{pending,accepted,rejected}/
```

Path constants live in `paths.ts`. Use the generic helpers
(`practiceRoot(name)`, `practiceJournalDir(name)`, `practiceContextDir(name)`,
`practiceConfigPath(name)`, …) — **never hardcode a practice name in core.**

### 2.2 The universal stream (capture is the spine)

**File:** `stream.ts`. The stream is a single global, practice-agnostic log of
raw observations. The capture contract is absolute: **it never fails** — no
schema validation, no required routing, empty body allowed.

```ts
type ObservationMeta = {
  entity_type: "observation";
  practice: "core";          // observations always live at core; projections route them
  created_at: string;        // ISO 8601
  kind?: string;             // loose hint: "trade_close", "watch_deal", "reflection"
  mentions?: string[];       // extracted entities (tickers, names) — retrieval hints
  routed_to?: string;        // best-guess practice slug — a hint, not a commitment
  projected_to?: string[];   // backlinks set when an observation is promoted to a journal entry
};
```

`capture()` writes `arkive/stream/<YYYY-MM>/<ts>-<hash>.md` and best-effort
updates the index. Reads (`listObservations`, `readObservation`) filter by
`routed_to` / `kind` / `since`. Promotion sets `projected_to` via
`recordProjection()`.

### 2.3 Practices (the unit of domain extension)

**File:** `practices.ts`. Every practice has the identical four-folder skeleton
plus a `practice.config` (pure YAML) and `practice.instructions.md`. The
runtime never hardcodes a practice — it reads the config and operates on the
declarations.

`practice.config` (`PracticeConfigFile` in `schemas.ts`) declares:

- `name`, `version`, `based_on`, `description`
- `provides.journal_entity_types[]` — the journal sub-folders + each type's
  frontmatter schema and `allowed_mutations` (Class 3, §4)
- `provides.context_files[]` — the state files the practice keeps
- `provides.skill_format` — required sections + versioning
- `loading` — `default_mode` (`active` | `on_demand` | `private`) + `triggers`
- `insight_flow` — `default_output`, `evidence_threshold`, `rejection_cooldown_threshold`
- optional `link_types[]`, `mcp_tools[]`, `constraints[]`, `starter_pack`

Lifecycle: `installPractice` (writes config + registers in `arkive.config`),
`createUserPractice` (bare container — empty entity types until intake or
emergence fills them in), `updatePracticeConfig` (additive, idempotent-by-name
patches). Reserved/authored names are rejected for create/modify (§9).

### 2.4 Emergence (structure is earned)

**File:** `emergence.ts`. **Analyze only — never commits structure.** Walks the
stream and returns:

- `pattern_candidates` — observation clusters (by `kind` or `mention`) past a
  threshold (default 3). Evidence for `propose_insight`.
- `practice_suggestions` — `routed_to` hints pointing at practices that don't
  exist yet (default ≥5). Evidence for the "want me to track this?" ask.

Hearing a topic N times is permission to **ask**, never to **build**.

### 2.5 The bundle (`read_arkive`)

**File:** `read-bundle.ts`. One session-start load, practice-agnostic. Per the
protocol §0 it returns: `identity.md`, `arkive.protocol.md`, `loadup.md`,
`arkive.config`, a recent slice of the stream, and — for each **active**
practice — its `practice.config`, `practice.instructions.md`, `context/` files,
recent journal entries (within `recent_window_days`, capped), and
`insights/pending/`. It also surfaces `capability.pattern_candidates` and
`capability.practice_suggestions` from emergence. Skills are **not** bulk-loaded
(situation-triggered). The exact `Bundle` type lives in `read-bundle.ts`;
`/api/arkive-v2/bundle` returns it verbatim for the workspace UI.

**Protocol auto-refresh:** if the stored `protocol_version` differs from the
bundled `PROTOCOL_VERSION`, `arkive.protocol.md` is overwritten. This is the
only auto-overwrite in the substrate — the protocol is system-managed.

---

## 2.6 Universal frontmatter, entity types, link types

**File:** `schemas.ts`. Every entity carries three required fields:

```yaml
entity_type: <type>     # universal (below) or practice-declared
practice: <name>        # practice slug, or "core" for the root files + stream
created_at: <ISO>
```

`UNIVERSAL_ENTITY_TYPES`: `identity`, `protocol`, `config`, `index`, `loadup`,
`observation`, `insight`, `skill`, `practice_instructions`. Everything else
(e.g. `trade`, `research`, `recap`) is **practice-declared** in that practice's
`practice.config`, not in core.

`UNIVERSAL_LINK_TYPES` (provenance edges read by the index): `sources`,
`evidence`, `triggered_by`, `produced`, `resulted_in`, `applied_to`,
`created_from`. Practices may add their own link types via `practice.config`.
Populate links only when the connection is real — don't fabricate provenance.

---

## 3. The arkive index (typed graph)

**File:** `arkive-index.ts`, persisted to `arkive/arkive.index` (JSON),
rebuildable from a full frontmatter scan.

- **Nodes** — one per substrate entry: `{ path, type: <entity_type>, title?, timestamp? }`.
- **Edges** — one per populated link field: `{ from, to, type: <link_type>, broken? }`.
  Unresolved references are kept with `broken: true` rather than dropped.

`updateIndexForEntry(path)` runs (best-effort) on every write; `rebuildIndex()`
does the full two-pass scan (nodes, then edges, then invert for incoming). The
MCP `traverse_index` tool walks specific edge types so the AI can ground a claim
("per your last 3 GRAY trades…") in real, auditable paths.

---

## 4. The write contract — three mutation classes

**File:** `write-entity.ts`. Every file in a practice belongs to one class; the
writer enforces it.

- **Class 1 — append-only history (`journal/`).** New file per event, never
  rewritten. `write_entity` with a NEW path. Corrections are new entries linked
  back via `created_from`.
- **Class 2 — mutable state (`context/` + `practice.instructions.md`).** Read,
  modify, **replace in full** — `write_entity` to the SAME path REPLACES (no
  merge, no append). Flow: `read_entity` → splice → `write_entity`.
- **Class 3 — declared exceptions.** Two narrow journal mutations, only if the
  entity type's `allowed_mutations` declares them: a **status flip**
  (`mutation.status_field: "<from>_to_<to>"`, e.g. `open → closed`) and a
  **named-section append** (`append_to_entity` with a declared `section_name`).

`capture_observation` (the stream) sits below all three — it's the always-safe
default when shape isn't yet earned.

---

## 5. The internal store (hidden from the user)

**File:** `internal-store.ts`. Same adapter, `_internal/<namespace>/<id>` prefix.

| Namespace | What |
|-----------|------|
| `_internal/trades/<txhash>` | Per-trade record (entry/exit, costs) → PnL math |
| `_internal/user-profile/<key>` | User behavioral settings → tool defaults |
| `_internal/config/system/*` | Migration markers (e.g. core-v1) |

The arkive workspace UI filters out `_internal/` via the tree builder.

---

## 6. Wallet + trading domain

Its own subsystem, separate from the substrate.

**Keystore** (`keystore.ts` + `keystores` table): AES-256-GCM encrypted private
keys, one row per user; decrypted to an in-memory account on unlock. Watch-only
wallets store no cipher. (Obsolete once WalletConnect lands.)

**In-process pending ops** (`state.ts`): a process-global Map, **not persisted**
— survives process lifetime, not redeploys. The trade record IS persisted once
a swap submits (`_internal/trades/<txhash>`).

```ts
type ArkiveState = {
  unlocked: Map<string, { account: PrivateKeyAccount; unlockedAt: number }>;
  pending:  Map<string, PendingOp>;
};
```

`PendingOp` is a tagged union: `swap`, `transfer`, `approve`,
`wrap_eth`/`unwrap_weth`, `add_liquidity_v2`/`remove_liquidity_v2`,
`add_liquidity_v3`/`exit_liquidity_v3` (+ UniswapX orders and Hyperliquid perps
handled through their own libs). Every variant requires explicit UI approval to
broadcast.

---

## 7. Auth, sessions, OAuth

**Tables:** `users`, `sessions`, `mcp_tokens`, `oauth_clients`, `oauth_codes`,
`oauth_tokens` (`db/schema.sql`).

At the MCP edge: read `Authorization: Bearer <token>` → `mcp_tokens` (if
`arkv_…`) or `oauth_tokens` (if `arka_…`) → bind `user_id` into request context
→ `currentUserId()` reads it for all subsequent storage calls. **No global
user.** Lose the token → lose access.

---

## 8. UI-facing shapes (the workspace)

`/arkives` consumes the bundle (§2.5) plus local view types
(`src/components/arkive-workspace/types.ts`): `TreeNode`, `Tab`. The tree
builder seeds canonical folders so empty sections still render and hides
`_internal/` + `arkive.config`. Per-practice node tinting uses
`PRACTICE_PALETTE` (`practices.ts`).

---

## 9. Authored practices (how trading stays out of the core)

**Files:** `authored/index.ts` (registry), `authored/trading.ts` (the practice).

The core engine names **no domain**. A packaged practice — one a human expert
encoded up front so it's useful on a fresh install (protocol §2, source-of-
knowing #1) — registers through `authored/index.ts`:

```ts
type AuthoredPractice = {
  name: string;                                         // reserved slug
  version: string;                                      // registered into arkive.config
  config: () => PracticeConfigFile;
  instructions: () => string;                           // practice.instructions.md body
  contextSeeds: () => Array<{ filename: string; body: string }>;
};

export const AUTHORED_PRACTICES: AuthoredPractice[] = [tradingAuthoredPractice];
export function isAuthoredPractice(name): boolean;   // verified flag, sort priority
export function isReservedPractice(name): boolean;   // blocks user create/modify collisions
```

Core consumes the registry, never a name:

- `arkive-config.ts` → `defaultArkiveConfig()` installs every authored practice.
- `practices.ts` → `verified: isAuthoredPractice(name)`, authored-first sort,
  `isReservedPractice` guards on create/update.
- `migrate.ts` / `reset` → seed trading by importing from `authored/trading`.

`authored/*` depends only on `schemas` (types) and `paths` (generic helpers) —
never on `practices.ts` or `arkive-config.ts`, so there's no dependency
inversion. The core files (`paths`, `seeds`, `arkive-config`, `practices`,
`read-bundle`, `stream`, `emergence`, `write-entity`, `schemas`,
`arkive-index`) carry **no code-level dependency on any domain**.

### Adding a packaged practice

1. Create `authored/<name>.ts`: export the slug, a `practiceConfig()`,
   an instructions string, optional context seeds, and an `AuthoredPractice`
   descriptor (mirror `authored/trading.ts`).
2. Append it to `AUTHORED_PRACTICES` in `authored/index.ts`.

That's it — it installs on fresh arkives, gets the verified flag, and is
reserved against user collisions, with zero core edits.

---

## 10. Common modification recipes

- **New journal entity type for a practice** → declare it in that practice's
  `practice.config` (`provides.journal_entity_types[]`) via
  `update_practice_config`. It is NOT a core schema change.
- **New packaged practice** → §9.
- **New universal link type** → add to `UNIVERSAL_LINK_TYPES` (`schemas.ts`),
  extend the edge build in `arkive-index.ts`, add an `EDGE_COLOR` in
  `ArkiveGraph.tsx`.
- **New internal namespace** → use `internalPath()` / `readInternal()` /
  `writeInternal()` under `_internal/<name>/`; the UI filters it automatically.
- **New wallet op** → add a `PendingXxx` to the `PendingOp` union (`state.ts`),
  a `request_xxx` tool, an execute path, and a `PendingList.tsx` label.
- **New Postgres column** → `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in
  `db/schema.sql`, or stuff it in the `meta` jsonb (GIN-indexed).

---

## 11. What's NOT in the model (yet)

- **Server-side pending-op persistence** — in-memory only today.
- **Incremental graph index at scale** — `rebuildIndex()` re-scans; a
  `graph_edges` table comes when entry counts demand it.
- **Soft delete** — `deleteEntry` is a hard delete; no tombstones.
- **Versioning of non-skill files** — skills version explicitly (`_archive/`);
  insights become immutable on accept/reject; journal entries are
  append-only-by-convention.
- **Legacy `skills/` repo folder** — the top-level `skills/` directory is from
  the v1 design and is no longer wired into the runtime. The live behavior
  contract is `arkive.protocol.md` + each practice's `practice.instructions.md`.

---

## Where to look first

- "Add a field to a trade entry" → trading's `practice.config` in
  `authored/trading.ts` (`tradingPracticeConfig`).
- "Add a top-level folder for a practice" → `paths.ts` generic helpers; declare
  contents in the practice's config.
- "Make a new edge type appear in the graph" → §10.
- "Store data the user shouldn't see" → §5.
- "What does `read_arkive` return" → `read-bundle.ts` (§2.5).
- "Add an MCP tool" → `src/lib/mcp-server.ts`.
- "Where does trading live" → `src/lib/arkive-v2/authored/` (§9).
