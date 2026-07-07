/**
 * DEV SEED — creates fake local data so every page has something to show.
 *
 * TO UNDO: rm -rf .arkive/
 * (or selectively: rm -rf .arkive/arkives .arkive/keystore.json)
 *
 * Safe to re-run — will not overwrite an existing .arkive/ tree (exits early).
 *
 * Usage: node scripts/seed-dev-data.mjs
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARKIVE_ROOT = path.join(ROOT, ".arkive");
const ARKIVES_DIR = path.join(ARKIVE_ROOT, "arkives");

// ---------- helpers ----------------------------------------------------------

async function write(relPath, content) {
  const abs = path.join(ARKIVES_DIR, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  console.log("  wrote", relPath);
}

function fm(meta, body = "") {
  const yaml = Object.entries(meta)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map((i) => `  - ${i}`).join("\n")}`;
      return `${k}: ${v}`;
    })
    .join("\n");
  return `---\n${yaml}\n---\n\n${body}`;
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400_000).toISOString();
}

// ---------- guard: skip if already seeded ------------------------------------

const identityDisk = path.join(ARKIVES_DIR, "arkive/identity.md");
try {
  await fs.access(identityDisk);
  console.log(".arkive/arkives/ already exists — skipping seed. Delete it to re-seed.");
  process.exit(0);
} catch {
  // doesn't exist — proceed
}

console.log("Seeding dev data into .arkive/ …\n");

// ---------- 1. keystore (watch-only wallets) ---------------------------------

const keystore = {
  version: 1,
  wallets: [
    {
      id: "w-dev-001",
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      label: "Hot Wallet",
      kind: "watch",
      purpose: "active trading",
      tags: ["spot", "ethereum"],
      createdAt: Date.now() - 30 * 86400_000,
    },
    {
      id: "w-dev-002",
      address: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
      label: "Cold Storage",
      kind: "watch",
      purpose: "long-term holds",
      tags: ["cold", "ethereum", "base"],
      createdAt: Date.now() - 60 * 86400_000,
    },
    {
      id: "w-dev-003",
      address: "0x1111111111111111111111111111111111111111",
      label: "Base Degen",
      kind: "watch",
      purpose: "base chain memecoins",
      tags: ["base", "memecoin"],
      createdAt: Date.now() - 7 * 86400_000,
    },
  ],
};

await fs.mkdir(ARKIVE_ROOT, { recursive: true });
await fs.writeFile(
  path.join(ARKIVE_ROOT, "keystore.json"),
  JSON.stringify(keystore, null, 2),
  "utf8"
);
console.log("  wrote keystore.json (3 watch-only wallets)");

// ---------- 2. identity ------------------------------------------------------

await write(
  "arkive/identity.md",
  fm(
    { entity_type: "identity", practice: "core", created_at: daysAgo(90), last_updated: daysAgo(2), version: 1 },
    `# Identity

Dev user exploring the Arkive app locally. Trading crypto on Ethereum and Base.

## About me
- Active trader since 2021, mostly spot + some perps on Hyperliquid
- Focus: ETH, major L2 tokens, occasionally memecoins on Base
- Style: thesis-driven, medium-term holds (days to weeks), not a daytrader
- Communication: terse — bullet points, no fluff

## Hard limits
- Never size more than 5% of portfolio into any single memecoin
- Always log a thesis before entering a position`
  )
);

// ---------- 3. arkive.config (pure YAML, no frontmatter) ---------------------

await write(
  "arkive/arkive.config.md",
  `version: arkive-core-v1
identity_ref: identity.md
protocol_ref: arkive.protocol.md

practices:
  trading:
    enabled: true
    mode: active
    version: 2.3.0

defaults:
  weekly_recap: true
  monthly_retrospective: true
  insight_evidence_threshold: 3
  rejection_cooldown_threshold: 10
  conversation_timeout_min: 30
  recent_window_days: 14
  recent_max_entries: 50
  daydream_frequency: off
`
);

// ---------- 4. trading practice config (pure YAML, no frontmatter) -----------

await write(
  "arkive/practices/trading/practice.config.md",
  `name: trading
version: 2.3.0
based_on: arkive-core-v1
description: Spot + perps on EVM + Hyperliquid. Authored practice.
author: Arkive Core
license: MIT

provides:
  journal_entity_types:
    - name: trade
      folder: trades
      append_only: true
      allowed_mutations:
        status_field:
          - open_to_closed
        body_appends:
          - outcome
      schema:
        required:
          - trade_id
          - type
          - status
          - asset
          - venue
          - sources
        optional:
          - linked_skill
          - linked_thesis
          - leverage
          - exit_price
          - exit_date
          - pnl
          - chain
    - name: research
      folder: research
      append_only: true
      schema:
        required:
          - topic
          - summary
        optional:
          - linked_trades
          - conviction
    - name: conversation
      folder: conversations
      append_only: true
      schema:
        required:
          - topic
          - summary
  context_files:
    - name: watchlist
      path: context/watchlist.md
      update_mode: replace
      description: Tokens I am watching or considering
    - name: positions
      path: context/positions.md
      update_mode: replace
      description: Current open positions
    - name: rules
      path: context/rules.md
      update_mode: accumulate
      description: Trading rules and lessons learned

loading:
  default_mode: active
  triggers:
    - trade
    - position
    - portfolio
    - swap
    - token

insight_flow:
  default_output: ask_user
  evidence_threshold: 3
  rejection_cooldown_threshold: 10
`
);

// ---------- 5. practice instructions -----------------------------------------

await write(
  "arkive/practices/trading/practice.instructions.md",
  fm(
    { entity_type: "practice_instructions", practice: "trading", created_at: daysAgo(90), last_updated: daysAgo(10), version: 1 },
    `# Trading practice — operational playbook

## What this practice tracks
Every trade I enter, research I do, and market conversation I have.
Log the thesis, asset, venue, and sizing. Close trades with PnL.

## How to act
- Default to terse, numbers-first
- Always log a trade thesis before confirming entry
- For perp positions, always note leverage
- Never auto-close a position without confirming I'm out

## Anti-patterns
- Don't surface old closed trades unless I ask
- Don't suggest portfolio rebalancing unprompted`
  )
);

// ---------- 6. context files --------------------------------------------------

await write(
  "arkive/practices/trading/context/watchlist.md",
  fm(
    { entity_type: "context", practice: "trading", created_at: daysAgo(30), last_updated: daysAgo(1), version: 1 },
    `# Watchlist

| Token | Chain | Reason | Priority |
|-------|-------|--------|----------|
| ETH   | Ethereum | Core position, always watching | high |
| ARB   | Arbitrum | L2 thesis, accumulating on dips | high |
| DEGEN | Base | Memecoin experiment, small size | low |
| OP    | Optimism | Similar thesis to ARB, watching for divergence | medium |
| PENDLE | Ethereum | Yield trading, DeFi narrative | medium |`
  )
);

await write(
  "arkive/practices/trading/context/positions.md",
  fm(
    { entity_type: "context", practice: "trading", created_at: daysAgo(30), last_updated: daysAgo(1), version: 1 },
    `# Open Positions

## ETH Long — spot
- Entry: $3,420 on 2026-06-10
- Size: 2.5 ETH (~$8,550)
- Thesis: ETH/BTC ratio bottomed, ETF inflows resuming
- Target: $4,200 | Stop: $3,100
- Linked trade: \`arkive/practices/trading/journal/trades/eth-long-2026-06.md\`

## ARB spot
- Entry: $0.92 on 2026-06-15
- Size: 10,000 ARB (~$9,200)
- Thesis: L2 TVL growth + token unlock tail risk priced in
- Target: $1.40 | Stop: $0.78
- Linked trade: \`arkive/practices/trading/journal/trades/arb-spot-2026-06.md\``
  )
);

await write(
  "arkive/practices/trading/context/rules.md",
  fm(
    { entity_type: "context", practice: "trading", created_at: daysAgo(60), last_updated: daysAgo(5), version: 1 },
    `# Trading Rules

## Accumulated lessons

**Never average down on memecoins.**
Learned from PEPE position in Jan 2026 — averaged twice, ended -70%.
Memecoins either work immediately or don't.

**Log the thesis before hitting confirm.**
Three times I skipped this and couldn't reconstruct why I entered. Now mandatory.

**ETH perps above 5x leverage require a stop order placed before entry.**
Not a suggestion. The March 2025 wick cost me 12% of the account.

**Take 20% off the table at 2x target.**
Keeps me in winners while locking some real PnL. Started doing this in Q4 2025.`
  )
);

// ---------- 7. journal: trades -----------------------------------------------

await write(
  "arkive/practices/trading/journal/trades/eth-long-2026-06.md",
  fm(
    {
      entity_type: "trade",
      practice: "trading",
      trade_id: "eth-long-2026-06",
      type: "spot",
      status: "open",
      asset: "ETH",
      venue: "Uniswap V3",
      chain: "ethereum",
      created_at: daysAgo(10),
    },
    `# ETH Long — June 2026

Entry at $3,420. Size 2.5 ETH.

**Thesis:** ETH/BTC ratio touched yearly low. Spot ETF inflows were negative for 3 weeks
but institutional OTC desk is buying. Macro backdrop improving (Fed paused).
Technically, we bounced off the 200-day EMA with volume.

**Risk:** Another week of ETF outflows could push to $3,100 stop.`
  )
);

await write(
  "arkive/practices/trading/journal/trades/arb-spot-2026-06.md",
  fm(
    {
      entity_type: "trade",
      practice: "trading",
      trade_id: "arb-spot-2026-06",
      type: "spot",
      status: "open",
      asset: "ARB",
      venue: "Uniswap V3",
      chain: "arbitrum",
      created_at: daysAgo(5),
    },
    `# ARB Spot — June 2026

Entry at $0.92. Size 10,000 ARB.

**Thesis:** ARB TVL is at ATH ($18B). Token unlock schedule is almost done.
Relative to OP, ARB is 30% cheaper on TVL/market cap basis. Catalysts: Nitro upgrade +
gaming ecosystem growing.

**Risk:** General L2 de-rating if ETH breaks down.`
  )
);

await write(
  "arkive/practices/trading/journal/trades/degen-close-2026-05.md",
  fm(
    {
      entity_type: "trade",
      practice: "trading",
      trade_id: "degen-close-2026-05",
      type: "spot",
      status: "closed",
      asset: "DEGEN",
      venue: "Aerodrome",
      chain: "base",
      exit_price: "0.0021",
      exit_date: daysAgo(20),
      pnl: "+$340 (+68%)",
      created_at: daysAgo(35),
    },
    `# DEGEN Trade — May 2026 (closed)

Entry at $0.00125. Size: 800k DEGEN ($1,000).

**Thesis:** Base chain memecoin with Farcaster community backing.
Farcaster user growth was accelerating. Bet on the narrative.

## Outcome

Exited at $0.0021. +68% in 15 days.
Took the full position off when I noticed Farcaster DAU growth stalled week-over-week.
Good trade, right read, got out before the reversal.`
  )
);

// ---------- 8. journal: research ---------------------------------------------

await write(
  "arkive/practices/trading/journal/research/eth-l2-thesis-2026-06.md",
  fm(
    {
      entity_type: "research",
      practice: "trading",
      topic: "ETH L2 TVL vs ETH price correlation",
      summary: "Investigated whether L2 TVL growth leads ETH price. Found 4-6 week lag.",
      conviction: "medium",
      linked_trades: ["arb-spot-2026-06"],
      created_at: daysAgo(8),
    },
    `# ETH L2 TVL / Price Correlation Research

Looked at 18 months of data across Arbitrum, Optimism, and Base TVL vs ETH spot price.

**Finding:** L2 TVL tends to lead ETH price by 4-6 weeks. When aggregate L2 TVL grows
>15% month-over-month, ETH has outperformed BTC over the following 6 weeks in 7 of 9 instances.

**Current read:** L2 TVL is up 22% MoM. If the pattern holds, ETH should outperform into late July.

**Caveats:** Sample size is small. One of the two exceptions was during the FTX contagion period
which was an exogenous shock, not a pattern break. The other was March 2024 ETF launch
(sentiment pulled forward, then faded).`
  )
);

// ---------- 9. insights: pending ---------------------------------------------

await write(
  "arkive/practices/trading/insights/pending/l2-tvl-leads-eth-insight.md",
  fm(
    {
      entity_type: "insight",
      practice: "trading",
      status: "pending",
      title: "L2 TVL growth leads ETH price by 4-6 weeks",
      summary: "7/9 historical instances confirm. Current: L2 TVL +22% MoM → bullish ETH into late July.",
      proposed_output: "skill",
      evidence: [
        "arkive/practices/trading/journal/research/eth-l2-thesis-2026-06.md",
        "arkive/practices/trading/journal/trades/arb-spot-2026-06.md",
      ],
      created_at: daysAgo(6),
    },
    `## Pattern

When aggregate L2 TVL (Arbitrum + Optimism + Base) grows >15% month-over-month,
ETH has outperformed BTC over the following 6 weeks in 7 of 9 historical instances.

## Proposed skill

"Check L2 TVL growth rate at the start of each month. If >15% MoM, flag as
a bullish ETH signal for the following 4-6 weeks. Add to the ETH watchlist note."`
  )
);

// ---------- 10. stream observations ------------------------------------------

const streamObs = [
  {
    name: "obs-eth-etf-flow-001",
    days: 12,
    body: "ETF inflows turned positive today — $180M net across all spot ETH products. First green day in 3 weeks. Worth watching if this sustains into Friday.",
    meta: { kind: "market_observation", mentions: ["ETH", "ETF"] },
  },
  {
    name: "obs-arb-unlock-002",
    days: 6,
    body: "ARB unlock schedule: last major cliff was last week (250M tokens). Remaining unlocks are small and spread across 18 months. The overhang is mostly digested.",
    meta: { kind: "research", mentions: ["ARB"], routed_to: "trading" },
  },
  {
    name: "obs-base-growth-003",
    days: 3,
    body: "Base hit $18B TVL. Transactions up 40% MoM. Coinbase pushing Base hard in the retail product. Tailwind for anything Base-native.",
    meta: { kind: "market_observation", mentions: ["Base", "DEGEN"], routed_to: "trading" },
  },
];

for (const obs of streamObs) {
  const iso = daysAgo(obs.days);
  const safeStamp = iso.replace(/[:.]/g, "-");
  const month = iso.slice(0, 7);
  const metaFields = Object.entries(obs.meta)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map((i) => `  - ${i}`).join("\n")}`;
      return `${k}: ${v}`;
    })
    .join("\n");

  await write(
    `arkive/stream/${month}/${safeStamp}-${obs.name}.md`,
    `---\nentity_type: observation\npractice: core\ncreated_at: ${iso}\n${metaFields}\n---\n\n${obs.body}`
  );
}

// ---------- done -------------------------------------------------------------

console.log(`
Done. Seed data written to .arkive/

  Wallets : 3 watch-only addresses
  Arkive  : trading practice with 2 open positions, 3 trades, 1 research, 1 pending insight
  Stream  : 3 observations

TO UNDO: rm -rf .arkive/
`);
