# Arkive

> An open, user-owned **memory layer** for AI — plain markdown files on your machine, structured to compound, readable by any model over MCP. Trading is the first authored practice.

Arkive is a local-first (optionally hosted) MCP server + Next.js app. The model you use — Claude, ChatGPT, Gemini, Grok — reads and writes a structured set of markdown files that you own: a running stream of everything worth remembering, plus per-domain "practices" that turn that raw record into sharpening context. Today's vendor memory lives in someone else's database, doesn't move between models, and never gets structurally sharper. Arkive is the opposite: portable, model-agnostic, and built to compound with use.

The **trading practice** ships as the proving ground — it lets the AI execute on-chain trades through your wallet while every action lands in your arkive — but the format is domain-agnostic and extends to any domain.

## The model in one screen

Two things sit above the raw record:

- **The universal stream** (`arkive/stream/`) — every observation worth keeping, captured the moment it happens. Capture **never fails**: no schema, no required routing, empty bodies allowed. Cheap to write, so nothing is lost.
- **Practices** (`arkive/practices/<name>/`) — a domain (trading, research, health…) with an identical four-folder skeleton:
  - `journal/` — append-only history (one file per event)
  - `context/` — mutable current state (positions, rules, watchlist)
  - `skills/` — versioned operating procedures, situation-triggered
  - `insights/` — proposed patterns awaiting your `pending → accepted/rejected` gate

**Structure is earned, never guessed.** A practice only gains structure three ways: it's **authored** (a packaged practice ships expert-encoded, like trading), the user **teaches** it via a short intake, or a pattern **emerges** from enough stream observations that the AI proposes it. Hearing a topic three times is permission to *ask*, not to *build*.

**The compounding loop:** record (stream) → notice (emergence surfaces candidates) → learn (accepted insights become skills / update context) → improve (sharper reasoning next session).

Four cross-practice root files tie it together: `identity.md` (who you are), `arkive.protocol.md` (the universal behavior contract — currently **v7.5.0**), `arkive.config` (installed practices + defaults, pure YAML), `arkive.index` (auto-maintained typed link graph). Plus `loadup.md` — your editable "what I want at the start of every session."

## What the trading practice does

- **Wallet management** — create or import EVM wallets, encrypted locally with AES-256-GCM + PBKDF2; or add watch-only addresses.
- **On-chain execution** — quote and queue swaps via Uniswap V2 (Ethereum + Base) or 1inch (Ethereum), token transfers, approvals, WETH wrap/unwrap, Uniswap V2/V3 LP, UniswapX limit + TWAP orders, and Hyperliquid perps. **Every signing action requires an explicit click-to-approve in the local UI** — the MCP path can queue, never sign.
- **Position tracking & PnL** — every signed swap becomes a record; FIFO cost-basis math gives realized + unrealized PnL across wallets and chains.
- **Cost-basis backfill** — `set_cost_basis` for manual entry, `sync_wallet_from_chain` to auto-import history via Etherscan / Alchemy.
- **Risk safety** — GoPlus token-safety scans; default constraints block honeypots and gate large trades behind confirmation.
- **Dashboard** — GitHub-style activity heatmap + cross-venue portfolio stats.

## Architecture

```
Next.js app (one process)
├── UI pages (/, /pending, /arkives, /dashboard, /wallets, /connect)
├── /api/mcp           ← MCP server (HTTP/JSON-RPC) — what the model talks to
├── /api/arkive-v2/*   ← bundle, entry, insight, practice-instructions, reset, …
├── /api/wallets, /api/pending, /api/dashboard  ← internal app routes
└── auth: SIWE sign-in, MCP bearer tokens, OAuth 2.0 + PKCE (web connectors)
```

Code layout — the engine is **practice-agnostic**; packaged practices are isolated:

```
src/lib/arkive-v2/          ← the core memory engine (knows the universal shape, no domain)
├── paths.ts                  root files, stream, generic practice path helpers
├── schemas.ts                universal frontmatter, entity + link types, practice.config shape
├── frontmatter.ts            YAML codec
├── stream.ts                 capture (never-fails) + stream reads
├── emergence.ts              cluster observations → pattern + practice candidates
├── practices.ts              install / read / patch practices (generic)
├── write-entity.ts           the three-mutation-class write contract
├── read-bundle.ts            read_arkive — single session-start load
├── arkive-index.ts           typed provenance graph (rebuildable from frontmatter)
├── arkive-config.ts          arkive.config reader/writer
├── seeds.ts                  CORE seeds only (protocol, identity, loadup, bare practice)
├── migrate.ts                one-time migration to arkive-core-v1
└── authored/                 ← packaged practices live here, NOT in core
    ├── index.ts                the authored-practice registry (the only seam core uses)
    └── trading.ts              trading: config + instructions + seeds + paths

On disk (per user):
arkive/
├── identity.md  arkive.protocol.md  arkive.config  arkive.index  loadup.md
├── stream/<YYYY-MM>/<timestamp>-<hash>.md     ← the universal observation stream
└── practices/<name>/
    ├── practice.config              (pure YAML — declares this domain's contents)
    ├── practice.instructions.md     (operational playbook for this practice)
    ├── journal/<entity>/…           context/…   skills/ (+ _archive/)   insights/{pending,accepted,rejected}/
```

> **Trading is just an authored practice.** The core engine names no domain. It discovers trading only through `authored/index.ts`; removing trading or adding another packaged practice (e.g. research, health) is a self-contained module + a one-line registry entry. See `docs/DATA_MODEL.md`.

## MCP tools (63)

Discoverable at runtime. Grouped by layer:

**Memory (universal — every practice):** `read_arkive` (session start), `capture_observation`, `write_entity`, `read_entity`, `append_to_entity`, `list_entries`, `traverse_index`, `propose_insight`, `decide_insight`, `scan_emergence`

**Practices:** `list_practices`, `create_practice`, `get_practice_config`, `update_practice_config`, `suggest_intake_questions`

**Wallets & tokens:** `list_wallets`, `add_watch_wallet`, `label_wallet`, `list_chains`, `get_balance`, `get_token`, `find_holdings`, `resolve_ens`, `hide_token`, `unhide_token`, `list_hidden_tokens`

**Pricing & safety:** `get_eth_price`, `get_token_price`, `get_gas_price`, `get_pair_info`, `simulate_swap`, `analyze_token_safety`, `get_allowance`

**Trading & DeFi (exposed by the trading practice):** `get_quote`, `request_swap`, `get_swap_status`, `list_pending_swaps`, `cancel_pending_swap`, `request_transfer`, `request_approve_token`, `request_wrap_eth`, LP + `request_limit_order`, `request_twap_order`, `list_open_orders`, `cancel_limit_order`, `get_order_status`, and Hyperliquid perps (`hl_get_state`, `hl_get_market`, `hl_list_markets`, `hl_request_order`, `hl_request_close_position`, `hl_request_cancel_order`, `hl_request_update_leverage`, `hl_get_fills`, `hl_get_funding_history`, `hl_get_ledger`)

**Portfolio & backfill:** `get_portfolio`, `get_positions`, `get_open_positions`, `get_trade_history`, `get_realized_pnl`, `get_pnl_summary`, `set_cost_basis`, `sync_wallet_from_chain`

## Prerequisites

- **Node.js 20+** and npm
- A model client: **Claude Code** (easiest), **Claude Desktop**, or **Claude.ai web** (custom connector). ChatGPT / Gemini / Grok work over MCP too.
- An **Ethereum mainnet RPC** (free: PublicNode, Ankr, LlamaRPC) and a **Base RPC** for Base.
- *Optional:* **Etherscan** and/or **Alchemy** API keys for on-chain history; **1inch** key only if you use the 1inch venue; **WalletConnect/Reown** project ID for the sign-in modal.

See `.env.local.example` for the full list (filesystem vs. Supabase/Postgres backends included).

## Setup

```bash
npm install
cp .env.local.example .env.local      # set ETH_RPC_URL / BASE_RPC_URL (+ any optional keys)
npm run dev                            # http://localhost:3000
```

### Connect a model

Arkive's MCP server is at `http://localhost:3000/api/mcp`.

- **Claude Code (no tunnel):** `claude mcp add --transport http arkive http://localhost:3000/api/mcp` (append `--header "x-arkive-token:<token>"` if you set `ARKIVE_MCP_TOKEN`).
- **Claude Desktop (stdio bridge):** add an `mcpServers.arkive` entry running `npx -y mcp-remote http://localhost:3000/api/mcp` in `claude_desktop_config.json`, then fully quit and reopen.
- **Claude.ai web (tunnel):** leave `ARKIVE_MCP_TOKEN` empty, `ngrok http 3000`, and add the `…/api/mcp` URL under Settings → Connectors.

> ⚠️ A tunnel exposes the *whole* server, not just `/api/mcp`. Only run it while actively using the model.

## First run

1. Open `http://localhost:3000` → create a wallet (write the password down — there's no recovery).
2. Unlock it so the MCP server can sign on your behalf.
3. Talk to the model — your first message triggers `read_arkive`, which loads identity, protocol, loadup, and your active practices.
4. Try a trade: *"Quote 0.001 ETH for USDC on Ethereum,"* then *"Queue that."* Open `/pending` and click Approve.
5. Backfill: *"Sync my wallet from chain"* (needs `ETHERSCAN_API_KEY`/`ALCHEMY_API_KEY`) or *"Set cost basis…"*.

## Pages

`/dashboard` (heatmap + portfolio) · `/` (wallets) · `/pending` (approve/sign) · `/arkives` (file-explorer + force-graph of your substrate) · `/connect` (connection help)

## Safety

- Wallets are AES-256-GCM encrypted, key derived via PBKDF2-SHA256 (200k iterations); keystore at `.arkive/keystore.json` (mode 0600). Watch-only wallets store no key.
- The MCP path **cannot sign** — it only queues. Signing happens exclusively in `/pending` after your click.
- Default trading constraints: honeypot blocks, single-trade cap, confirm over a threshold, safety scan required for new tokens.
- Set `ARKIVE_MCP_TOKEN` to require an `x-arkive-token` header on `/api/mcp`. The `/api/pending` and `/api/wallets` routes are **not** token-protected — only run the dev server / tunnel while in use.

## Development

```bash
npm run dev        # dev server
npm run build      # production build
npm run start      # production server
npx tsc --noEmit   # type-check
```

The `.arkive/` directory persists between runs; delete it to start fresh. `read_arkive` runs the idempotent migration to `arkive-core-v1` on first load.

## Notes

- The behavior contract the AI follows is `arkive.protocol.md` (seeded from `src/lib/arkive-v2/seeds.ts`, **v7.5.0**), plus each practice's `practice.instructions.md`. The top-level `skills/` folder in this repo is **legacy from the v1 design and is no longer wired into the runtime**.
- Storage is a thin `(user_id, path) → { meta, body }` adapter with `filesystem` (local, `_local` user) and `postgres` (Supabase) backends, selected by `STORAGE_BACKEND`.

## License

MIT.
