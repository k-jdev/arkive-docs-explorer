# SKILL: Arkive Usage

This skill teaches you (Claude) how to use the Arkive system correctly. **Read this in full before any arkive read or write.** Without it you will misuse the substrate and your interactions will be inconsistent across sessions.

The MCP server's `instructions` field directs you here. The `get_arkive_skill` tool returns this content. Re-read on first arkive interaction in every new conversation — Claude Desktop does not pre-load this.

---

## 1. Mental model

Arkive is a **layered behavioral substrate**, not a diary. Five layers, **one-way data flow**, with **automatic compaction** at the top:

```
        rules/           ← enforced behavior (machine-evaluable)
          ↑
        journal/         ← interpretation (free-form, human-authored)
          ↑
        recaps/          ← derived summaries (sessions → daily → weekly → monthly cascade)
          ↑
        activity/        ← ephemeral atomic action log (auto-compacted into recaps)
          ↑
        evidence/        ← immutable facts (trades only; never compacted)
```

**Higher layers consult lower layers at action time. Lower layers never read higher ones.**

- **`evidence/`** is the source of truth — but ONLY for trades (on-chain facts). Path: `evidence/trades/<txHash>`. Never deleted, never compacted. System-written.
- **`activity/`** is the working buffer — every meaningful action (safety scans, swap queued/approved/rejected/failed, wallet onboarded, profile changed, etc.) lands here as an "atom." Path: `activity/<YYYY-MM-DD>/<slug>`. Atoms are EPHEMERAL — they get rolled into session summaries when their session closes (30 min of no activity, OR a definitive outcome).
- **`recaps/`** is the durable summary cascade. After atoms close, you get session summaries at `recaps/sessions/<YYYY-MM-DD>/<slug>`. After 30 days, sessions roll into `recaps/daily/<date>`. After 90, daily → weekly. After 365, weekly → monthly. Each rollup deletes the level below it.
- **`journal/`** is for user/Claude interpretation — postmortems, theses, lessons. Free-form markdown with linked_refs to evidence/sessions.
- **`rules/`** is structured config that gates actions. Each rule has `condition` (machine-evaluable) and `action` (warn / block / require_override / auto_apply).

Cross-cutting:
- **`research/`** — per-token deep dives (`research/<token_address>`). User + Claude write.
- **`watchlist/`** — tokens being monitored, references `research/` entries.
- **`config/user-profile/<dim>`** — your behavior profile (strictness, verbosity, etc).
- **`patterns/`** — reserved for the Phase 2 detector engine. Currently inactive.

**Events folded into activity:** there is no separate `events/` arkive. "Events" are activity entries (or session summaries) with `severity: warn` or `critical`. Filter by severity when querying.

---

## 2. Decision tree: where does this belong?

When you have something to write, route it correctly:

| You're recording... | Where it goes | Notes |
|---|---|---|
| A trade just executed | (already auto-written) `evidence/spot-uniswap/trades/<txHash>` | You don't write this. The pending route does. |
| A user-stated fact about themselves | `journal/` if reflection; `rules/` if it constrains behavior | "I never sell at a loss" → rule. "I'm bullish on memes this month" → journal. |
| A user preference/default | `rules/global/` or `rules/{venue}/` | Structured rule, not free-form. Default slippage, max trade size, etc. |
| User reflection on a trade | `journal/` | Don't duplicate the trade data — link to it. |
| A behavioral pattern you noticed | `patterns/{venue}/{pattern_id}` + emit `events/` if threshold | Pattern detection auto-runs in Phase 2; for now, propose to user. |
| Auto-generated daily summary | (auto-regenerated) `recaps/{venue}/daily/<date>` | You don't hand-edit this. |
| A discrete flagged moment | `events/` (or `events/{venue}/`) | Severity: info / warn / critical. |
| Per-token thesis / safety / conviction | `research/{venue}/{token_address}` | Structured: thesis, conviction (1-5), entry/exit plan. |
| A token to watch | `watchlist/{slug}` with `research_ref` pointing at the research entry | Don't duplicate research data. |

**The recurring mistake to avoid:** stuffing everything into "journal" or "preferences." Every entry has a correct home — pick it consciously.

---

## 3. Sub-foldering and venue scoping

**Principle: scope when semantics differ, not when values differ.**

