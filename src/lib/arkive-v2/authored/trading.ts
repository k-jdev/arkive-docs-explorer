// The trading practice — Arkive's first authored (packaged) practice.
//
// "Authored" means a human expert encoded this practice's domain knowledge up
// front, so it is useful on a fresh install with zero user data (protocol §2,
// source-of-knowing #1). It is NOT part of the core engine: core knows only
// the universal shape (the observation stream + the four-folder practice
// skeleton) and discovers trading through the authored-practice registry
// (./index) — never by name.
//
// Everything trading-specific lives here: the practice.config declarations,
// the operational playbook (practice.instructions.md), the seed context
// files, and the well-known context directory. To ship another packaged
// practice, mirror this file and register it in ./index.ts.

import { ARKIVE_CORE_VERSION, type PracticeConfigFile } from "../schemas";
import { practiceContextDir } from "../paths";
import type { AuthoredPractice } from "./index";

/** The reserved slug for the trading practice. */
export const TRADING_PRACTICE = "trading";

/** Trading's context/ directory. Well-known because trading-specific tools
 *  and the reset/migration paths seed it (watchlist, positions, rules,
 *  intentions). Derived generically from the universal path helper. */
export const TRADING_CONTEXT_DIR = practiceContextDir(TRADING_PRACTICE);

/**
 * Trading practice.config — the packaged proof-of-value practice.
 *
 * Authored, not derived: the domain knowledge is encoded up front, so this
 * practice is useful on a fresh install with no user data. The entity types,
 * context files, link types, gated tool surface, and constraints all reflect
 * real trading workflow — not a placeholder skeleton.
 *
 * The practice.instructions.md (operational playbook) is where the
 * sequence-of-operations brain lives. This config just declares what's
 * allowed and what's gated.
 */
