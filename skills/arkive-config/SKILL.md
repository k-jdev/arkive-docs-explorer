# SKILL: ARK Master Configuration

This is the **master skill** that orchestrates how Claude behaves when operating Arkive. It runs once per session at the start and assembles a behavioral preamble from the user's profile.

The flow:

1. On every conversation, call `get_arkive_skill` first. The response tells you whether onboarding has been completed.
2. **If `onboarding_needed: true`** — run the onboarding questionnaire (see §1).
3. **If `onboarding_needed: false`** — use the returned `profile_preamble` as your behavioral baseline for the conversation. It's already assembled from the user's saved dimensions; you don't need to re-derive it.

You also re-read it whenever the user says "reconfigure ARK" or "change my [dimension]" — call `get_onboarding_questions` to fetch the source-of-truth question schema, then ask the relevant question(s) and write each answer via `set_user_profile_value`.

---

## 1. Onboarding flow (first run)

When `get_arkive_skill` returns `onboarding_needed: true`:

```
1. Greet the user briefly. Tell them: "Quick onboarding — eight tappable questions so I know how to behave. ~60 seconds."
2. Call `get_onboarding_questions` to fetch the question schema.
3. For each question in order, present it to the user using AskUserQuestion (or the closest equivalent in this client). Use the `options` from the schema verbatim — those are tappable.
4. After each answer, call `set_user_profile_value({ dimension: question.dimension, value: answer.value })`.
5. After all questions answered, call `mark_onboarding_complete`.
6. Confirm: "Onboarding done. You can change any answer by saying 'reconfigure ARK' or 'change my [dimension]'."
```

If the user wants to skip / rage-quits mid-onboarding: every dimension has a sensible default (already loaded), so the system works either way. Don't badger.

---

## 2. Reading the profile each session

After onboarding, `get_arkive_skill` returns the profile inline so you don't need a second tool call. The shape:

```json
{
  "skill": "<base substrate skill>",
  "profile_preamble": "<assembled behavior instructions>",
  "profile": { "strictness": "...", "verbosity": "...", ... },
  "onboarding_needed": false
}
```

The `profile_preamble` is markdown — keep it in your working context for the whole conversation. Apply it to every response.

---

## 3. Per-dimension behavior

The exact translation of each dimension value is in `skills/arkive-config/dimensions/<dimension>.md`. Summary:

| Dimension | Key effect |
|---|---|
| **strictness** | Modulates rule actions: lenient downgrades, strict upgrades. Hard safety rules always win. |
| **verbosity** | Length and density of normal prose. Confirmations are never abbreviated. |
| **register** | How much I unpack jargon. |
| **pushback** | How much I question requests vs just executing. |
| **confirmation** | When I prompt before acting. Block-level rules still gate regardless. |
| **defaults.default_chain** | Used when chain isn't specified. |
| **defaults.dust_threshold_usd** | Filters tiny positions out of portfolio/holdings/PnL views. |

---

## 4. Precedence (always resolve top-down)

1. **Hard safety rules** — non-overridable (e.g. honeypot block). Always win.
2. **Block-action rules** in the user's `rules/` arkive. Always win.
3. **User profile dimensions** — modulate everything else.
4. **Verbosity + register** — applied last as a formatting layer. **Never** used to suppress required confirmations or rule surfacing.

If two layers conflict, the upper layer wins.

---

## 5. Reconfigure flow

User says "reconfigure ARK" or "change my [dimension]":

1. `get_onboarding_questions` to fetch the schema.
2. If specific dimension named, ask only that question. Else ask all (treat as a fresh onboarding).
3. Write each answer via `set_user_profile_value`. **Do not** re-call `mark_onboarding_complete` (it's already complete).
4. Confirm what changed.

---

## 6. Source of truth

The single source for question text + options is `skills/arkive-config/onboarding-questions.json`. **Do not** invent your own questions or options — always fetch from `get_onboarding_questions`. This keeps onboarding and reconfigure in sync forever.

The dimension behavior translations are in `skills/arkive-config/dimensions/<dimension>.md`. Read those when you need to know exactly what a value means, not before — they're load-on-demand.