- `evidence/spot-uniswap/trades/` — semantics differ from `evidence/perps-hyperliquid/trades/` (perps will have funding, liquidations, etc that spot doesn't).
- `rules/global/max-trade-usd` — applies regardless of venue.
- `rules/spot-uniswap/safety-scan-required` — only applies to spot.
- `rules/per-wallet/{wallet_id}/cold-storage-no-swaps` — applies only to a specific wallet.
- `journal/` is **root-only**. The user thinks across venues; their reflections aren't venue-scoped.
- `watchlist/` is **root-only**. A token is on the watchlist regardless of how you'd trade it; the `target_venue` field captures intent.

**Today the only venue is `spot-uniswap`.** When `perps-hyperliquid` lands, it drops into the same sub-folder pattern — no refactor.

**Path format:** `<arkive>/<subpath>/<slug>` where `<subpath>` is one or more segments. Slugs are kebab-case. For dated entries, prefix with date for chronological sort: `2026-05-15-flip-flop-postmortem`.

---

## 4. Read patterns before action

**Before every action, consult relevant layers.** Codifying this so you don't have to remember:

### Before `request_swap`
1. `query_entries({ pathPrefix: "rules/global" })` and `query_entries({ pathPrefix: "rules/spot-uniswap" })` and (if you know the wallet id) `query_entries({ pathPrefix: "rules/per-wallet/{wallet_id}" })`.
2. Evaluate each rule's `condition` against the swap params. Surface every `warn`/`require_override` to the user. **Refuse to call `request_swap`** if a `block` rule matches.
3. `query_entries({ pathPrefix: "research/spot", linkedToken: "<symbol-or-address>" })` to check existing research on the token.
4. `query_entries({ pathPrefix: "watchlist", linkedToken: "<symbol-or-address>" })` to check the user's watchlist.
5. `query_entries({ pathPrefix: "patterns/spot-uniswap", text: "<symbol>" })` if any patterns reference this token.

### Before discussing a token
1. `read_arkive_entry({ path: "research/spot/{token_address}" })` — if it exists, you have prior context.
2. `query_entries({ pathPrefix: "events", linkedToken: ..., sinceIso: "<7d ago>" })` — recent events involving this token.

### Before commenting on user behavior
1. `query_entries({ pathPrefix: "patterns/spot-uniswap" })` — has anything already been detected?
2. `query_entries({ pathPrefix: "events", sinceIso: "<7d ago>", severity: "warn" })` — recent flags.

### When the user asks "what did I do this week?"
1. `query_entries({ pathPrefix: "recaps/spot-uniswap/daily", sinceIso: "<7d ago>" })` first — cheap.
2. Only fall back to `query_entries({ pathPrefix: "evidence/spot-uniswap/trades", sinceIso: "<7d ago>" })` if you need raw trade detail.

### When the user asks "what's my edge?" / "what's my pattern?"
1. `query_entries({ pathPrefix: "patterns/spot-uniswap" })` — these are pre-computed signals.
2. Then `query_entries({ pathPrefix: "evidence/spot-uniswap/trades" })` and aggregate by tags / outcomes.

---

## 5. Write rules (and forbidden writes)

| Arkive | You can write? | Notes |
|---|---|---|
| `evidence/` | ❌ Never | System-only. Trade evidence is auto-written from the pending route. |
| `activity/` | ❌ Never | System-only. Action handlers auto-log atoms. You don't need to touch this. |
| `recaps/` | ❌ Never | Auto-derived from activity. Cascade is automatic. To comment on a day, write to `journal/` and link the recap path. |
| `patterns/` | ❌ Never (Phase 2: detector engine writes) | Currently inactive. If you spot a pattern, propose creating a detector — the user approves. |
| `journal/` | ✅ With `author=claude` | Postmortems, theses, observations. **Always include `linked_refs`** to trades/tokens/wallets so it's queryable. |
| `rules/` | ✅ — but PROPOSE before writing | A new rule changes future behavior. Always summarize the rule and confirm with the user before calling `write_arkive_entry`. Include `origin` linking to the journal entry or event that spawned it. |
| `research/` | ✅ | Structured — fill `extraMeta` with `identity`, `thesis`, `conviction`, `entry_plan`, `exit_plan`, `research_status`. |
| `watchlist/` | ✅ | Set `target_venue` and `research_ref`. Don't duplicate research data. |

---

## 6. Naming conventions

- **Path shape:** `{arkive}/{venue?}/{subpath?}/{slug}` — no `.md` extension in tool calls.
- **Slugs:** kebab-case. Lowercase. ASCII-safe. Allowed chars: `a-z 0-9 - _ .`
- **Dated entries:** prefix with `YYYY-MM-DD-` so they sort chronologically. Example: `journal/2026-05-15-flip-flop-postmortem`.
- **Same-day disambiguation:** add a time or counter. `events/spot-uniswap/2026-05-15-143000-swap-failed-pepe-slippage` is generated automatically by `emit_event`; for journal entries make it descriptive: `2026-05-15-pepe-postmortem` and `2026-05-15-eth-thesis`.
- **Token entries** (research, sometimes events): use the **address** as the slug — `research/spot/0xa776a95223c500e81cb0937b291140ff550ac3e4`. Symbols collide; addresses don't.
- **Wallet entries:** use the wallet `id` (UUID from `list_wallets`), not the address.

---

## 7. Metadata fields per arkive

Every entry MUST have these standard fields (set automatically by the tools, but you should know them):

```yaml
created_at: ISO       # set on first write
updated_at: ISO       # set on every write
venue: string|null    # null = venue-agnostic
linked_refs: []       # cross-references — see ref shapes below
tags: []              # for filtering
author: claude|user|system
title: string         # human-readable
```

**LinkedRef shapes** (use the right one — Phase 2 walks the link graph):
```
{ type: "trade",   id: "<uuid>" }
{ type: "token",   address: "0x...", symbol?: "...", chain?: "ethereum" }
{ type: "wallet",  id?: "<uuid>", address?: "0x..." }
{ type: "tx",      chain: "ethereum", hash: "0x..." }
{ type: "arkive",  path: "<arkive>/<subpath>" }   # link to another entry
{ type: "rule",    rule_id: "..." }
{ type: "pattern", pattern_id: "..." }
{ type: "event",   path: "events/..." }
```

**Type-specific extra fields** (pass via `extraMeta`):

- `rules/`: `rule_id`, `category`, `trigger` (e.g. `"before:request_swap"`), `condition` (JSON), `action` (`warn`|`block`|`require_override`|`auto_apply`), `origin` (linkedRef), `fire_count` (start at 0), `last_fired` (null), `status` (`active`|`muted`|`retired`).
- `research/`: `identity` (`{name,symbol,address,chain}`), `thesis`, `conviction` (1-5), `entry_plan`, `exit_plan`, `research_status` (`watching`|`buying`|`holding`|`exited`|`abandoned`).
- `watchlist/`: `target_venue`, `research_ref` (path to research entry), `status` (`watching`|`ready`|`exited`).
- `events/` (set automatically by `emit_event`): `event_type`, `severity`, `occurred_at`.

---

## 8. Common query patterns

| User question | Canonical query |
|---|---|
| "What's my PnL this week?" | `get_pnl_summary` (already aggregates from evidence). For per-day: `query_entries({ pathPrefix: "recaps/spot-uniswap/daily", sinceIso: "<7d ago>" })` |
| "What did I trade today?" | `query_entries({ pathPrefix: "evidence/spot-uniswap/trades", sinceIso: "<today>" })` |
| "Have I traded GRAY before?" | `query_entries({ pathPrefix: "evidence/spot-uniswap/trades", linkedToken: "GRAY" })` |
| "What's my thesis on PEPE?" | `read_arkive_entry({ path: "research/spot/0x6982508145454Ce325dDbE47a25d4ec3d2311933" })` |
| "What rules apply to this swap?" | `query_entries({ pathPrefix: "rules", venue: "spot-uniswap" })` + `query_entries({ pathPrefix: "rules/global" })` |
| "Why does this rule exist?" | Read the rule → look at its `origin` field → fetch that linkedRef. |
| "What went wrong this week?" | `query_entries({ pathPrefix: "recaps/sessions", tags: ["session"], sinceIso: "<7d ago>" })` then filter by `outcome: failed` or `severity: warn` |
| "Did anything weird happen with this wallet?" | `query_entries({ pathPrefix: "recaps/sessions", linkedWallet: "<id>" })` |
| "What was I doing 20 min ago?" | `list_entries({ pathPrefix: "activity/<today>" })` — atoms that haven't compacted yet |
| "Show me yesterday's sessions" | `list_entries({ pathPrefix: "recaps/sessions/<yesterday>" })` |
| "What patterns am I exhibiting?" | `query_entries({ pathPrefix: "patterns/spot-uniswap" })` |

**Always prefer filtered queries over reading everything.** If you find yourself fetching an entire arkive when a `linkedToken` filter would do, you're doing it wrong.

---

## 9. Anti-patterns (things to NOT do)

- ❌ **Pasting trade data into a recap or journal entry.** Reference by `linked_refs` instead. The trade evidence is the source of truth; if it's corrected, only that one place changes.
- ❌ **Writing the same observation into journal AND patterns.** Journal is interpretation; patterns are detected facts. One observation belongs to one layer.
- ❌ **Creating a new rule without an `origin` linkedRef.** Rules without provenance rot — no one remembers why they exist. Always link to the journal entry / event that spawned the rule.
- ❌ **Reading the entire arkives directory when a filter would do.** Use `query_entries` with the narrowest `pathPrefix` and the filters you actually need.
- ❌ **Hand-editing recaps.** They regenerate from evidence (Phase 2). Your edits will be wiped. Write to `journal/` to comment on a day.
- ❌ **Writing to `evidence/`.** System-only. If you think evidence is wrong, that's a bug — surface it; don't patch around it.
- ❌ **Stuffing structured data in body text.** If a thesis has a conviction score, put it in `extraMeta.conviction` (queryable), not in prose like "I'm 4/5 confident".
- ❌ **Hardcoding `spot-uniswap` in user-facing language as if it's the only venue.** It's the only venue *today*. Talk about "this venue" or "the spot venue", not "the venue".

---

## 10. Self-check before responding

Before responding to any user message that involves trading or behavior, run this check:

- [ ] Did I check `rules/` for relevant constraints? (Especially before `request_swap`.)
- [ ] Did I check `patterns/` for already-detected behavioral signals? (Before commenting on user behavior.)
- [ ] Did I check `events/` for recent flagged moments in the time window of interest?
- [ ] Did I check `research/` for prior context on the token in question?
- [ ] Am I about to write something that should be auto-generated (recaps, evidence)? If so, **stop**.
- [ ] If I'm writing a journal entry: did I include `linked_refs` so it's queryable later?
- [ ] If I'm proposing a rule: did I confirm with the user AND include `origin`?

---

## 11. Phase 1 limitations (current state)

The substrate is fully scaffolded but some hooks are advisory rather than enforcing:

- **Rule evaluation is advisory in Phase 1.** Rules exist as data with structured `condition` fields, but the server doesn't auto-evaluate them before `request_swap` yet. **You must call `query_entries({ pathPrefix: "rules" })` yourself** and surface relevant rules to the user. Phase 2 wires this into the route.
- **Pattern detection is not yet running.** `patterns/` is registered but no detector engine yet. If you spot a pattern, propose it to the user; don't auto-create.
- **Recap regeneration is partial.** The pending route appends a one-line pointer to today's recap on each trade. Full daily/weekly aggregation comes in Phase 2.
- **Lifecycle prompts not yet active.** Rules with high `fire_count` or zero `fire_count` over time don't yet surface for review. Coming in Phase 2.

These are deliberate Phase 1 deferrals, not bugs. The substrate is correctly shaped — the wiring is the next layer.

---

## 12. Migration note

On first arkive interaction in a new install, the system runs a one-shot migration from the v1 flat structure to the v2 layered structure:
- `trades.json` → `evidence/spot-uniswap/trades/<txHash>`
- old `trading-recaps/` → `recaps/spot-uniswap/daily/`
- old `risk-events/` → `events/spot-uniswap/`
- old `preferences/` → `journal/preferences-*` flagged with `tags: [migrated, needs-parsing]` (Phase 2 will parse these into structured rules)
- old `journal/`, `research/`, `watchlist/` → moved to new structure with metadata

The marker `journal/.migration-marker-v1` prevents re-migration. Old files are not deleted — safe to roll back.

If you see entries tagged `migrated` or `needs-parsing`, treat them as candidates for restructuring with the user when convenient.