export function tradingPracticeConfig(): PracticeConfigFile {
  return {
    name: TRADING_PRACTICE,
    version: "2.3.0", // v2.3 — adds Hyperliquid history (fills, funding, ledger)
    based_on: ARKIVE_CORE_VERSION,
    description: "Spot + LP + UniswapX limit/TWAP on EVM (Ethereum + Base) + Hyperliquid perps (place + history). Authored, not derived.",
    author: "Arkive Core",
    license: "MIT",
    provides: {
      journal_entity_types: [
        {
          name: "trade",
          folder: "trades",
          schema: {
            required: ["trade_id", "type", "status", "asset", "venue", "sources"],
            optional: [
              "linked_skill", "linked_thesis", "links_to_entry", "leverage",
              "envelope_override", "flagged", "exit_price", "exit_date", "pnl",
              "chain",
            ],
          },
          append_only: true,
          allowed_mutations: {
            status_field: ["open_to_closed"],
            body_appends: ["outcome"],
          },
        },
        {
          name: "conversation",
          folder: "conversations",
          schema: {
            required: ["topic", "summary"],
            optional: [
              "linked_trades", "linked_research", "linked_positions",
              "user_state_revealed", "duration_minutes", "topic_tags",
            ],
          },
          append_only: true,
        },
        {
          name: "research",
          folder: "research",
          schema: {
            required: ["asset", "thesis_summary"],
            optional: [
              "target_date", "predictions", "falsification_criteria",
              "related_research", "linked_trades", "status",
            ],
          },
          append_only: true,
          allowed_mutations: {
            body_appends: ["dated_update"],
          },
        },
        {
          name: "recap",
          folder: "recaps",
          schema: {
            required: ["period_start", "period_end", "summary"],
            optional: ["highlights", "open_questions", "linked_trades", "linked_insights"],
          },
          append_only: true,
        },
        {
          // A parent TWAP that fans out into N child UniswapX limit orders.
          // The journal entry is the single audit trail; child orderIds live
          // in frontmatter so each chunk's fill / expiry / cancel is traceable.
          name: "twap_order",
          folder: "twap_orders",
          schema: {
            required: ["asset", "side", "chain", "total_amount", "chunks", "interval_seconds", "child_order_ids"],
            optional: [
              "status", "min_amount_out_per_chunk", "base_deadline",
              "filled_chunks", "expired_chunks", "cancelled_chunks",
              "realized_avg_price", "linked_trades",
            ],
          },
          append_only: true,
          allowed_mutations: {
            // open → partially_filled → filled (all chunks settled)
            // open → expired (window closed with unfilled chunks)
            // open → cancelled (user pulled the parent)
            status_field: [
              "open_to_partially_filled",
              "open_to_filled",
              "open_to_expired",
              "open_to_cancelled",
              "partially_filled_to_filled",
              "partially_filled_to_expired",
            ],
            body_appends: ["outcome"],
          },
        },
      ],
      context_files: [
        {
          name: "watchlist.md",
          purpose: "Assets actively tracked but not currently held",
          schema: "structured",
          structured_fields: [
            { asset: "string" },
            { chain: "string" },
            { conviction: "enum [low, medium, high]" },
            { notes: "string" },
            { added_date: "timestamp" },
          ],
          update_triggers: ["user_mentions_tracking", "user_requests_add", "intake"],
          update_mode: "replace", // STATE — the current watchlist, overwritten as it changes
        },
        {
          name: "positions.md",
          purpose: "Currently open positions",
          schema: "structured",
          structured_fields: [
            { asset: "string" },
            { side: "enum [long, short]" },
            { size: "number" },
            { entry_price: "number" },
            { opened_date: "timestamp" },
            { related_trade: "file_ref" },
          ],
          update_triggers: ["trade_opened", "trade_closed"],
          update_mode: "replace", // STATE — current open positions, computed from trades
        },
        {
          name: "rules.md",
          purpose: "Trading rules the user operates by",
          schema: "free_form",
          update_triggers: ["insight_accepted_as_rule", "user_explicitly_states_rule"],
          update_mode: "accumulate", // TRUTH — accepted rule-insights append here, never overwrite
        },
        {
          name: "intentions.md",
          purpose: "What the user is trying to do in trading right now",
          schema: "free_form",
          update_triggers: [
            "user_states_intention", "weekly_recap", "monthly_retrospective",
          ],
          update_mode: "replace", // STATE — the current intent, replaced as it shifts
        },
      ],
      skill_format: {
        description: "Behavioral playbooks for recurring trading situations",
        required_sections: ["when_this_applies", "how_to_act", "risk_envelope"],
        optional_sections: ["exceptions", "related_skills", "examples"],
        versioning: "semver_per_skill",
        envelope_required: true,
      },
      link_types: [
        { name: "linked_trade", description: "Reference to a specific trade entry" },
        { name: "linked_position", description: "Reference to an open or closed position" },
        { name: "tests_thesis", description: "This entity tests a stated research thesis" },
        { name: "applied_skill", description: "This trade applied a specific skill version" },
      ],
      // Complete tool surface — declared in the config so the AI never has
      // to discover. The instructions playbook groups them by intent;
      // here they're enumerated with their gates so the runtime can enforce
      // confirmation policy consistently. Gate semantics:
      //   none         — read-only or zero-risk
      //   one_tap      — changes tracked state but not chain state
      //   hard_confirm — moves funds or affects chain state irreversibly
      mcp_tools: [
        // Wallets + chain
        { name: "list_wallets", description: "List the user's wallets + unlock state", requires_gate: "none" },
        { name: "list_chains", description: "List supported EVM chains", requires_gate: "none" },
        { name: "add_watch_wallet", description: "Add a wallet to watch (read-only)", requires_gate: "one_tap" },
        { name: "label_wallet", description: "Label a wallet with purpose + tags", requires_gate: "one_tap" },
        { name: "resolve_ens", description: "Resolve an ENS name to an address", requires_gate: "none" },
        // Prices + state reads
        { name: "get_balance", description: "Get a wallet's ETH + token balances", requires_gate: "none" },
        { name: "get_token", description: "Look up token metadata", requires_gate: "none" },
        { name: "get_eth_price", description: "Current ETH USD price", requires_gate: "none" },
        { name: "get_token_price", description: "Current token USD price via Uniswap", requires_gate: "none" },
        { name: "get_gas_price", description: "Current gas price + USD estimate", requires_gate: "none" },
        { name: "get_allowance", description: "Read current ERC-20 allowance", requires_gate: "none" },
        // Safety + venue intel
        { name: "analyze_token_safety", description: "GoPlus token security verdict (honeypot, tax, etc.)", requires_gate: "none" },
        { name: "get_pair_info", description: "Uniswap V2 pair reserves + price", requires_gate: "none" },
        // Swap flow
        { name: "simulate_swap", description: "Simulate a swap — price impact + USD gas", requires_gate: "none" },
        { name: "get_quote", description: "Quote a swap without executing", requires_gate: "none" },
        { name: "request_swap", description: "Queue a swap for user approval at /pending", requires_gate: "hard_confirm" },
        { name: "get_swap_status", description: "Check a pending or completed swap", requires_gate: "none" },
        { name: "list_pending_swaps", description: "List queued swaps awaiting approval", requires_gate: "none" },
        { name: "cancel_pending_swap", description: "Cancel a queued swap", requires_gate: "one_tap" },
        // Holdings + PnL
        { name: "get_portfolio", description: "Aggregated holdings + USD across wallets", requires_gate: "none" },
        { name: "get_positions", description: "Open + closed positions with PnL", requires_gate: "none" },
        { name: "get_open_positions", description: "Open positions only", requires_gate: "none" },
        { name: "find_holdings", description: "Enumerate every ERC-20 a wallet has touched", requires_gate: "none" },
        { name: "get_trade_history", description: "Trade history with USD prices at execution", requires_gate: "none" },
        { name: "get_pnl_summary", description: "PnL summary across the trade log", requires_gate: "none" },
        { name: "get_realized_pnl", description: "Realized PnL only", requires_gate: "none" },
        { name: "set_cost_basis", description: "Manually set cost basis for a pre-existing position", requires_gate: "one_tap" },
        { name: "sync_wallet_from_chain", description: "Backfill trade history from on-chain data", requires_gate: "one_tap" },
        // Hidden tokens
        { name: "list_hidden_tokens", description: "List tokens hidden from portfolio views", requires_gate: "none" },
        { name: "hide_token", description: "Hide a scam/spam token from views", requires_gate: "one_tap" },
        { name: "unhide_token", description: "Unhide a previously hidden token", requires_gate: "one_tap" },
        // Money movement (irreversible)
        { name: "request_transfer", description: "Queue an ETH or ERC-20 transfer for approval", requires_gate: "hard_confirm" },
        { name: "request_approve_token", description: "Queue an ERC-20 approve for approval", requires_gate: "hard_confirm" },
        { name: "request_wrap_eth", description: "Queue ETH↔WETH wrap/unwrap for approval", requires_gate: "hard_confirm" },
        // Uniswap V2 LP
        { name: "request_add_liquidity_v2", description: "Queue a V2 LP add for approval", requires_gate: "hard_confirm" },
        { name: "request_remove_liquidity_v2", description: "Queue a V2 LP remove for approval", requires_gate: "hard_confirm" },
        { name: "list_lp_positions_v2", description: "List Uniswap V2 LP positions", requires_gate: "none" },
        // Uniswap V3 LP
        { name: "request_add_liquidity_v3", description: "Queue a V3 LP mint for approval", requires_gate: "hard_confirm" },
        { name: "request_exit_liquidity_v3", description: "Queue a V3 LP full exit (decrease + collect + burn)", requires_gate: "hard_confirm" },
        { name: "list_lp_positions_v3", description: "List Uniswap V3 LP positions", requires_gate: "none" },
        // UniswapX — off-chain limit + TWAP orders (Ethereum + Base)
        { name: "request_limit_order", description: "Queue a UniswapX limit order (off-chain, gasless to submit)", requires_gate: "hard_confirm" },
        { name: "request_twap_order", description: "Queue a TWAP — N chunked UniswapX limit orders over a time window", requires_gate: "hard_confirm" },
        { name: "list_open_orders", description: "List user's open UniswapX orders across wallets", requires_gate: "none" },
        { name: "get_order_status", description: "Status of a single UniswapX order by orderId", requires_gate: "none" },
        { name: "cancel_limit_order", description: "Remove a not-yet-signed UniswapX order from the pending queue (free; submitted orders expire on their own)", requires_gate: "one_tap" },
        // Hyperliquid — perpetuals + spot (off-EVM L1, same EVM key for signing)
        { name: "hl_get_state", description: "Full Hyperliquid account snapshot (perp + spot + open orders)", requires_gate: "none" },
        { name: "hl_get_market", description: "Hyperliquid orderbook + mark price for a coin", requires_gate: "none" },
        { name: "hl_list_markets", description: "List every Hyperliquid perpetual coin + max leverage", requires_gate: "none" },
        { name: "hl_request_order", description: "Queue a Hyperliquid perp order (Gtc/Ioc/Alo, reduce-only optional)", requires_gate: "hard_confirm" },
        { name: "hl_request_cancel_order", description: "Cancel an open Hyperliquid order by oid", requires_gate: "one_tap" },
        { name: "hl_request_close_position", description: "Close a Hyperliquid position via reduce-only IOC at mark ± slippage", requires_gate: "hard_confirm" },
        { name: "hl_request_update_leverage", description: "Set per-coin Hyperliquid leverage (cross or isolated)", requires_gate: "one_tap" },
        // Hyperliquid history reads
        { name: "hl_get_fills", description: "Recent Hyperliquid fills (executed trades) with realized PnL + fees per fill", requires_gate: "none" },
        { name: "hl_get_funding_history", description: "Funding payments paid/received on Hyperliquid perp positions over a time window", requires_gate: "none" },
        { name: "hl_get_ledger", description: "Hyperliquid deposits / withdrawals / internal transfers (non-funding ledger)", requires_gate: "none" },
      ],
      constraints: [
        { name: "trades_status_mutation_only", description: "Trades are append-only except for status field flip from open to closed and an Outcome section append" },
        { name: "skills_require_envelope", description: "Every skill must declare position size limits and chain restrictions" },
        { name: "positions_computed_from_trades", description: "positions.md is computed from the trade log, not independently maintained" },
      ],
    },
    loading: {
      default_mode: "active",
      triggers: [
        "asset_mentioned",
        "trade_proposed",
        "position_check_requested",
        "portfolio_topic",
      ],
    },
    insight_flow: {
      default_output: "ask_user",
      evidence_threshold: 3,
      evidence_types: ["trade", "conversation", "research"],
      rejection_cooldown_threshold: 10,
    },
    starter_pack: {
      seed_skills: [],
      seed_context: [],
      initial_intentions: [
        "Trade with consistent process",
        "Compound learning across decisions",
      ],
    },
  };
}

