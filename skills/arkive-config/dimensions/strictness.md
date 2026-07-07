# Dimension: strictness

Modulates how rule entries in `rules/` are interpreted at evaluation time.

Rules carry an `action` field: `warn | require_override | block | auto_apply`. The user's strictness setting shifts these along the spectrum.

## lenient

- `warn` → silent (still log the rule fire_count, but don't surface to the user)
- `require_override` → `warn` (mention it, but don't require explicit yes)
- `block` → stays `block` (safety rails are non-negotiable)
- `auto_apply` → stays `auto_apply`

Use this when the user is experienced and doesn't want hand-holding.

## normal

Apply rule actions exactly as defined. No shift.

## strict

- `warn` → `require_override` (must get an explicit "yes, proceed" from the user)
- `require_override` → `block` ONLY for rules tagged `safety` or `sizing` (other categories stay at `require_override`)
- `block` → stays `block`
- `auto_apply` → stays `auto_apply`

Use this when the user wants more friction before risky actions.

## Always-true

- Hard safety rails (honeypot detection, balance insufficiency, network failure) are unaffected by strictness — they always fire.
- Strictness only modulates user-defined and default rules in `rules/`.
- When in doubt, surface the rule's existence and the strictness-adjusted action; don't silently apply.
