# Daydream v1 — UI Scope (Build Spec)

**For: Claude Code, working in the Arkive repo (`Billyarc/Arkive`), branch off `main`.**
**Audience: an engineer/agent who will build this. Not a user-facing doc.**
**Companion to: `DAYDREAM_v1_ENGINE_SCOPE.md` (the engine half — already built).**

This builds the **UI half** of Daydream: the surfaces that let a human *see* the
loop's thoughts and *act* on its proposals. The engine (store, model client,
loop, run endpoint, metering) already exists and is wired; this scope adds **no
engine logic** — it reads what the engine produces and routes human decisions
through paths that already exist. The end state is **a Notices view + a proposal
review surface + a manual trigger, all reading through the HTTP API** — not a
re-plumbing of the engine.

---

## 0. How to use this document — read this first

1. **Re-read the real code before writing anything.** This spec names specific
   files and lines (§3). Open each and confirm the seam matches. The engine was
   built recently; if the code has drifted from this spec, **stop and flag it**
   rather than build against an assumption. Trust the code; use this doc for
   intent.

2. **The checkpoints (§6) are build-and-verify milestones.** Each ends in a
   concrete `Done when`. The data-plane checkpoint (CP1) is the one everything
   else depends on — get the bundle/route shape right first, then build views on
   top. `npx tsc --noEmit` must be 0 errors before moving on.

3. **This is a read + human-gate surface, not a second engine.** The UI must not
   move insights, mutate context, or write daydreams except through the engine's
   existing, gated paths. Building a parallel write path is a scope violation.

4. **Do not build anything in the Deferred list (§7).** No scheduler/cron, no
   durable learner, no analytics. Those are deliberately deferred.

5. **Test with the stub model — no API spend.** `DAYDREAM_MODEL=stub` drives the
   loop end-to-end for free (see the engine scope). Use it for every manual-run
   test; the real-model run is a later, keyed step.

---

## 1. What this is (intent, brief)

The engine produces three things a human currently cannot see:
- **daydreams** — the loop's hypotheses, at `arkive/daydreams/<YYYY-MM>/*.md`;
- **surfaced daydreams** — the subset with `surfaced: true` (the read-only
  "**Notices**");
- **proposals** — daydreams that graduated into `insights/pending/`, carrying the
  loop's own reasoning/confidence/provenance.

The UI exposes the funnel the engine already writes:

```
daydream  →  Notice (surfaced)  →  proposal (insights/pending/)  →  accepted/ (human commit)
 (hidden)     (read-only view)      (review surface)                (existing gated route)
```

Each later stage is a higher bar with a human in the loop. The UI is the lens +
the two human gestures (read a Notice; accept/reject a proposal) — nothing more.

---

## 2. Constitution — hard invariants (every checkpoint is tested against these)

- **U1 — Read through the HTTP API only.** No server component or client
  component touches `read-bundle`, `storage`, or the filesystem directly. The
  whole workspace already fetches over HTTP (§3); match it. (This is also what
  keeps the UI hosting-clean.)
- **U2 — Every new route is session-gated and user-scoped.** New routes follow
  the `arkive-v2/*` pattern — `getSession()` reject + `currentUserId()` scoping
  (e.g. `entry/route.ts:22`) — **never** the unguarded `wallets/*` / `pending/*`
  pattern. The daydream store is already user-scoped via the storage adapter.
- **U3 — Never bypass the human commit gate.** Accept/reject goes through the
  existing insight route; the UI never writes `insights/accepted/` directly, never
  mutates `context/`, never creates a practice. (Mirrors engine C4.)
- **U4 — Daydreams are hypotheses; present them as such.** Notices are visually
  and textually framed as unverified thoughts, distinct from journal/fact. Never
  render a daydream as a stated fact. (Mirrors engine C3 at the presentation layer.)
- **U5 — Additive only.** Do not change the loop, the store's write logic, or
  existing bundle consumers' behavior. `read-bundle` gains a new optional field;
  nothing existing changes shape.
- **U6 — Practice-agnostic.** No hardcoded practice names in the UI. Daydreams
  carry practice tags dynamically; render whatever's there, including untagged
  (cross-cutting) ones. (Mirrors engine C2.)

---

## 3. The existing seams — RE-READ THESE FIRST