// ---- Context-file seeds (empty stubs that get the universal frontmatter) ----

export const WATCHLIST_MD = `---
entity_type: watchlist
practice: trading
created_at: ${new Date().toISOString()}
last_updated: ${new Date().toISOString()}
---

_No watchlist entries yet._
`;

export const POSITIONS_MD = `---
entity_type: positions
practice: trading
created_at: ${new Date().toISOString()}
last_updated: ${new Date().toISOString()}
---

_No open positions._
`;

export const RULES_MD = `---
entity_type: rules
practice: trading
created_at: ${new Date().toISOString()}
last_updated: ${new Date().toISOString()}
---

_No rules captured yet._
`;

export const INTENTIONS_MD = `---
entity_type: intentions
practice: trading
created_at: ${new Date().toISOString()}
last_updated: ${new Date().toISOString()}
---

_No active intentions._
`;

// ============================================================================
// Per-practice operational instructions
//
// Lives at `arkive/practices/<name>/practice.instructions.md`. Loaded at
// session start for every active practice. Markdown body the user (or
// practice author) edits to tell the AI HOW to act inside this specific
// practice — defaults, tool sequences, anti-patterns, decisive-execution
// rules. This is what gave older versions their "trading knowability"; the
// content now lives WHERE IT BELONGS — in the trading practice itself.
//
// Trading ships the full playbook. User-created practices get a minimal
// template so the AI knows what knobs the user can tune.
// ============================================================================

