# Daydream — Session State (handoff)

Pick-up context for a fresh session. Read this first, then the docs it points to.

- **Branch:** `daydream-real-run-test`
- **HEAD:** `3a43cea` (`3a43cea…`) + this commit (compounding-loop closeout fixes)
- **Date:** 2026-06-17 · working tree clean, pushed to `Billyarc/Arkive`.
- **Repo:** `/Users/soda2on/Arkive`. Toolchain: local Node at `~/.local/node`
  (prefix PATH). `.env.local` holds the Opus key + `DAYDREAM_MODEL=claude-opus-4-8`
  — **gitignored, never commit it.** Stub for free runs: `DAYDREAM_MODEL=stub`.

---

## WHAT'S DONE

1. **Daydream engine built** — store, swappable model client with
   metering-at-the-boundary, autonomous loop, run endpoint.
2. **Daydream UI built** — Notices view, proposal review native in the live
   workspace (`arkive-workspace`), "Think now" trigger + cadence control, and an
   `arkive/daydreams` explorer/graph branch.
3. **Full code review done** — engine + arkive substrate are clean and
   multi-tenant-ready; the **trading layer has a documented pre-hosting security
   blocker** (see `DAYDREAM_DEFERRED_AND_NEXT_STEPS.md` → §1, detail in
   `HOSTING_READINESS.md`).
4. **Real-model run done (Opus 4.8)** — daydreams genuinely good: found the buried
   cross-cutting + behavioral patterns, stayed cautious on the over-claim trap, and
   run 2 compounded run 1 (`created_from` + recurrence). ~$0.15.
   (`DAYDREAM_REAL_RUN_TEST.md`.)
5. **Surfacing recalibration done** — lowered `SURFACE_CONFIDENCE_THRESHOLD`
   0.7→0.55 and `SURFACE_RECURRENCE_THRESHOLD` 3→2. Result: **4 daydreams surfaced,
   and the bar correctly SEPARATED good from weak** (strong patterns surfaced, weak
   reaches stayed quiet). (`DAYDREAM_RECALIBRATION_TEST.md`.)
6. **Frontmatter write-bug fixed** (commit `722789f`) — the filesystem adapter was
   appending a doubled `.md` and double-serializing frontmatter; now matches the
   Postgres contract, with a backward-compatible reader (old `.md.md` files still
   read, no migration) that self-heals on rewrite. Verified, pushed.
7. **Calibration matrix done** — lowered `PROPOSE_CONFIDENCE_THRESHOLD` 0.8→0.6
   and ran the loop on **4 distinct personas** (teacher, nurse, maker + trading
   confirmation case), 2 Opus passes each. **Proposals finally fire** (4, in 2
   arkives); confidence tracked strength; the calibration **generalized to
   trading**; the over-claim discipline held (hedged the ambiguous, saw through
   the coffee decoy). ~$0.73. (`DAYDREAM_CALIBRATION_MATRIX.md`.)
8. **Both insight types propose** — fixed the "levers not labels" prompt bias; the
   loop now proposes diagnostic `context` insights as well as prescriptive `skill`.
9. **Compounding loop CLOSED** — accept now writes durable structure (skill +
   context projection, shared `project-insight.ts`), and the model builds structure
   for new practices (the `§2.1` setup flow + 4 authored example templates +
   `list_practice_templates`). Proven on disk incl. a novel domain. (See below.)
10. **Closeout fixes — build phase COMPLETE.** (a) Context projection defaults a
    missing `update_mode` to `accumulate` (append), not `replace` — a forgotten mode
    can never silently wipe accumulated truths (verified). (b) Setup instructions +
    the `update_practice_config` description now teach the `status_field`
    `<from>_to_<to>` transition syntax — the setup model emits valid transitions and
    new-practice configs write first-try (verified on woodworking + law, which failed
    before). One known issue logged: non-atomic skill re-versioning (DEFERRED §2).

---

## KEY FINDINGS

- **Real Opus rates its own daydreams honestly at ~0.42–0.62** — NOT the stub's
  hard-coded 0.85. Thresholds had to come down to match real-model calibration.
- **Proposals fire at 0.6, and now propose BOTH types** (2026-06-17). Lowering the
  propose bar 0.8→0.6 produced the first real proposals (calibration matrix). The
  loop initially only proposed prescriptive `skill` insights and withheld diagnostic
  `context` ones — a soft **prompt** bias, no code gate. **Fixed:** the daydream
  system prompt + the shared `propose_insight` tool description now invite BOTH
  prescriptive (skill) and diagnostic (context) insights, weighted by strength
  (verified — a context-heavy persona now proposes 3 `context` + 3 `skill`).
  `decide_insight`'s description was also corrected (it only moves pending→accepted;
  it does NOT project per proposed_output). **Caveat:** accepted `context` insights
  have no home yet — projection is unbuilt (the next piece). (`DAYDREAM_CALIBRATION_MATRIX.md`.)