| File | What to confirm |
|---|---|
| `src/lib/arkive-v2/read-bundle.ts` | `ArkiveBundle` (171–199) + `LoadedPractice` (80–119). Exposes `pending_insights`, `recent_journal`, `context`, `recent_observations` — **no daydreams**. `readArkive()` assembly (201–369); the stream slice is taken ~299 — the natural place to add a daydream slice. **Confirm read-bundle is still unmodified by the engine commits.** |
| `src/lib/arkive-v2/daydream.ts` | The read API already exists: `listDaydreams({ since?, practice?, surfacedOnly?, withBody? })` (117–145), `readDaydream(path)` (147–153), `setSurfaced(path, bool)` (178), `Daydream` type (31–38). **No new engine code needed — these are your data source.** |
| `src/lib/arkive-v2/schemas.ts` | `DaydreamMeta` (confidence, recurrence, surfaced, evidence, created_from, promoted_to, practices). `daydream_frequency` on `ArkiveConfigDefaults` (default `"off"`). |
| `src/app/api/arkive-v2/bundle/route.ts` | `GET` → `readArkive()` verbatim (13–22), session-gated. The single feed the workspace consumes. Surfaced daydreams added to the bundle here arrive in the UI for free. |
| `src/app/api/arkive-v2/entry/route.ts` | `GET ?path=` reads any file, validated against `V2_ROOT` (27–30). Daydream paths (`arkive/daydreams/…`) pass the check — **reuse as-is** for daydream detail bodies. |
| `src/app/api/arkive-v2/insight/route.ts` | `POST` accept/reject; schema `{ insightPath, decision: "accepted"\|"rejected", userComment }` (18–22), moves pending→accepted/rejected (44). **Gap: no structured `reason_type`** (the MCP `decide_insight` has it per §5.4). CP3 extends this. |
| `src/app/api/arkive-v2/daydream/run/route.ts` | `POST` → `runDaydreamPass()`; returns summary + cost from the metering ledger (41+). The "think now" trigger. **The only daydream route today — there is no GET/list route.** |
| `src/app/api/arkive-v2/index-graph/route.ts` | `GET` → `buildIndex()`. Daydreams are **already graph nodes** (not excluded by `skipFromIndex`, `arkive-index.ts:284–294`), so a graph affordance can light up off existing data. |
| `src/components/arkive-workspace/ArkiveWorkspace.tsx` | `"use client"` (18); fetches `/api/arkive-v2/bundle` (72); `buildTree(bundle)` (90); tab state `Tab[]` (54); imports `Bundle`/`Entry`/`Tab` from `./types` (27). The host shell a Notices tab slots into. |
| `src/components/arkive-workspace/types.ts` | `Bundle` (124) is a **hand-maintained mirror** of `ArkiveBundle` — add the new field here too. `Tab` union (152) — extend for a Notices tab. |
| `src/components/arkive-workspace/tree-utils.ts` | `buildTree` (26) builds the explorer from `recent_observations` (36) + practice `all_paths` (58). Daydreams (root-level) are **absent from the tree** — extend here only if you want them in the explorer. |
| `src/components/arkive-workspace/OverviewTab.tsx`, `FileTab.tsx`, `src/components/RichMarkdown.tsx` | Patterns to reuse: tab fetching, markdown body rendering. |

---

## 4. What is net-new (in build order)

1. **Data plane** — surface daydreams to the client: an additive `read-bundle`
   field for surfaced daydreams, plus a `GET /api/arkive-v2/daydream` list route
   for views beyond the surfaced subset. (CP1)
2. **Notices view** — a read-only surface listing surfaced daydreams as
   hypotheses, with evidence links and salience signals. (CP2)
3. **Proposal review surface** — list loop-authored pending insights and
   accept/reject them, capturing structured `reason_type`. (CP3)
4. **Trigger + cadence surface** — a "think now" button (manual run) showing the
   run summary + cost, and read/write of `daydream_frequency`. (CP4)
5. *(Optional)* **Explorer/graph affordances** — a daydreams branch in the tree.
   (CP5)

---

## 5. Data-model / API additions (precise)

### 5.1 read-bundle (additive — U5)
Add to `ArkiveBundle` (read-bundle.ts:171–199):
```ts
notices: Daydream[];      // surfaced daydreams (surfaced === true), newest first
daydream_count?: number;  // optional badge count
```
Populate in `readArkive()` near the stream slice (~299):
```ts
const notices = await listDaydreams({ surfacedOnly: true, withBody: true });
```
Mirror the field in the UI `Bundle` type (types.ts:124). No existing consumer
changes — additive only.

### 5.2 New list route (follows arkive-v2 pattern — U2)
`GET /api/arkive-v2/daydream` — query: `surfacedOnly?`, `practice?`, `since?`,
`limit?`. Session-gated + `currentUserId()`-scoped. Backed by `listDaydreams()`.
For history / non-surfaced / per-practice / paged views that the bundle's
surfaced slice doesn't cover. Detail bodies use the existing `entry` route.

### 5.3 insight route — add structured reason (closes the §5.4 gap)
Extend `insight/route.ts` schema (18–22) with optional
`reason_type: "useful" | "wrong" | "not_useful" | "too_speculative" | "dont_care"`,
written to the resolved insight meta (parity with the MCP `decide_insight` tool).
Keep `userComment` (free text). No new route — extend the existing one.

### 5.4 No new write paths
Surfacing state is set by the engine; if the UI offers dismiss/pin of a Notice,
it calls a thin `POST` wrapping `setSurfaced` (daydream.ts:178) — not a new
store. Accept/reject stays on the insight route (U3). No other writes.

---

## 6. Checkpoints (build-and-verify, in order)

