# Daydream — Deferred Items, Blockers & Next Steps (durable backlog)

The fuller record behind `SESSION_STATE.md`. What's parked, what blocks hosting,
and what to do next. Pair with `SESSION_STATE.md` (the point-in-time handoff).

**As of:** branch `daydream-real-run-test`, HEAD `9fba402` + this commit · 2026-06-17.

---

## 1. Pre-hosting blockers (NOT Daydream — the trading layer)

The Daydream engine + UI and the whole arkive substrate are multi-tenant-safe
(session-gated, `currentUserId`-scoped, storage-adapter only). The blocker is the
**single-user trading layer**. Full detail + severities in
[`HOSTING_READINESS.md`](HOSTING_READINESS.md); the headline P0s:

- **`POST /api/pending/[id]`** approves + signs with **no auth / no ownership
  check**, using a process-global decrypted key → any authenticated tenant could
  execute another tenant's transaction. (Highest severity.)
- **Custodial keys in shared process memory** (`state.ts` global `unlocked` map);
  custodial keystore is the trust model.
- **`user-profile.ts` cache not keyed by user** → cross-tenant profile/confirm-policy leak.

None of these touch Daydream. They must be resolved before any shared hosted deploy.

---

## 2. Deferred features (intentionally not built)

From the UI scope §7 and engine scope §8:

- **Dismiss/pin a Notice** — a third gesture + write path; CP2 kept Notices read-only.
- **Real scheduler / cron / worker** — the engine exposes the manual run route +
  a `daydream_frequency` setting; wiring a timer to a deployment is deferred.
- **Durable feedback learner** — `reason_type` + loop reasoning are *captured* on
  insights but no code aggregates them across runs yet (in-context only).
- **Notice-reaction analytics**, **triggered runs** (run-on-N-new-observations),
  **mobile/responsive polish** beyond the existing workspace.
- **Atomic skill re-versioning (known issue).** `projectSkill` in
  `src/lib/arkive-v2/project-insight.ts` re-versions a skill non-atomically:
  archive old → delete active → write new, with **no rollback**. If the delete
  or the new-write fails mid-sequence, the practice can be left with **no active
  skill** (old version only in `skills/_archive/`), and `decide_insight`'s
  try/catch swallows it into a `projected.error` note rather than surfacing it
  loudly. Low-risk on local single-user filesystem storage; matters on
  real/multi-user/remote storage. Make it atomic (write-new-then-swap, or a
  storage-level transaction) before hosted deploy.

---

## 3. Open threads (parked — context for future work)

1. **Structure-population gap ("librarian" work) — largely CLOSED.** Accepting an
   insight now projects into per-practice `skills/` + `context/` (shared
   `project-insight.ts`), and new practices get real `context/` homes via the `§2.1`
   setup flow + authored templates (see §5). So `context/`/`skills/` *do* populate
   now — through the accept gate. **Remaining:** automatic `journal/` projection and
   the **emergence path** (structure populated from accreted observations without a
   setup conversation). The daydream store → in-chat memory link (item 3) is still
   separate.
2. **Cross-practice insight routing.** A daydream tagged `[health, freelance]` that
   graduates to a proposal — *which* practice's `insights/pending/` (and ultimately
   skills/context) does it write to? Today `proposeInsight` takes a single
   `practice`. Cross-cutting insights have no clear home. **Observed live in the
   calibration matrix:** a `[workshop, money]` daydream proposed and the engine
   wrote it to `workshop` only — the model self-selected one `implies_insight.practice`,
   the other tag was **silently dropped (no error, no fan-out)**. The richest
   cross-cuts (`[sleep, trading]`, `[running, ward]`) surfaced but never proposed,
   so the dilemma is mostly sidestepped. Still **open** — flagged, not solved.
3. **Unified in-chat + autonomous loop memory.** The in-chat MCP loop can't yet
   see or feed the daydream store; the two loops are separate. Connects to (1) —
   the in-chat loop is the natural "librarian."
4. **Propose-threshold calibration** — **done** (0.8→0.6, see §4 and
   `DAYDREAM_CALIBRATION_MATRIX.md`). The follow-on "levers not labels" bias (the
   loop only proposed prescriptive `skill` insights, withholding diagnostic
   `context` ones) was a soft **prompt** bias — now **fixed**: both the daydream
   system prompt and the shared `propose_insight` tool description invite BOTH
   types, weighted by strength (verified — a context-heavy persona now proposes
   `context` insights). `decide_insight`'s description was also corrected to stop
   claiming it projects per proposed_output (it only moves pending→accepted).

---

## 4. Threshold history & rationale

| Knob | Original | Now | Next |
|---|---|---|---|
| `SURFACE_CONFIDENCE_THRESHOLD` | 0.7 | **0.55** | 0.55 (hold) |
| `SURFACE_RECURRENCE_THRESHOLD` | 3 | **2** | 2 (hold) |
| `PROPOSE_CONFIDENCE_THRESHOLD` | 0.8 | **0.6** | 0.6 (applied — calibration matrix) |

