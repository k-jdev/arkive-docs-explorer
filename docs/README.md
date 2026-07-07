# Arkive docs

Engineering documentation. **Resuming work? Start with [SESSION_STATE.md](SESSION_STATE.md).**

| Doc | What it covers | Read it when |
|---|---|---|
| [SESSION_STATE.md](SESSION_STATE.md) | Point-in-time handoff: what's done, key findings, the next test, branch/HEAD. | Picking up the work in a fresh session. |
| [DAYDREAM_DEFERRED_AND_NEXT_STEPS.md](DAYDREAM_DEFERRED_AND_NEXT_STEPS.md) | Durable backlog: deferred features, pre-hosting blockers, open threads, threshold history. | Planning what to build/fix next. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current-state map: the two surfaces, all 30 routes, 70 MCP tools, engine modules, storage, auth model, Daydream status. | You need the live picture of what exists and where it lives. |
| [DATA_MODEL.md](DATA_MODEL.md) | Every place data lives — ownership, shape, and where it's defined in code. | Before changing any data shape or storage. |
| [HOSTING_READINESS.md](HOSTING_READINESS.md) | Known issues (P0–P2) blocking a multi-tenant hosted deploy, with file:line + fix direction. | Before any shared/hosted deployment, or touching wallets/pending/keystore. |
| [DAYDREAM_v1_UI_SCOPE.md](DAYDREAM_v1_UI_SCOPE.md) | Build spec for the Daydream UI (Notices + proposal review + manual trigger). | When building the Daydream UI surface. |
| [DAYDREAM_REAL_RUN_TEST.md](DAYDREAM_REAL_RUN_TEST.md) | First real Opus run — daydreams + frontmatter; 0 surfaced @ 0.7. | Reviewing real-model behavior. |
| [DAYDREAM_RECALIBRATION_TEST.md](DAYDREAM_RECALIBRATION_TEST.md) | Surfacing recalibration — 4 surfaced @ 0.55; strong/weak separation. | Reviewing threshold calibration. |

> Companion engine spec `DAYDREAM_v1_ENGINE_SCOPE.md` (the engine half — already
> built) lives outside the repo; ask the maintainer if you need it.

**Currency:** latest work is on branch `daydream-real-run-test` @ `722789f`
(2026-06-17); ARCHITECTURE / HOSTING_READINESS were written @ `7f57ee0`. Re-verify
against the code before acting on a finding — trust the code over the doc if they
disagree.