Current thresholds (`src/lib/arkive-v2/daydream-loop.ts`):
`SURFACE_CONFIDENCE_THRESHOLD = 0.55`, `SURFACE_RECURRENCE_THRESHOLD = 2`,
`PROPOSE_CONFIDENCE_THRESHOLD = 0.6` (lowered from 0.8 — calibration matrix).

---

## COMPOUNDING LOOP CLOSED (this session) — what remains

The projection problem (Part A / Part B) is now **BUILT** — accepting an insight
writes durable structure, and the model builds structure for new practices.

- **PART A — projection on accept: DONE.** `decide_insight` accept now projects via
  the shared `projectAcceptedInsight` (`project-insight.ts`): `skill` → versioned
  skill write (old archived per §4); `context` → its `target_context_file`
  (`accumulate`/TRUTH appends a new entry, `replace`/STATE overwrites); `both` →
  both — carrying `created_from`/`triggered_by` provenance. `ask_user` writes as
  context for now (interactive UX deferred). Both loops route through the shared
  `proposeInsight`; the single accept path projects. Proven on disk.
- **PART B — structure for NEW practices: setup-path DONE.** Context files now carry
  `update_mode` (`replace` STATE vs `accumulate` TRUTH); the insight carries
  `target_context_file` (placement = model judgment). `§2.1` of the protocol is now a
  collaborative **setup flow**: `list_practice_templates` → `create_practice` →
  `update_practice_config` (the model proposes structure by pattern-matching to 4
  authored example shapes, the user steers, the schema tools write it). 4 example
  templates authored (`authored/examples.ts`: fitness=state, writing=truth,
  health=mixed, sales=business). Proven end-to-end on a NOVEL domain (the model
  built a valid "Spanish learning" practice and an accepted insight landed in the
  TRUTH file it created).

**Still open (deferred, not built):** the **emergence path** of Part B (a practice
acquiring structure automatically from accreted observations, with no setup
conversation); letting the user override placement / type freeform responses to
insights / the loop asking questions (accept-or-reject only today); destructive
restructuring (merge/split/move context); **cross-practice insight routing** (a
`[a,b]`-tagged insight still collapses to one practice). See DEFERRED §3 + §5.

---

## OPEN THREADS (parked — context)

- **Projection / structure-population** — accepted insights don't yet become
  durable structure, and emergent practices have no homes. **This is the main next
  — see "NEXT — the projection problem" above and DEFERRED §5 (Part A / Part B).**
- **Cross-practice insight routing** — where does a `[health, freelance]`-tagged
  insight write (proposal targets a single practice today).
- **Unified in-chat + autonomous loop memory** — the in-chat loop can't yet
  see/feed the daydream store; connects to projection.

Expanded in `DAYDREAM_DEFERRED_AND_NEXT_STEPS.md`.

---

## DOCUMENT MAP (fuller record)

- `DAYDREAM_DEFERRED_AND_NEXT_STEPS.md` — deferred items, blockers, open threads,
  threshold history, and the projection problem (Part A / Part B) — §5.
- `ARCHITECTURE.md` — current-state map (2 surfaces, routes, 70 MCP tools, modules).
- `HOSTING_READINESS.md` — pre-hosting blockers (P0–P2).
- `DAYDREAM_v1_UI_SCOPE.md` — UI build spec. **Engine scope doc is external** (on
  the maintainer's Desktop, never committed — ask if needed).
- `DAYDREAM_REAL_RUN_TEST.md` — first real Opus run.
- `DAYDREAM_RECALIBRATION_TEST.md` — surfacing recalibration.
- `DAYDREAM_CALIBRATION_MATRIX.md` — 4-persona propose-threshold test (0.8→0.6).
- `DATA_MODEL.md` — data shapes/ownership.

## BRANCH COMMIT TRAIL

`4529555` engine → `7f57ee0` stub+hardening → `704e83a` docs → `81a2799` UI →
`c0fc8e6` real-run → `1d4a8ff` recalibration → `722789f` frontmatter fix →
`9a70a26` handoff → `14c35f6` calibration matrix → `0f49ba8` propose both types →
`9fba402` docs refresh → `3a43cea` compounding loop closed (projection +
new-practice setup) → (this handoff: closeout fixes — fail-safe context default +
status-syntax instruction; build phase complete).
