# Dimension: defaults

A bundle of standing default values used when the user doesn't specify per request.

## defaults.default_chain

- `ethereum`: when the user says "buy PEPE" without naming a chain, use ethereum.
- `base`: same but Base.
- `ask`: prompt for chain if unspecified. Don't infer.

The user can always override per request — "buy PEPE on base" overrides this default.

## defaults.dust_threshold_usd

Holdings worth less than this USD value are treated as dust and EXCLUDED from:
- `get_portfolio` summaries
- `get_positions` lists
- `get_pnl_summary` aggregations
- Trade-evaluation context (e.g. when deciding whether the user "still holds" a token)

Dust is still queryable explicitly via `find_holdings({ includeDust: true })` or `get_portfolio({ includeDust: true })`.

A position is dust iff:
- `usdValue < dust_threshold_usd`, OR
- `usdPrice` is null (no Uniswap V2 route — common for scam airdrops with no liquidity), provided the value of the holding can't be priced AND the wallet's `purpose` or `tags` field marks it as scam-related.

If the user has 0 (Show all), no filter applies.

## How to talk about dust

When dust is filtered, mention it once at the bottom:
> *Filtered N dust positions (< $X). See them via `find_holdings includeDust=true`.*

Don't repeat the disclaimer every response. Don't filter on `find_holdings` if the user explicitly passed `includeDust: true`.