### CP1 — Data plane: expose daydreams to the client
**Build:** §5.1 bundle field + loader; §5.2 `GET /api/arkive-v2/daydream`.
**Done when:**
- `npx tsc --noEmit` = 0 errors.
- `GET /api/arkive-v2/bundle` includes `notices` populated from surfaced
  daydreams (verify with the stub: seed → run → hit bundle).
- `GET /api/arkive-v2/daydream?surfacedOnly=true` returns the same set; the route
  rejects unauthenticated requests (`getSession`) and scopes by `currentUserId()`.
- No existing bundle consumer breaks (UI `Bundle` mirror updated).

### CP2 — Notices view (read-only)
**Build:** a Notices surface (a new tab in `ArkiveWorkspace.tsx` via the `Tab`
union, or a peer of `OverviewTab.tsx`) rendering `bundle.notices`: thought body
(hypothesis-framed — U4), confidence + recurrence, practice tags (or
"cross-cutting"), and evidence paths as links that open the referenced file via
the existing `entry` route. `created_from` shown as "builds on" links.
**Done when:**
- `npx tsc --noEmit` = 0 errors.
- Surfaced daydreams render as Notices; non-surfaced ones do not appear.
- Notices are visually distinct from journal/fact and read as hypotheses (U4).
- The view performs **zero writes** (read-only).

### CP3 — Proposal review surface
**Build:** list pending insights that carry loop provenance (`loop_reasoning`,
`loop_confidence`, `provenance_kind`) — distinguish loop-authored from
human-authored proposals. Accept/reject via the **extended** insight route
(§5.3), capturing `reason_type` + optional comment.
**Done when:**
- `npx tsc --noEmit` = 0 errors.
- Accept moves the file to `insights/accepted/` via the existing gated route
  (U3); reject records `reason_type` in meta.
- The loop's reasoning/confidence/provenance are visible per proposal.
- No path writes `accepted/` except the existing route.

### CP4 — Trigger + cadence surface
**Build:** a "Think now" button → `POST /api/arkive-v2/daydream/run`, rendering
the returned summary (daydreams written / surfaced / proposed / failures) and the
cost figure. A control to read/set `daydream_frequency` (`off|daily|frequent`)
through a config read/write (the engine stores it; no scheduler — §7).
**Done when:**
- `npx tsc --noEmit` = 0 errors.
- The button runs one pass (stub) and shows the summary + cost; new Notices
  appear on bundle refresh.
- `daydream_frequency` round-trips through the config and is reflected in the UI.
- No cron/scheduler added.

### CP5 — *(optional)* Explorer / graph affordances
**Build:** add an `arkive/daydreams` branch to `buildTree` (tree-utils.ts:26–58),
mirroring the stream branch, fed by a bundle field of daydream paths. (The graph
already shows daydream nodes — no work needed there.)
**Done when:** daydreams appear in the explorer tree; tsc clean; no engine change.

---

## 7. Deferred — DO NOT BUILD in this scope

- **The real scheduler / cron / worker.** CP4 builds only the manual trigger +
  the frequency *setting* (still the engine's §8 seam).
- **The durable feedback learner.** Captured-not-learned remains (engine §7).
- **Notice-reaction analytics** (tracking dismiss/engage as signal).
- **Mobile / responsive polish** beyond what the existing workspace already does.
- **Any change to the loop, store-write logic, or model client.** UI is read +
  trigger + the two existing human gestures only.

---

## 8. Final verification — end-to-end with the stub (no API spend)

After CP1–CP4, with `DAYDREAM_MODEL=stub`:
1. Seed a synthetic arkive; `POST /api/arkive-v2/daydream/run` (or the CP4 button).
2. Open the Notices view: surfaced daydreams appear, framed as hypotheses, with
   working evidence links (open via the `entry` route) and salience signals.
3. Open the proposal review: loop-authored pending insights show reasoning +
   confidence + provenance. Accept one → it leaves `pending/`, lands in
   `accepted/`. Reject another with a `reason_type` → recorded in meta.
4. Confirm invariants hold: **zero** writes to any `journal/`; nothing written to
   `accepted/` except via the insight route; the UI made no direct
   storage/filesystem access (all data via `/api/...`).
5. Trigger a second run; confirm new Notices appear and recurrence/`created_from`
   from the engine are reflected in the view.

If all five hold: the UI surfaces the engine end-to-end and the real-model run
(with a key) is the only step left.

---

## Appendix — settled decisions (so nothing is re-litigated)

- The UI is a **lens + two gestures** (read a Notice; accept/reject a proposal),
  not a second engine. All writes go through existing engine paths.
- **Bundle is the primary feed** — surfaced daydreams ride the existing
  `/bundle` route the whole workspace already consumes; the new `GET .../daydream`
  route is only for views beyond the surfaced subset.
- **Proposal review is nearly free** — graduated daydreams are already
  `insights/pending/` entries; reuse the insight accept/reject route, extended
  with `reason_type`.
- **Read through HTTP, always** — matches the existing client-fetch data path and
  keeps the UI hosting-clean (no server-side storage/file coupling).
- **Daydreams are hypotheses** — presented distinctly from fact, never as
  conclusions.
- Scheduler, durable learner, notice analytics: **deferred.**