**Why:** the stub hard-codes confidence 0.85; real Opus rates its own daydreams
**0.42–0.62** — honest and much lower. At 0.7 nothing surfaced; at 0.55 the strong
patterns surface and weak reaches stay quiet (see `DAYDREAM_RECALIBRATION_TEST.md`).
The propose bar was lowered **0.8 → 0.6** and the calibration matrix confirmed it:
proposals finally fire (4 across 2 of 4 personas). The loop initially proposed only
prescriptive `skill` insights (the "levers not labels" prompt bias); that is now
**fixed** — it proposes both diagnostic `context` and prescriptive `skill` insights,
weighted by strength (see §3.4 + `DAYDREAM_CALIBRATION_MATRIX.md`). All three are
named constants in `src/lib/arkive-v2/daydream-loop.ts`.

---

## 5. Projection + new-practice structure — BUILT (Part A + Part B setup-path)

The compounding loop is now **closed**. The reframe held: projection was *designed*
as runtime code (judgment = model at propose-time, plumbing = code at accept-time),
and that is what was built. (Proofs: `scripts/daydream-calibration/projection-proof.ts`.)

### PART A — projection on accept — **DONE**

`decide_insight` accept now projects via the shared `projectAcceptedInsight`
(`src/lib/arkive-v2/project-insight.ts`), called by the one accept path so BOTH
loops' insights graduate identically (both still file through the shared
`proposeInsight`):
- `skill` → versioned skill write to `skills/` (existing skill archived to
  `skills/_archive/<name>-v<old>.md` per §3/§4, new carries `created_from`/`triggered_by`),
- `context` → the insight's `target_context_file`: **`accumulate`/TRUTH** appends a
  new entry (non-destructive, drops the seed placeholder); **`replace`/STATE**
  overwrites (Class-2),
- `both` → both; `ask_user` → writes as context (interactive UX deferred),

carrying `created_from`/`evidence` provenance. The insight now carries
`target_context_file` (model's placement judgment); the context file's
`update_mode` (new field on `ContextFileDeclaration`) decides replace vs accumulate.

### PART B — structure for NEW practices — **setup-path DONE**, emergence-path open

The user-opts-in path is built: `§2.1` of the protocol is now a collaborative
**setup flow** — `list_practice_templates` → `create_practice` →
`update_practice_config`. The model proposes a starting structure by
pattern-matching the user's domain to one of **4 authored example shapes**
(`src/lib/arkive-v2/authored/examples.ts`: fitness=STATE, writing=TRUTH,
health=MIXED, sales=BUSINESS — each with STATE `replace` + TRUTH `accumulate`
context files, journal types, sensible `insight_flow`/`loading`/`starter_pack`,
and a placement playbook), the user steers in plain language, and the schema tools
write the config. The user shapes only events + context files; the model silently
sets the rest and NEVER asks about skills/insights (grown by the loop). **Proven
end-to-end on a NOVEL domain**: the model built a valid Spanish-learning practice
and an accepted insight landed in the TRUTH file it created.

**Still open (deferred):** the **emergence path** — a practice acquiring its homes /
placement map / entity types *automatically* from accreted observations, with no
setup conversation (the harder, unsolved half of Phase 5). Still NEEDS DESIGN.

**Route by KIND — NOT "everything flows to rules."** Trading routes by kind: rules →
`context/rules.md`, positions → `context/positions.md`, theses → the research
journal. The insight→accept pathway specifically lands a **conclusion** in
`context/rules.md`. The governing distinction: **conclusions → context (Class 2,
replace); events → journal (Class 1, append)** — never put conclusions in the
append-only journal.

**Remaining open questions (the emergence path + the explicitly-deferred items):**
- Emergence: can a practice acquire `context_files` / journal types *automatically*
  from accreted observations (no setup conversation)? On first-insight, or progressively?
- Let the user override where an accepted insight lands / type a freeform response /
  have the loop ask a question — today it's **accept-or-reject only**.
- **Destructive restructuring** (merge/split/move existing context) — not built; the
  `accumulate` writer only appends.
- **Cross-practice insight routing** — a `[a,b]`-tagged insight still collapses to one
  practice at propose-time (§3.2). Unchanged.

**Resolved this build (previously flagged):** the protocol spec (`seeds.ts` §2.2)
now describes the real projection (accept → skill/context per `proposed_output`),
correcting the old "projects into a journal entry" claim. Still untouched (design
call): `activity.ts` names blueprint tools `write_recap` / `write_review` /
`append_*` that don't exist.

---

## 6. Document map

- `SESSION_STATE.md` — point-in-time handoff (start here next session).
- `ARCHITECTURE.md` — current-state map (surfaces, routes, tools, engine modules).
- `HOSTING_READINESS.md` — the pre-hosting blockers (P0–P2).
- `DAYDREAM_v1_UI_SCOPE.md` — UI build spec (the engine scope lives **outside the
  repo**, on the maintainer's Desktop — ask if needed).
- `DAYDREAM_REAL_RUN_TEST.md` — first real Opus run (0 surfaced @ 0.7).
- `DAYDREAM_RECALIBRATION_TEST.md` — surfacing recalibration (4 surfaced @ 0.55).
- `DAYDREAM_CALIBRATION_MATRIX.md` — propose threshold 0.8→0.6 across 4 personas.
- `DATA_MODEL.md` — data shapes/ownership.
