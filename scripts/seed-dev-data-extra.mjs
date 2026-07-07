/**
 * DEV SEED (extra) — adds more files to .arkive/ to fatten the node graph.
 *
 * Requires seed-dev-data.mjs to have been run first (needs the base tree).
 * Safe to re-run — skips files that already exist.
 *
 * TO UNDO: rm -rf .arkive/
 *
 * Usage: node scripts/seed-dev-data-extra.mjs
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARKIVES_DIR = path.join(ROOT, ".arkive", "arkives");

// ---------- helpers ----------------------------------------------------------

async function write(relPath, content) {
  const abs = path.join(ARKIVES_DIR, relPath);
  try {
    await fs.access(abs);
    return; // already exists — skip
  } catch {}
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

function ago(days, hours = 0) {
  return new Date(Date.now() - (days * 86400 + hours * 3600) * 1000).toISOString();
}

console.log("Adding extra seed data to .arkive/ …\n");

// =============================================================================
// TRADING — more trades, skills, accepted insights, cross-links
// =============================================================================

// ---- More closed trades (creates more leaf nodes) ---------------------------

await write(
  "arkive/practices/trading/journal/trades/op-spot-2026-05.md",
  fm({
    entity_type: "trade",
    practice: "trading",
    trade_id: "op-spot-2026-05",
    type: "spot",
    status: "closed",
    asset: "OP",
    venue: "Uniswap V3",
    chain: "optimism",
    exit_price: "2.15",
    exit_date: ago(25),
    pnl: "-$210 (-8.5%)",
    created_at: ago(40),
    sources: ["arkive/practices/trading/journal/research/l2-comparative-2026-05.md"],
  }, `# OP Spot — May 2026 (closed)

Entry at $2.35. Size 1,000 OP.

**Thesis:** Same L2 thesis as ARB but OP had better near-term catalyst (Superchain launch).

## Outcome

Stopped out at $2.15 after Superchain launch was delayed 6 weeks.
The thesis was right but the timing was wrong. Would re-enter on confirmation.`)
);

await write(
  "arkive/practices/trading/journal/trades/pendle-spot-2026-05.md",
  fm({
    entity_type: "trade",
    practice: "trading",
    trade_id: "pendle-spot-2026-05",
    type: "spot",
    status: "closed",
    asset: "PENDLE",
    venue: "Uniswap V3",
    chain: "ethereum",
    exit_price: "6.80",
    exit_date: ago(15),
    pnl: "+$870 (+29%)",
    created_at: ago(45),
    sources: ["arkive/practices/trading/journal/research/yield-protocols-2026-04.md"],
  }, `# PENDLE Spot — May 2026 (closed)

Entry at $5.27. Size 600 PENDLE (~$3,162).

**Thesis:** Yield tokenization narrative heating up. Pendle V3 launch upcoming with
new pools. TVL was growing 40% MoM. DeFi summer vibes.

## Outcome

Exited at $6.80 on Pendle V3 announcement hype. +29%. Perfect trade — took profits
into the announcement, which turned out to be "buy the rumor sell the news".
Price dropped to $5.50 the next week.`)
);

await write(
  "arkive/practices/trading/journal/trades/eth-perp-short-2026-04.md",
  fm({
    entity_type: "trade",
    practice: "trading",
    trade_id: "eth-perp-short-2026-04",
    type: "perp",
    status: "closed",
    asset: "ETH",
    venue: "Hyperliquid",
    leverage: "3x",
    exit_price: "3180",
    exit_date: ago(60),
    pnl: "+$1,240 (+18%)",
    created_at: ago(72),
    sources: ["arkive/practices/trading/journal/research/eth-l2-thesis-2026-06.md"],
  }, `# ETH Perp Short — April 2026 (closed)

Short at $3,650. 3x leverage. $7,500 notional.

**Thesis:** ETH overbought after 2-week 40% run. Funding rates turned very positive
(longs paying 0.08% per 8h). Mean reversion expected to $3,000–3,200 range.

## Outcome

Covered at $3,180. +18% on notional, 54% on margin. Clean trade.
Funding rate compression was the tell.`)
);

await write(
  "arkive/practices/trading/journal/trades/base-meme-basket-2026-06.md",
  fm({
    entity_type: "trade",
    practice: "trading",
    trade_id: "base-meme-basket-2026-06",
    type: "spot",
    status: "open",
    asset: "BRETT+TOSHI",
    venue: "Aerodrome",
    chain: "base",
    created_at: ago(4),
    evidence: ["arkive/practices/trading/journal/research/base-ecosystem-2026-06.md"],
  }, `# Base Memecoin Basket — June 2026

Split entry: 50% BRETT at $0.112, 50% TOSHI at $0.0034. Total ~$2,000.

**Thesis:** Base chain is clearly winning the L2 memecoin race. BRETT + TOSHI are
the two blue chips. Coinbase pushing Base in wallet creates new retail flow.
Small bet on narrative continuation — max loss is the $2k.`)
);

// ---- Research entries (more nodes + cross-links) ----------------------------

await write(
  "arkive/practices/trading/journal/research/l2-comparative-2026-05.md",
  fm({
    entity_type: "research",
    practice: "trading",
    topic: "ARB vs OP comparative analysis",
    summary: "ARB trading at discount to OP on TVL/MC. ARB unlock schedule cleaner.",
    conviction: "high",
    linked_trades: ["op-spot-2026-05", "arb-spot-2026-06"],
    created_at: ago(42),
  }, `# ARB vs OP — Comparative Analysis (May 2026)

Ran a TVL / market cap comparison across Arbitrum, Optimism, and Base.

| Chain | TVL | MC | TVL/MC |
|-------|-----|-----|--------|
| ARB   | $14B | $3.8B | 3.7x |
| OP    | $9B  | $3.2B | 2.8x |

**ARB is significantly cheaper** on this metric. OP had the Superchain catalyst
but the ratio divergence favors ARB on a fundamentals basis.

ARB unlock schedule: 95% complete. OP unlock schedule: still 30% pending.
ARB wins on both metrics.`)
);

await write(
  "arkive/practices/trading/journal/research/yield-protocols-2026-04.md",
  fm({
    entity_type: "research",
    practice: "trading",
    topic: "Yield tokenization protocols — Pendle, Spectra, Napier",
    summary: "Pendle dominates with 70% market share. TVL inflecting. Narrative incoming.",
    conviction: "high",
    linked_trades: ["pendle-spot-2026-05"],
    created_at: ago(48),
  }, `# Yield Tokenization Protocols — April 2026

Scanned Pendle, Spectra, and Napier. Pendle has 70% market share in the
yield tokenization space, with $2.8B TVL (up from $800M in January).

Key insight: restaking yield (EigenLayer) is driving new pool creation. Every
new LRT creates a new Pendle pool. This is a structural tailwind, not a narrative.

**Pendle V3** was in audit. New AMM design + better capital efficiency.
The announcement would be a strong catalyst.`)
);

await write(
  "arkive/practices/trading/journal/research/base-ecosystem-2026-06.md",
  fm({
    entity_type: "research",
    practice: "trading",
    topic: "Base chain ecosystem — TVL, users, memecoins",
    summary: "Base overtook OP in daily active users. Memecoin flywheel is real.",
    conviction: "medium",
    linked_trades: ["base-meme-basket-2026-06"],
    created_at: ago(5),
  }, `# Base Chain Ecosystem — June 2026

Base hit $18B TVL. Daily active users: 620k (vs OP's 480k, ARB's 890k).
Coinbase's retail push is working — Coinbase Wallet defaults to Base for new users.

**Memecoin dynamic:** BRETT is effectively the OP/ARB of Base memecoins — the
"first mover blue chip." TOSHI has the Coinbase/Brian Armstrong cultural angle.
Neither is going to zero without Base dying, which isn't happening.

Small position sizing appropriate. This is narrative/sentiment, not fundamentals.`)
);

// ---- Skills (more nodes) ----------------------------------------------------

await write(
  "arkive/practices/trading/skills/read-funding-rates.md",
  fm({
    entity_type: "skill",
    practice: "trading",
    version: "1.0.0",
    created_at: ago(30),
    triggered_by: ["arkive/practices/trading/insights/accepted/funding-rate-extremes.md"],
  }, `# Skill: Read Funding Rates for Mean-Reversion Signals

## when_this_applies

User is considering a perp trade, or asks about market positioning.
Funding rates are above +0.06% / 8h (longs paying a lot) or below -0.04% / 8h.

## how_to_act

1. Check the current funding rate on Hyperliquid for the asset.
2. Funding > +0.06%: market is heavily long. Mean reversion risk is elevated.
   If the user is considering a long, size down or wait for rate compression.
3. Funding < -0.04%: market is heavily short. Squeeze risk is elevated.
   Long is higher probability in the short term.
4. Rates between -0.04% and +0.06% are "normal" — no strong lean from funding.
5. Always surface the funding rate in perp trade check-ins, unprompted.`)
);

await write(
  "arkive/practices/trading/skills/l2-tvl-signal.md",
  fm({
    entity_type: "skill",
    practice: "trading",
    version: "1.0.0",
    created_at: ago(4),
    triggered_by: ["arkive/practices/trading/insights/pending/l2-tvl-leads-eth-insight.md"],
    created_from: ["arkive/practices/trading/journal/research/eth-l2-thesis-2026-06.md"],
  }, `# Skill: L2 TVL as ETH Leading Indicator

## when_this_applies

Start of each calendar month, or when the user asks about ETH outlook.

## how_to_act

1. Check aggregate L2 TVL (Arbitrum + Optimism + Base) vs prior month.
2. If growth > 15% MoM: flag as a bullish ETH signal for the next 4-6 weeks.
3. If growth < 5% or negative: flag as a neutral/bearish signal.
4. Surface this in the monthly recap or when ETH comes up in conversation.
5. Cite the specific growth rate, don't just say "TVL is up".`)
);

await write(
  "arkive/practices/trading/skills/size-memecoins.md",
  fm({
    entity_type: "skill",
    practice: "trading",
    version: "1.0.0",
    created_at: ago(50),
    created_from: ["arkive/practices/trading/context/rules.md"],
  }, `# Skill: Sizing Memecoin Positions

## when_this_applies

User is considering a memecoin trade (any chain).

## how_to_act

1. Max position: 2% of total portfolio. Ask for portfolio size if unknown.
2. If the user suggests more than 2%, flag it and ask them to confirm.
3. Never average down on memecoins. Remind the user of this rule if they ask.
4. Suggested split for "basket" approaches: no single coin > 1% of portfolio.
5. Log entry with a clear thesis — even if the thesis is "narrative/sentiment bet".`)
);

// ---- Accepted insights (create accepted/ subfolder nodes) -------------------

await write(
  "arkive/practices/trading/insights/accepted/funding-rate-extremes.md",
  fm({
    entity_type: "insight",
    practice: "trading",
    status: "accepted",
    title: "Extreme funding rates reliably predict short-term mean reversion",
    summary: "Funding > +0.06%/8h = longs at risk. Funding < -0.04%/8h = shorts at risk. Seen in 5 trades.",
    proposed_output: "skill",
    evidence: [
      "arkive/practices/trading/journal/trades/eth-perp-short-2026-04.md",
      "arkive/practices/trading/journal/trades/eth-long-2026-06.md",
    ],
    resulted_in: ["arkive/practices/trading/skills/read-funding-rates.md"],
    created_at: ago(28),
  }, `## Pattern

In 5 instances over the past 6 months, funding rates above +0.06%/8h
preceded a >5% mean-reversion move within 48-72 hours. The April ETH short
was the cleanest example — funding hit +0.09% at entry, covered at +18%.

## Decision

Accepted. Codifying as a skill: "read-funding-rates". Will surface funding
rates in all perp trade check-ins going forward.`)
);

await write(
  "arkive/practices/trading/insights/accepted/no-averaging-memecoins.md",
  fm({
    entity_type: "insight",
    practice: "trading",
    status: "accepted",
    title: "Never average down on memecoins — the rule is strict",
    summary: "PEPE incident + 2 others confirm: averaging memecoins turns losses into bigger losses.",
    proposed_output: "context",
    evidence: [
      "arkive/practices/trading/journal/trades/degen-close-2026-05.md",
    ],
    resulted_in: ["arkive/practices/trading/context/rules.md"],
    created_at: ago(55),
  }, `## Pattern

Three instances of averaging down on memecoins. All three ended worse than
the original stop would have. The PEPE position turned a -15% into a -70%.

## Decision

Accepted. Rule added to context/rules.md. The skill "size-memecoins" also
enforces this. This is a strict rule — no exceptions.`)
);

// ---- One more pending insight ------------------------------------------------

await write(
  "arkive/practices/trading/insights/pending/base-chain-structural-edge.md",
  fm({
    entity_type: "insight",
    practice: "trading",
    status: "pending",
    title: "Base chain has a structural retail adoption edge through Coinbase Wallet",
    summary: "Coinbase Wallet defaulting to Base = sustained retail user inflow. This compounds.",
    proposed_output: "context",
    evidence: [
      "arkive/practices/trading/journal/research/base-ecosystem-2026-06.md",
      "arkive/practices/trading/journal/trades/base-meme-basket-2026-06.md",
    ],
    created_at: ago(2),
  }, `## Pattern

Coinbase Wallet (50M+ downloads) now defaults to Base for new users.
This is a structural distribution advantage no other L2 has. Coinbase
is essentially paying for Base user acquisition through their wallet product.

## Proposed context update

Add to watchlist context: "Base chain memecoins get a structural retail bid
from Coinbase Wallet defaulting to Base. Factor into sizing — they have more
sustained buying pressure than typical L2 memecoins."`)
);

// =============================================================================
// VENTURES practice — deals, investments, startups
// =============================================================================

await write(
  "arkive/practices/ventures/practice.config.md",
  `name: ventures
version: 0.3.0
based_on: arkive-core-v1
description: Angel investments, startup deals, and venture-stage positions.

provides:
  journal_entity_types:
    - name: deal
      folder: deals
      append_only: true
      allowed_mutations:
        status_field:
          - screening_to_dd
          - dd_to_committed
          - committed_to_passed
          - committed_to_closed
        body_appends:
          - update
      schema:
        required:
          - company
          - stage
          - status
          - thesis
        optional:
          - check_size
          - lead
          - round_size
          - valuation
          - sector
    - name: note
      folder: notes
      append_only: true
      schema:
        required:
          - company
          - summary
  context_files:
    - name: portfolio
      path: context/portfolio.md
      update_mode: replace
      description: Current active portfolio positions
    - name: active-deals
      path: context/active-deals.md
      update_mode: replace
      description: Deals currently in pipeline
    - name: theses
      path: context/theses.md
      update_mode: accumulate
      description: Investment theses and sector views

loading:
  default_mode: active
  triggers:
    - startup
    - deal
    - investment
    - founder
    - term sheet
    - dd

insight_flow:
  default_output: ask_user
  evidence_threshold: 3
  rejection_cooldown_threshold: 10
`
);

await write(
  "arkive/practices/ventures/practice.instructions.md",
  fm({
    entity_type: "practice_instructions",
    practice: "ventures",
    created_at: ago(60),
    last_updated: ago(3),
    version: 1,
  }, `# Ventures practice — operational playbook

## What this practice tracks
Angel investments and startup deals. Every deal I screen, DD, commit to, or pass on.
Portfolio positions + theses.

## How to act
- Log every deal introduction as a \`screening\` entry immediately
- When I mention a company, check if we already have a deal entry for it
- Always track check size and round terms when I commit
- Surface portfolio updates when founders send updates

## Anti-patterns
- Don't suggest valuations or term sheet terms — that's my job
- Don't summarize what a company does unless I ask (I know my portfolio)`)
);

// Context files
await write(
  "arkive/practices/ventures/context/portfolio.md",
  fm({
    entity_type: "context",
    practice: "ventures",
    created_at: ago(90),
    last_updated: ago(10),
    version: 1,
  }, `# Active Portfolio

| Company | Stage | Check | Entry Valuation | Status |
|---------|-------|-------|-----------------|--------|
| Meridian Labs | Seed | $25k | $8M post | Active, growing |
| Supastack | Series A | $50k | $22M post | Strong, eyeing Series B |
| Voltform | Pre-seed | $15k | $4M post | Early, needs traction |

Total deployed: $90k across 3 positions.`)
);

await write(
  "arkive/practices/ventures/context/active-deals.md",
  fm({
    entity_type: "context",
    practice: "ventures",
    created_at: ago(90),
    last_updated: ago(1),
    version: 1,
  }, `# Active Pipeline

## Prism AI — in DD
- Stage: Seed | Raise: $3M | Valuation: $12M post
- Sector: AI dev tools (code review automation)
- Intro via: Alex Kim (Supastack CEO)
- Status: Reviewing technical diligence, call with CTO scheduled Thursday

## NeuralGrid — screening
- Stage: Pre-seed | Raise: $1.5M
- Sector: Energy grid optimization with ML
- Cold inbound via AngelList
- Status: Watched demo, interesting but need to understand GTM`)
);

await write(
  "arkive/practices/ventures/context/theses.md",
  fm({
    entity_type: "context",
    practice: "ventures",
    created_at: ago(90),
    last_updated: ago(20),
    version: 1,
  }, `# Investment Theses

## Developer tools infrastructure (HIGH conviction)
The shift to AI-assisted coding creates huge demand for tooling that sits between
the AI and the codebase — code review, testing automation, deployment guardrails.
Early companies here will have strong switching costs.

## Accumulated lessons

**Founder quality > market timing.** Every deal I've seen go sideways had a warning
sign in the founder dynamic. Focus on resilience and coachability.

**Network deals outperform cold inbound.** My two best deals (Meridian, Supastack)
were warm intros from founders I already backed. Cold inbound has a much lower
signal-to-noise ratio.`)
);

// Journal: deals
await write(
  "arkive/practices/ventures/journal/deals/meridian-labs-seed.md",
  fm({
    entity_type: "deal",
    practice: "ventures",
    company: "Meridian Labs",
    stage: "seed",
    status: "closed",
    thesis: "AI-native scientific computing infrastructure. First-mover in LLM + lab workflow integration.",
    check_size: "$25k",
    round_size: "$2.5M",
    valuation: "$8M post",
    created_at: ago(85),
  }, `# Meridian Labs — Seed Investment

Closed $25k into Meridian's seed round at $8M post.

**What they do:** Infrastructure layer for AI-assisted scientific computing.
Labs use their platform to run ML models against experimental data pipelines.
Beta customers include 3 biotech companies and a university research lab.

**Why I invested:**
- Founder (Sarah Chen) previously led ML infrastructure at Genentech — deep domain
- No real competitor in the AI + scientific workflow niche yet
- Sticky product: switching costs are high once pipelines are built on top

**Risks:** Small market initially. Enterprise sales cycle is long.`)
);

await write(
  "arkive/practices/ventures/journal/deals/prism-ai-dd.md",
  fm({
    entity_type: "deal",
    practice: "ventures",
    company: "Prism AI",
    stage: "seed",
    status: "dd",
    thesis: "AI code review that integrates into PR flow. Saves senior eng time on reviews.",
    check_size: "$25k",
    round_size: "$3M",
    valuation: "$12M post",
    created_at: ago(8),
    sources: ["arkive/practices/ventures/context/theses.md"],
  }, `# Prism AI — Due Diligence

In DD for Prism's $3M seed at $12M post.

**What they do:** AI-powered code review that runs on every PR. Catches bugs,
style issues, and security problems before human reviewers. Integrates with GitHub.

**What I've done:**
- Demo call with CEO (Marcus Walsh) — strong product, clear ROI story
- Reference calls with 2 beta customers — both would pay $2k/month/team
- Technical call with CTO scheduled Thursday

**Open questions:**
- How defensible vs GitHub Copilot expanding into review?
- What's the moat once the big players copy the feature?`)
);

await write(
  "arkive/practices/ventures/journal/notes/supastack-q1-update.md",
  fm({
    entity_type: "note",
    practice: "ventures",
    company: "Supastack",
    summary: "Q1 update: ARR doubled to $1.2M, Series B prep underway",
    created_at: ago(30),
  }, `# Supastack — Q1 2026 Update

CEO Alex Kim sent the Q1 update.

**Highlights:**
- ARR: $1.2M (doubled from $600k in Q4 2025)
- Customers: 34 (up from 19)
- Headcount: 12 (added 3 engineers)
- Net revenue retention: 118%

**Series B:** Alex mentioned they're starting to prep for a Series B in Q3,
targeting $15M raise at ~$60M post. Our $50k seed would be 20x on paper if
that round closes at those terms.

**Action:** Warm intro to two Series B leads I know (Benchmark + a16z crypto).`)
);

// Pending insight
await write(
  "arkive/practices/ventures/insights/pending/warm-intros-outperform.md",
  fm({
    entity_type: "insight",
    practice: "ventures",
    status: "pending",
    title: "Warm introductions from portfolio founders outperform cold inbound by 3x+",
    summary: "Meridian and Supastack (both warm) are 2/2 on strong outcomes. 0/3 cold inbound deals survived screening.",
    proposed_output: "context",
    evidence: [
      "arkive/practices/ventures/journal/deals/meridian-labs-seed.md",
      "arkive/practices/ventures/journal/notes/supastack-q1-update.md",
    ],
    created_at: ago(5),
  }, `## Pattern

Warm intro deals from portfolio founders: 2/2 progressed past screening and
1 has strong early traction. Cold inbound deals: 0/3 made it past the first call.

The signal quality difference is massive — founders I've already backed have
skin in the game when they make an intro. Cold inbound is noisy.

## Proposed rule to add to theses.md

"Prioritize warm intro deals from portfolio founders above all else.
Time-box cold inbound screening to 30 minutes. Be comfortable saying no faster."`)
);

// =============================================================================
// LEARNING practice — books, courses, notes
// =============================================================================

await write(
  "arkive/practices/learning/practice.config.md",
  `name: learning
version: 0.2.0
based_on: arkive-core-v1
description: Books, courses, and knowledge accumulation. What I'm reading and what I'm retaining.

provides:
  journal_entity_types:
    - name: book
      folder: books
      append_only: true
      allowed_mutations:
        status_field:
          - reading_to_finished
          - reading_to_paused
        body_appends:
          - notes
      schema:
        required:
          - title
          - author
          - status
        optional:
          - genre
          - source
          - linked_practices
    - name: course
      folder: courses
      append_only: true
      schema:
        required:
          - title
          - provider
          - status
        optional:
          - linked_practices
  context_files:
    - name: reading-list
      path: context/reading-list.md
      update_mode: replace
      description: What I want to read next
    - name: retained-knowledge
      path: context/retained-knowledge.md
      update_mode: accumulate
      description: Key insights I've retained from reading

loading:
  default_mode: on_demand
  triggers:
    - book
    - reading
    - learning
    - course

insight_flow:
  default_output: ask_user
  evidence_threshold: 5
  rejection_cooldown_threshold: 20
`
);

await write(
  "arkive/practices/learning/practice.instructions.md",
  fm({
    entity_type: "practice_instructions",
    practice: "learning",
    created_at: ago(45),
    last_updated: ago(7),
    version: 1,
  }, `# Learning practice — operational playbook

## What this practice tracks
Books I'm reading, courses I'm taking, and knowledge I want to retain.

## How to act
- Log a book entry when I mention starting a new book
- Add to retained-knowledge only when I explicitly say something stuck
- Don't ask about books unprompted — this is low-priority background tracking

## Anti-patterns
- Don't summarize books I'm reading back at me
- Don't suggest books unless I ask`)
);

await write(
  "arkive/practices/learning/context/reading-list.md",
  fm({
    entity_type: "context",
    practice: "learning",
    created_at: ago(45),
    last_updated: ago(3),
    version: 1,
  }, `# Reading List

## Currently reading
- *Zero to One* — Peter Thiel (linked to ventures practice)
- *The Almanack of Naval Ravikant* — Eric Jorgenson

## Up next
- *Thinking in Bets* — Annie Duke (probability + decision making)
- *Flash Boys* — Michael Lewis (market structure)
- *The Psychology of Money* — Morgan Housel

## Finished recently
- *The Intelligent Investor* — Benjamin Graham ✓
- *Principles* — Ray Dalio ✓`)
);

await write(
  "arkive/practices/learning/context/retained-knowledge.md",
  fm({
    entity_type: "context",
    practice: "learning",
    created_at: ago(45),
    last_updated: ago(7),
    version: 1,
  }, `# Retained Knowledge

## From The Intelligent Investor (Graham)

**Mr. Market is a mood, not a signal.** Price and value diverge constantly.
Your job is to buy value when Mr. Market is pessimistic and be patient.

**Margin of safety is the most important concept.** Never buy without one.
In crypto terms: don't enter positions without a clear stop that you'll actually honor.

## From Principles (Dalio)

**Pain + Reflection = Progress.** Every losing trade is data if I actually reflect.
The trading rules context file is my attempt to implement this.

**Believability-weighted decisions.** When someone with better track record says
something different than me, weight their view more heavily.`)
);

// Journal: books
await write(
  "arkive/practices/learning/journal/books/zero-to-one.md",
  fm({
    entity_type: "book",
    practice: "learning",
    title: "Zero to One",
    author: "Peter Thiel",
    status: "reading",
    genre: "business",
    linked_practices: ["ventures"],
    created_at: ago(10),
    sources: ["arkive/practices/ventures/context/theses.md"],
  }, `# Zero to One — Peter Thiel

Started reading because it kept coming up in founder conversations.
Thiel's thesis: competition is for losers. Monopolies are what create value.

**Notes so far:**
- The best businesses create something new (0→1), not copy something (1→n)
- Secrets: what important truth do very few people agree with you on?
- Founders need to be contrarian AND right — hard, rare combination

**Connection to ventures:** The "what important truth do very few agree with"
framework is exactly the question I should be asking founders in DD.`)
);

await write(
  "arkive/practices/learning/journal/books/intelligent-investor.md",
  fm({
    entity_type: "book",
    practice: "learning",
    title: "The Intelligent Investor",
    author: "Benjamin Graham",
    status: "finished",
    genre: "finance",
    linked_practices: ["trading"],
    created_at: ago(60),
    resulted_in: ["arkive/practices/learning/context/retained-knowledge.md"],
  }, `# The Intelligent Investor — Benjamin Graham

Finished. Dense but worth it.

**Key takeaways relevant to my trading:**
1. Distinguish speculation from investment. Most of my "trades" are speculation.
   That's fine as long as I'm honest about it and size accordingly.
2. Mr. Market metaphor. Price is not value. I should be happy when prices drop
   on things I want to buy, not scared.
3. Margin of safety applies to crypto too — enter with room to be wrong.`)
);

await write(
  "arkive/practices/learning/journal/courses/defi-deep-dive-2026.md",
  fm({
    entity_type: "course",
    practice: "learning",
    title: "DeFi Deep Dive: AMMs, Lending, and Perps",
    provider: "Bankless Academy",
    status: "finished",
    linked_practices: ["trading"],
    created_at: ago(90),
  }, `# DeFi Deep Dive — Bankless Academy

Completed this course in March 2026. Covered:
- AMM mechanics (constant product, concentrated liquidity)
- Lending protocols (Aave, Compound, how liquidations work)
- Perp mechanics (funding rates, mark price, index price)

**Most valuable:** The perps section. Understanding that funding rates are a
market-sentiment signal (not just a cost) changed how I read them.
This directly informed the funding rate extremes insight.`)
);

// =============================================================================
// More stream observations (fills out stream/ folder)
// =============================================================================

const moreObs = [
  {
    name: "obs-pendle-v3-launch",
    days: 20, hours: 4,
    meta: { kind: "market_observation", mentions: ["PENDLE"], routed_to: "trading" },
    body: "Pendle V3 launched today. New AMM design with much better capital efficiency for principal tokens. New pools already: ezETH, weETH, rsETH. TVL jumped 15% in 24 hours.",
  },
  {
    name: "obs-op-superchain-delay",
    days: 36,
    meta: { kind: "market_observation", mentions: ["OP", "Superchain"], routed_to: "trading" },
    body: "Superchain launch delayed 6 weeks due to audit findings. OP price dropped 9% on the news. Stopped out of my OP position. The thesis was right but timeline was wrong.",
  },
  {
    name: "obs-meridian-hiring",
    days: 14,
    meta: { kind: "company_update", mentions: ["Meridian Labs"], routed_to: "ventures" },
    body: "Sarah (Meridian CEO) posted they're hiring 2 ML engineers. Growing faster than expected. A good sign — they're building team ahead of contracts, which means they have conviction in near-term pipeline.",
  },
  {
    name: "obs-eth-etf-record",
    days: 9, hours: 2,
    meta: { kind: "market_observation", mentions: ["ETH", "ETF"] },
    body: "ETH ETF inflows hit a single-day record: $340M. BlackRock's ETHA alone took in $220M. This is institutional accumulation, not retail. Bullish for ETH medium term.",
  },
  {
    name: "obs-prism-cto-call",
    days: 2,
    meta: { kind: "deal_note", mentions: ["Prism AI"], routed_to: "ventures" },
    body: "CTO call for Prism AI went well. Their moat is the proprietary code graph they build per repo — not just a GPT wrapper. Takes 20-30 minutes to bootstrap but then reviews are much more context-aware. GitHub Copilot doesn't have this today.",
  },
  {
    name: "obs-base-users-ath",
    days: 3,
    meta: { kind: "market_observation", mentions: ["Base", "BRETT", "TOSHI"], routed_to: "trading" },
    body: "Base hit 620k DAU — new ATH. The Coinbase Wallet integration is clearly driving this. Memecoin trading volume on Aerodrome up 3x week-over-week.",
  },
];

for (const obs of moreObs) {
  const iso = new Date(Date.now() - ((obs.days * 86400) + (obs.hours ?? 0) * 3600) * 1000).toISOString();
  const safeStamp = iso.replace(/[:.]/g, "-");
  const month = iso.slice(0, 7);
  const metaLines = Object.entries(obs.meta)
    .map(([k, v]) => Array.isArray(v) ? `${k}:\n${v.map(i => `  - ${i}`).join("\n")}` : `${k}: ${v}`)
    .join("\n");
  await write(
    `arkive/stream/${month}/${safeStamp}-${obs.name}.md`,
    `---\nentity_type: observation\npractice: core\ncreated_at: ${iso}\n${metaLines}\n---\n\n${obs.body}`
  );
}

// =============================================================================
// Update arkive.config to register the new practices
// =============================================================================

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
  ventures:
    enabled: true
    mode: active
    version: 0.3.0
  learning:
    enabled: true
    mode: on_demand
    version: 0.2.0

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

// =============================================================================
// Done
// =============================================================================

console.log(`
Done. Extra seed data written.

  Trading : +4 trades, +3 research, +3 skills, +2 accepted insights, +2 pending insights
  Ventures: new practice — 2 deals, 3 context files, 1 insight
  Learning: new practice — 2 books, 1 course, 2 context files
  Stream  : +6 observations
  Config  : updated to register ventures + learning

Graph should now have 50+ nodes and 15+ cross-file edges.

TO UNDO: rm -rf .arkive/
`);