/**
 * Trading practice operational playbook. Full operational depth — chain
 * defaults, the trade flow, tool-by-intent index, dust handling, exit
 * target token, slippage, thesis-deviation surfacing, decisive execution.
 *
 * Auto-seeded if missing; the user can edit it via the workspace.
 */
export const TRADING_INSTRUCTIONS_MD = `---
entity_type: practice_instructions
practice: trading
created_at: ${new Date().toISOString()}
last_updated: ${new Date().toISOString()}
version: 1
---

# Trading practice — operational playbook

How to act fluidly inside the trading practice. The universal protocol
governs what's allowed; THIS file governs the moves that make trading feel
like a competent partner instead of a confused intern.

The user can edit this file. Anything they put here OVERRIDES the defaults
below.

---

## Chains, venues, native token

- **Default chain:** \`ethereum\`. Pass \`chain: "base"\` to operate on Base.
  Same wallet address works on both — no separate keys.
- **Default trading venue:** \`spot-uniswap\` (on-chain Uniswap V2 router, no
  API key, no rate limit). \`venue: "1inch"\` is opt-in and ethereum-only.
- **Native ETH:** use the symbol \`ETH\` on either chain. The router
  auto-wraps to WETH internally — don't manually wrap unless the user
  asked.

---

## The trade flow — sequence to follow

1. \`list_wallets\` — confirm the target wallet exists and is unlocked. If
   locked, tell the user to unlock at \`/wallets\` (one-tap). Don't proceed.
2. **Check the user's rules.** Read \`context/rules.md\` (already loaded at
   session start). Evaluate every rule's condition against the swap params.
   If any rule's action is \`block\` and it matches, REFUSE — surface the
   rule name + why it triggered. Don't call \`request_swap\`.
3. \`analyze_token_safety\` for unfamiliar tokens. Skip when the user's
   safety-tolerance rule explicitly allows it (e.g. "I accept memecoin
   risk on Base").
4. \`simulate_swap\` to get price impact + USD gas estimate. Use this to
   catch gas-negative trades before queueing (see "Dust" below).
5. \`request_swap\` to queue. The user MUST click Approve at \`/pending\` —
   you CANNOT auto-sign. The \`hard_confirm\` gate is non-negotiable.
6. After execution, trade evidence is written automatically. For "how am
   I doing" questions: \`get_positions\`, \`get_pnl_summary\`,
   \`get_trade_history\`, \`get_realized_pnl\`.

---

## Tools by intent

Every tool below is already in scope under the trading practice. Use the
exact name; don't search.

- **Quote / sim:** \`get_quote\`, \`simulate_swap\`, \`get_pair_info\`,
  \`get_token_price\`, \`get_eth_price\`, \`get_gas_price\`
- **Execute:** \`request_swap\`, \`get_swap_status\`,
  \`list_pending_swaps\`, \`cancel_pending_swap\`
- **Move funds:** \`request_transfer\`, \`request_wrap_eth\`,
  \`request_approve_token\`
- **Inspect:** \`get_balance\`, \`get_token\`, \`analyze_token_safety\`,
  \`get_allowance\`, \`resolve_ens\`
- **Holdings:** \`get_portfolio\`, \`get_positions\`,
  \`get_open_positions\`, \`find_holdings\`, \`hide_token\`,
  \`unhide_token\`, \`list_hidden_tokens\`
- **PnL / history:** \`get_pnl_summary\`, \`get_realized_pnl\`,
  \`get_trade_history\`, \`set_cost_basis\`, \`sync_wallet_from_chain\`
- **LP:** \`request_add_liquidity_v2\`, \`request_remove_liquidity_v2\`,
  \`request_add_liquidity_v3\`, \`request_exit_liquidity_v3\`,
  \`list_lp_positions_v2\`, \`list_lp_positions_v3\`
- **Wallets:** \`list_wallets\`, \`add_watch_wallet\`, \`label_wallet\`,
  \`list_chains\`

If you can't find a tool you need, you're looking at the wrong name — the
list above is exhaustive for trading. Don't burn cycles on tool discovery.

---

## Defaults that prevent wasted cycles

- **Exit target token: WETH.** Use USDC only when the user explicitly says
  "to stable," "lock it in," or has set a context rule to that effect.
  WETH preserves capital allocation for the typical re-entry.
- **Slippage:** 100 bps for blue chips, 300–500 bps for memecoins / thin
  liquidity / tokens with sell tax. Check \`get_pair_info.reserves\` to
  judge. Tax-bearing tokens (most meme tokens) need ≥500 bps.
- **Decimals:** \`request_swap\` accepts human-readable amounts
  (e.g. \`13391.14\`). Don't manually convert to base units. The router
  handles decimals from the token contract.
- **Native ETH symbol:** \`"ETH"\`. The router unwraps WETH on the way out
  if the user is buying ETH.

---

## Dust handling — the gas-negative trap

Before exiting any position whose USD value is < $50:

1. \`simulate_swap\` first to get the actual gas estimate.
2. If gas > 30% of expected proceeds, DON'T queue silently. Surface:

   > "Closing this position would burn ~$X in gas against ~$Y proceeds.
   > Want me to skip it, batch it with a larger exit, or proceed anyway?"

3. Wait for the user to decide. The user may not realize a small balance
   is gas-negative on Ethereum — proactively flagging it is the silent
   partner's job.

For "sell all of X across my wallets":

1. \`find_holdings\` (or aggregate from \`get_portfolio\`) to enumerate.
2. Group by wallet, sum value per wallet.
3. Queue one \`request_swap\` per wallet that PASSES the dust check.
4. Surface skipped wallets in one line: "Skipped 0xab21 — $14 GRAY would
   cost ~$8 in gas to close." User decides whether to force it.

---

## Limit orders + TWAP (via UniswapX)

\`request_swap\` is for IMMEDIATE market execution. When the user wants
something to happen LATER or AT A SPECIFIC PRICE, use UniswapX instead:

### request_limit_order

The right tool when the user says:

- "Sell my GRAY at \$0.05"
- "Buy 0.5 ETH if it drops to \$2,200"
- "Set a take-profit on HYPE at \$50"

Off-chain order, **zero gas to submit** (fillers cover gas when the
condition hits). Routes through Permit2 — first time on a token, you'll
need the user to approve via \`request_approve_token\` to the Permit2
contract (the limit order itself doesn't need a separate approve once
that's done).

Parameters:
- \`amountIn\` — total input (full balance you want to sell)
- \`minAmountOut\` — the LIMIT PRICE FLOOR (minimum acceptable output)
- \`deadlineHours\` — how long it stays live (default 24h, max 720h = 30d)
- \`chain\` — ethereum or base

Hard_confirm gate applies — user clicks Approve at \`/pending\` before the
order is signed and submitted.

### request_twap_order

The right tool when the user says:

- "Average into 0.5 ETH over the next hour"
- "Sell my position in chunks over the day, don't dump it"
- "TWAP my exit"

Splits a total into N child limit orders with staggered deadlines.
**Honest about what this is:** it's batched limit orders, not on-chain
continuous execution. If the market moves a lot during the window, some
chunks may not fill. This is exactly what the Uniswap UI does for TWAP —
no magic.

Parameters:
- \`totalAmountIn\` — total across all chunks
- \`chunks\` — 2–50 child orders
- \`intervalMinutes\` — spacing between chunk deadlines
- \`minAmountOutPerChunk\` — per-chunk floor

Saved as a SINGLE \`twap_order\` journal entry with the N \`child_order_ids\`
in frontmatter. One audit trail per TWAP, not N separate entries.

### Defaults that prevent wasted cycles

- **When the user is precise about price → limit order.** "Sell at \$X" =
  \`request_limit_order\`, not \`request_swap\` with a slippage prayer.
- **When the user is precise about TIME but not price → TWAP.** "Over
  the next 2 hours" = \`request_twap_order\`.
- **When they want it NOW → \`request_swap\`.** No reason to introduce
  off-chain auction latency for an immediate exit.
- **Chain support:** Ethereum + Base. UniswapX is also on Arbitrum +
  Unichain but Arkive doesn't currently configure those.

### Status + cancellation

- \`list_open_orders\` — see what's live across the user's wallets.
- \`get_order_status\` — check a specific orderId (fill amount, deadline,
  tx hash if filled).
- \`cancel_limit_order\` — removes a not-yet-signed order from the pending
  queue. Already-submitted orders just expire (zero gas to abandon them —
  no need to bug the user about it).

### Logging

When a UniswapX order fills (you'll learn this via \`list_open_orders\`
or polling), write a normal \`trade\` journal entry — the order's fill
tx + amounts feed in via the orderStatus response, same shape as a
regular swap fill. The trade entry carries \`linked_order: <orderId>\`
so the audit chain back to the UniswapX request is preserved.

For TWAPs, write ONE \`twap_order\` entry up front (with all
\`child_order_ids\` in frontmatter), then update its \`status\` field as
chunks fill / expire (the writer accepts the declared status_field
mutations). After the window closes, append an \`outcome\` section
summarizing realized avg price + how many chunks filled vs expired.

---

## Hyperliquid (perpetuals + spot)

Different venue. Different mental model. Decide WHICH venue before
quoting:

| User wants | Use |
| --- | --- |
| Spot buy/sell of an ERC-20 on Ethereum/Base | \`request_swap\` (Uniswap V2) |
| Set a price target on a spot ERC-20 | \`request_limit_order\` (UniswapX) |
| Average into/out of a spot position | \`request_twap_order\` (UniswapX) |
| **Open a leveraged position (long or short)** | \`hl_request_order\` (Hyperliquid) |
| **Trade perps that don't exist as ERC-20** | \`hl_request_order\` |
| Check perp PnL + funding + liquidation prices | \`hl_get_state\` |

### Account model

The Hyperliquid account IS the user's Ethereum address. Same wallet
that holds USDC on Arbitrum trades on Hyperliquid — no separate keys
to manage. Funds get there via the Arbitrum → Hyperliquid USDC bridge
(currently a separate external flow; Arkive doesn't yet expose deposit
tools). When the user says "deposit 5k to Hyperliquid," tell them to
do it via the Hyperliquid web app for now — that's coming as a phase 2.

### The "where do I stand" answer

ONE call: \`hl_get_state({ walletId })\`. Returns:
- \`perp.accountValue\` — total equity in USDC
- \`perp.withdrawable\` — free margin
- \`perp.totalMarginUsed\` — how levered up the user is
- \`perp.positions[]\` — every open position with entry, mark, PnL,
  liquidation price, leverage type
- \`spot_balances[]\` — USDC + any spot holdings
- \`open_orders[]\` — pending orders across all coins

Use this before any "how am I doing on HL" answer. Don't piece it
together from multiple calls.

### Placing orders — TIF semantics matter

\`hl_request_order\` takes a \`tif\` (time-in-force):
- \`Gtc\` — resting LIMIT order (sits on the book until filled or cancelled)
- \`Ioc\` — immediate-or-cancel, MARKET-style (with a price for slippage cap)
- \`Alo\` — POST-ONLY (rejected if it would cross the spread)

For a MARKET BUY: call \`hl_get_market(coin)\` to get mark price, then
\`hl_request_order\` with \`tif: "Ioc"\` and \`price: mark * 1.005\`
(50 bps buffer). For a MARKET SELL: \`mark * 0.995\`. The IOC fills
at the best available up to your price; what's left cancels.

For a LIMIT (resting): \`tif: "Gtc"\` + exact price.

Always set \`reduceOnly: true\` when CLOSING or REDUCING — guarantees
the order can't accidentally flip you into the opposite direction.

### Closing positions

Two paths:
1. \`hl_request_close_position(walletId, coin)\` — convenience: looks
   up current size, builds a reduce-only IOC at mark ± slippage, queues.
2. \`hl_request_order\` with explicit size + reduce-only — for partial
   closes.

### Leverage

Set per-coin via \`hl_request_update_leverage\`. Cross margin (default,
shares collateral across all positions) vs isolated (per-position
collateral, limits blast radius if one trade goes bad). Most users
want cross unless they're explicitly siloing risk.

### Checking past trades on Hyperliquid

Three read-only history tools, all no-gate:

- \`hl_get_fills(walletId, coin?, sinceMs?, limit?)\` — executed trades.
  Each row carries side, price, size, time, direction ("Open Long",
  "Close Short", "Buy", etc), realized PnL on that fill, and fee.
  Returns rolled-up \`total_realized_pnl\` + \`total_fees\` over the
  slice so the AI doesn't have to sum manually.
- \`hl_get_funding_history(walletId, sinceMs?, untilMs?)\` — funding
  payments per coin per interval. Defaults to past 7 days. Returns
  \`total_usdc\` (positive = user PAID funding, negative = user
  RECEIVED).
- \`hl_get_ledger(walletId, sinceMs?, untilMs?)\` — deposits +
  withdrawals + internal transfers. Defaults to past 30 days. Returns
  \`total_deposits\` + \`total_withdrawals\`.

Common patterns:
- "What did I trade on HL this week" → \`hl_get_fills(walletId,
  sinceMs: Date.now() - 7*24*3600*1000)\` + show count, totals, top
  coins by size.
- "How am I doing on BTC this month" → \`hl_get_fills(walletId,
  coin: "BTC", sinceMs: <month start>)\` + sum closed_pnl.
- "What's my funding cost been" → \`hl_get_funding_history(walletId)\`.
- "How much capital have I put on HL total" → \`hl_get_ledger\` with
  no sinceMs (defaults 30d — pass \`sinceMs: 0\` for ALL time).

When the user wants the answer journaled (not just spoken), promote
the rollup into a research entry summarizing the slice with
\`linked_trades\` pointing at any individual fills you wrote up.

### Logging Hyperliquid trades

Same \`trade\` journal entity as spot. Use \`venue: "hyperliquid"\` and
add these optional fields to the frontmatter:
- \`leverage\` — the leverage at entry
- \`liquidation_px\` — for the audit trail
- \`type: "perp"\` (vs \`"spot"\`) — distinguishes from Uniswap trades

When closing, \`mutation: { status_field: "open_to_closed" }\` + outcome
append works the same way. Realized PnL goes in the outcome section.

### Anti-patterns

- Quoting Hyperliquid prices for an ERC-20 spot question (different venue, different price).
- Submitting an \`hl_request_order\` without first calling \`hl_get_market\` for the mark.
- Forgetting \`reduceOnly: true\` on a close (you might accidentally double the position).
- Treating Hyperliquid leverage like Uniswap slippage (it's not — leverage is a separate per-coin setting via \`hl_request_update_leverage\`).

---

## Positions you didn't buy through Arkive

- \`find_holdings(walletId, chain)\` enumerates EVERY ERC-20 the wallet has
  touched, with current balance.
- \`set_cost_basis\` for manual entry of pre-existing positions the user
  remembers.
- \`sync_wallet_from_chain\` for auto-backfill (Etherscan + Defillama
  historical prices, idempotent). Run when the user onboards a new wallet
  or asks "why don't you see my X position?"

---

## Closing a trade — the journal mutation

When \`request_swap\` executes against an open position you have a journal
entry for:

1. Find the original trade: \`list_entries({ practice: "trading",
   subpath: "journal/trades" })\` then read by path.
2. \`write_entity\` with \`mutation: { status_field: "open_to_closed" }\` —
   flips status without overwriting the original entry.
3. \`append_to_entity\` with \`section_name: "outcome"\` to log: exit
   price, exit date, realized PnL, and what (if anything) the original
   thesis got right or wrong.

If the user closed before their declared invalidation conditions fired,
note the deviation in the outcome section. That's how the audit trail
gets useful at the next retrospective.

---

## When closing before invalidation

If the user closes a position BEFORE either of its declared invalidation
conditions hit, surface the deviation in ONE short sentence before queuing
the swap. Not a lecture. Not three rounds of confirmation. Example:

  > "Heads up — thesis hasn't been invalidated (neither dev-silence nor
  > LP-unlock has triggered). Queueing the exits now; cancel in /pending
  > if this is the wrong call."

Then queue. The \`hard_confirm\` gate is the final user check.

---

## Acting decisively

When the user gives a clear directive ("sell all my X", "close my Y"),
EXECUTE. Don't re-interrogate, don't second-guess, don't ask the same
question three different ways. Surface concerns INLINE in the response
that queues the swap. The user reads it, decides, and either approves at
\`/pending\` or cancels.

Patterns to avoid:

- "Are you sure?" — already gated by hard_confirm.
- "Should I proceed?" — same.
- 200 words of reasoning before queueing.
- Searching for tool names that are already exposed (see "Tools by
  intent" above).
- Asking the user which target token to swap into when WETH is the
  default and they didn't specify.
- Treating a -18% drawdown as "thesis-breaking" — that's a feeling, not
  a declared invalidation condition. Surface, don't editorialize.

---

## Multi-step sequences — use groupId so the user sees one approval flow

When you're running a SEQUENCE of related actions (set leverage AND
open the position, exit several wallets AT ONCE, etc.), every
\`request_*\` and \`hl_request_*\` tool accepts two optional params:

- \`groupId\` — any string you generate ONCE per sequence. Pass the
  same string to every call in the sequence.
- \`groupTitle\` — a single one-line summary of the WHOLE sequence.
  Pass it with the FIRST call only; later calls can omit it (the
  server backfills).

When the user opens \`/pending\`, ops sharing a groupId render as a
SINGLE titled card with a slideshow inside — they approve each step
in order with prev/next, not N separate cards in random order.

**Example — opening a 5 ETH long with 10x leverage on Hyperliquid:**

\`\`\`
const gid = crypto.randomUUID();  // or any unique string

hl_request_update_leverage({
  walletId, coin: "ETH", leverage: 10, marginMode: "cross",
  groupId: gid,
  groupTitle: "Open 5 ETH long at 10x leverage on Hyperliquid",
})

hl_request_order({
  walletId, coin: "ETH", side: "buy", size: "5",
  price: <mark * 1.005>, tif: "Ioc", reduceOnly: false,
  groupId: gid,
  // groupTitle omitted — server backfills from the first sibling
})
\`\`\`

Use groupId whenever 2+ ops conceptually belong together. Examples:
- Leverage change + position open
- Approve + swap
- Cancel order + place replacement
- Close multiple positions across coins
- Sell across multiple wallets

For genuinely independent single ops, leave both params undefined
and the UI renders each individually as today.

---

## Capture first, structure when the shape is obvious

Per the universal protocol §1, **capture is the spine**. In trading
specifically:

- A drive-by remark ("GRAY's looking interesting on the daily") →
  \`capture_observation\` with \`routed_to: "trading"\`, \`kind:
  "thought"\`, \`mentions: ["GRAY"]\`. ONE call. No structured write.
- A clear, well-shaped event (a trade you'd journal anyway) → straight
  to the structured \`write_entity\`. Don't double-log.
- An in-between case (the user said something that *might* be a thesis
  but isn't clearly stated yet) → capture, watch for follow-up. When
  follow-ups accrete a clear shape, promote to a structured \`research\`
  entry with \`created_from\` pointing at the observation paths.

Structured entries below are what to write WHEN the shape is obvious.

## Silent-partner logging in trading

In addition to the universal silent-partner rules (protocol §9):

- New thesis stated clearly → write \`research\` entry with \`asset\` +
  \`thesis_summary\` + \`predictions\` + \`falsification_criteria\`.
- Substantive position discussion → write \`conversation\` with
  linked_trades + the user's reasoning. Light back-and-forth =
  capture, not conversation entry.
- Trade closed → mutate the trade + append outcome (see "Closing a
  trade" above).
- **Rule articulated directly by user** → update \`context/rules.md\` in
  place. \`read_entity\` first, splice the new rule into the body
  (replace any placeholder; merge under an existing section if the rule
  fits one, else add a new section), then \`write_entity\` to REPLACE.
  Do NOT \`append_to_entity\` on rules.md — Class 2, replace-only.
  NEVER leave a placeholder sitting next to real rules.
- **Pattern observed across trades** (not a rule the user stated) →
  \`propose_insight\` with \`proposed_output: "context"\` and
  \`evidence\` pointing to the supporting trade entries. On acceptance
  the runtime produces the rule.
- Tracking a new asset → update \`context/watchlist.md\` the same way:
  read, splice, write the full body back.
- Closing a position → after the swap executes, update
  \`context/positions.md\` to remove the closed row.

Logs are silent. Confirmations are one line: "Logged the GRAY exit
plus outcome notes." Never quote a path or tool name.

## Context-file writes — the read-modify-write rule

For watchlist, positions, rules, intentions:

1. \`read_entity({ practice: "trading", subpath: "context/<file>.md" })\`
   to load the current body.
2. Compute the new body. If you see placeholder text like
   "_No rules captured yet._", DELETE it as part of the change.
3. \`write_entity({ practice: "trading", entity_type: "<file-stem>",
   subpath: "context/<file>.md", body: <newBody> })\` — no mutation
   flag. The writer detects this is a context file and replaces in
   place.

Anti-patterns:

- Calling \`append_to_entity\` on a context file (the writer now
  refuses, but don't even reach for it).
- Re-stating the placeholder as a section heading
  (e.g. "## No rules captured yet" beneath your new rule).
- Calling \`write_entity\` with only the new content and hoping it
  merges — it REPLACES. Build the full new body yourself.
`;

// ---- Registry descriptor ---------------------------------------------------
//
// How core discovers trading without naming it. Registered in ./index.ts.

export const tradingAuthoredPractice: AuthoredPractice = {
  name: TRADING_PRACTICE,
  version: tradingPracticeConfig().version,
  config: tradingPracticeConfig,
  instructions: () => TRADING_INSTRUCTIONS_MD,
  contextSeeds: () => [
    { filename: "watchlist.md", body: WATCHLIST_MD },
    { filename: "positions.md", body: POSITIONS_MD },
    { filename: "rules.md", body: RULES_MD },
    { filename: "intentions.md", body: INTENTIONS_MD },
  ],
};
