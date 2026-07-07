# Daydream Loop — Real-Model Quality Test

A real, honest run of the autonomous daydream loop against a frontier model
(**Opus 4.8**, `claude-opus-4-8`) over a naturalistic synthetic arkive. The goal:
does the loop find real, non-obvious insights without being gift-wrapped — and
does it over-claim?

> Read the daydreams **blind** first. The patterns that were actually planted are
> at the very bottom under **"PLANTED PATTERNS — read last"** so you can compare
> what the loop found against what was really there.

- **Model:** `anthropic:claude-opus-4-8` · **Runs:** 2 · **Cost:** **$0.1501**
  (2 calls, 12,015 input / 3,601 output tokens)
- **Date of run:** 2026-06-17 · stub NOT used — this is the real model.
- **Full generated arkive** preserved at
  [`test-fixtures/daydream-real-run/arkive-store/`](../test-fixtures/daydream-real-run/arkive-store)
  (raw filesystem-adapter store: the 65-observation stream, the two practices,
  all 11 daydreams, and the metering ledger).

---

## 1. Setup

**Persona — "Maya":** a freelance product designer working from home; lives with
her partner Sam and a dog. Drinks too much coffee, runs when she can, and tends
to overcommit. One coherent person across all 65 entries — quick notes, longer
reflections, logged events, offhand remarks, decisions, frustrations, wins, in
natural varied language. No entry narrates a pattern about herself.

**Two practices** (created via `createUserPractice`, real configs, both active):
- **`freelance`** — client/project work, invoicing, pitches, deadlines.
- **`health`** — runs, sleep, food, energy, how she feels.
- Many entries are routed to a practice; general-life entries (Sam, the dog,
  errands, one-offs) are left untagged.

**Volume & spread:** **65 observations** over **2026-04-01 → 2026-05-20 (~7
weeks)**. Natural, uneven timing — busy clusters and quiet stretches, two
deadline crunches, not evenly spaced.

> Note: the engine's default `trading` practice was auto-installed by a migration
> during post-run readback; it was empty (0 observations, 0 daydreams), played no
> role in the test, and was removed from the snapshot. The run itself executed
> with exactly `freelance` + `health` installed.

---

## 2. Run results

| | written | surfaced | proposed | recurrences recorded | input tok | output tok |
|---|---|---|---|---|---|---|
| **Run 1** | 6 | 0 | 0 | 0 | 5,560 | 1,710 |
| **Run 2** | 5 | 0 | 0 | 6 | 6,455 | 1,891 |
| **Total** | **11** | **0** | **0** | 6 | 12,015 | 3,601 |

**Headline finding (honest):** the loop generated **11 substantive daydreams**,
but **0 surfaced** and **0 became proposals**. Every daydream's
model-assigned confidence landed in **0.42–0.62** — below the v1 surfacing bar
(`confidence ≥ 0.7` OR `recurrence ≥ 3`) and well below the propose bar
(`confidence ≥ 0.8`). Recurrence reached at most 2 (over two runs), short of 3.

So: real Opus was **markedly more conservative** with confidence than the stub
(which hard-codes 0.85). It treated everything as genuine hypotheses and never
self-promoted. The thoughts are good (see §3) — but **a human running this loop
as built would see no Notices and no proposals**, because nothing cleared the
thresholds. That's a real calibration signal about the v1 thresholds vs. how a
frontier model actually rates its own daydreams. (Thresholds are named constants
in `daydream-loop.ts` — `SURFACE_CONFIDENCE_THRESHOLD`, etc.)

---

## 3. The daydreams (full, both runs)

All 11, complete bodies + frontmatter. `practice: core` and
`entity_type: daydream` are omitted for brevity (identical on every one).

### Run 1 — 6 daydreams (`created_at 2026-06-17T02:12:22`)

**DD1 · `…02-12-22-209Z-253c63.md`**
`confidence: 0.6 · surfaced: false · recurrence: 1 · practices: [health, freelance]`
`evidence:` `2026-05-08…7dd978` · `2026-05-16…869314` · `2026-04-18…0554a9` · `2026-05-07…7a859e`
`created_from: []`
> Running seems to break down precisely when freelance deadlines peak — the run
> gaps ('skipped the run, no time this week', 'first proper run in over a week',
> 'first run in nearly two weeks') cluster around Lumen crunch periods. Could
> deadline intensity be the main predictor of dropped run streaks?

**DD2 · `…02-12-22-222Z-d4318b.md`**
`confidence: 0.62 · surfaced: false · recurrence: 2 · practices: [freelance]`
`evidence:` `2026-04-17…9379a6` · `2026-05-15…68e344`
`created_from: []`
> There may be a recurring pattern of saying yes to work reflexively ('said yes
> on the call before I even thought', 'a new startup pinged me, I said yes, I
> never learn', 'just a quick call'). Is the absence of a default pause before
> accepting new work a structural driver of the overload cycle?

**DD3 · `…02-12-22-228Z-0b5360.md`**
`confidence: 0.58 · surfaced: false · recurrence: 0 · practices: [health]`
`evidence:` `2026-05-12…d92cf1` · `2026-05-10…941895` · `2026-05-04…019ae4` · `2026-05-11…94b1ca`
`created_from: []`
> Headaches and bad sleep appear to co-occur with low food intake and high coffee
> during deadline crunches ('running on fumes and cortados', 'no appetite, just
> coffee', 'head pounding, slept badly up till 2'). Could the headaches be
> downstream of the skip-meals-plus-caffeine pattern rather than random?

**DD4 · `…02-12-22-235Z-0407c6.md`**
`confidence: 0.55 · surfaced: false · recurrence: 1 · practices: []`
`evidence:` `2026-05-11…b7a840` · `2026-04-28…32d14f` · `2026-05-20…3b191a`
`created_from: []`
> Friction with Sam ('snapped at Sam again, same as last month, too tired to be
> decent', 'big fight about the trip', 'would I take a weekend off') seems to
> surface during the most depleted phases. Is relationship strain a lagging
> indicator of the work-overload/sleep-deficit cycle?

**DD5 · `…02-12-22-241Z-f32e69.md`**
`confidence: 0.5 · surfaced: false · recurrence: 1 · practices: [freelance, health]`
`evidence:` `2026-05-02…11b7b1` · `2026-05-04…019ae4` · `2026-05-18…d3adde`
`created_from: []`
> Side-project building tends to eat into sleep right when the day-job load is
> already heavy ('building it instead of sleeping', 'up till 2 on the side
> project', 'side-project ideas came flooding on the run'). Could the side
> projects be a stress-displacement outlet rather than spare-capacity work?

**DD6 · `…02-12-22-247Z-560bb7.md`**
`confidence: 0.52 · surfaced: false · recurrence: 1 · practices: [freelance, health]`
`evidence:` `2026-05-10…c56137` · `2026-04-27…83d303` · `2026-04-19…2842f6`
`created_from: []`
> Work quality may track recovery state: the 'everything looks wrong, deleting
> more than I keep' day fell mid-crunch, while 'the logo direction basically drew
> itself' and 'ideas actually turning up' followed runs or rest. Is creative
> output quality coupled to whether running/sleep are intact?

### Run 2 — 5 daydreams (`created_at 2026-06-17T02:12:45`)

**DD7 · `…02-12-45-562Z-efbe14.md`**
`confidence: 0.6 · surfaced: false · recurrence: 0 · practices: [freelance, health]`
`evidence:` `2026-05-15…68e344` · `2026-05-09…647d52` · `2026-05-20…3b191a`
`created_from:` **DD2** (`…d4318b`), **DD1** (`…253c63`)
> The reflexive-yes pattern and the run-breakdown pattern may be two faces of the
> same root cause: there is no protected boundary on intake. Saying yes to 'just
> a quick call' (2026-05-15) and answering Lumen emails at a wedding (2026-05-09)
> suggest that without an explicit default 'no/pause', the overload cascades into
> dropped runs, bad sleep, and Sam friction. Could a single intervention — a
> default pause before accepting work — be the highest-leverage lever across all
> three practices?

**DD8 · `…02-12-45-592Z-f145c4.md`**
`confidence: 0.48 · surfaced: false · recurrence: 0 · practices: [freelance, health]`
`evidence:` `2026-05-14…857956` · `2026-05-17…f358bd` · `2026-05-17…4d7dfc` · `2026-05-20…3b191a`
`created_from:` **DD4** (`…0407c6`)
> Project completion seems to trigger a hollow rather than relieved state — 'sent
> final files, can't feel my face' (2026-05-14), then immediately a quick
> celebratory walk (2026-05-17) and a glowing review that 'made my month'
> (2026-05-17), yet Sam still asks if a weekend off will ever happen (2026-05-20).
> Could external validation be substituting for actual recovery, so wins arrive
> without rest ever following them?

**DD9 · `…02-12-45-605Z-8e6d30.md`**
`confidence: 0.5 · surfaced: false · recurrence: 0 · practices: [health, freelance]`
`evidence:` `2026-05-18…d3adde` · `2026-04-27…e6309d` · `2026-04-27…83d303`
`created_from:` **DD6** (`…560bb7`), **DD5** (`…f32e69`)
> Runs appear to function as an idea-generation engine, not just recovery —
> 'side-project ideas came flooding on the run' (2026-05-18) and a short run
> preceded the best Lumen session (2026-04-27). If creative output is coupled to
> running (per prior daydream 560bb7), the runs may be doing double duty as both
> health practice AND the actual source of the side-project ideas that later
> steal sleep. Is the run the upstream cause of both the good work and the
> sleep-eroding side projects?

**DD10 · `…02-12-45-621Z-dc7821.md`**
`confidence: 0.42 · surfaced: false · recurrence: 0 · practices: [freelance, health]`
`evidence:` `2026-04-21…4ea9e2` · `2026-05-20…3b191a`
`created_from: []`
> Financial milestones seem to license enjoyment that is otherwise deferred —
> 'Lumen deposit cleared, bought the ceramics kit guilt-free' (2026-04-21). Could
> there be a pattern where rest and hobbies are only permitted as rewards tied to
> money or completion, rather than scheduled independently — which would explain
> why a plain weekend off (2026-05-20) has no clear trigger and never happens?

**DD11 · `…02-12-45-627Z-1920e6.md`**
`confidence: 0.52 · surfaced: false · recurrence: 0 · practices: [freelance]`
`evidence:` `2026-05-17…4d7dfc` · `2026-04-17…9379a6` · `2026-05-15…68e344`
`created_from:` **DD2** (`…d4318b`)
> Referrals and inbound work cluster right after delivering strong work — Dorian's
> glowing review referred two people (2026-05-17), Lumen escalated from kickoff to
> full rebrand (2026-04-17). The very success that the reflexive-yes pattern
> produces may be what regenerates the overload, making it self-reinforcing. Is
> the overload cycle structurally driven by good work begetting more inbound
> faster than capacity recovers?

---

## 4. Surfacing, proposals, cost

- **Surfaced:** none. All 11 confidences are 0.42–0.62 (< 0.7); max recurrence 2
  (< 3). The surfacing rule correctly fired on nothing.
- **Proposals:** none. None reached confidence ≥ 0.8, so nothing graduated into
  `insights/pending/`. (`proposeFailures: 0` — no errors; simply nothing
  qualified.)
- **Cost:** **$0.1501** total for both runs (`claude-opus-4-8`, 2 calls,
  12,015 in / 3,601 out tokens), sourced from the metering ledger at
  `arkive-store/_internal/daydream-runs/`.

---

## 5. Did run 2 build on run 1?

**Yes.** `recurrencesRecorded: 6` on run 2, and 4 of run 2's 5 daydreams carry
`created_from` links back into run 1:

- **DD7** built on **DD2 + DD1** — synthesized the reflexive-yes and run-breakdown
  threads into a single "no protected boundary on intake" root-cause hypothesis.
- **DD8** built on **DD4** (the Sam-friction / depletion thread).
- **DD9** built on **DD6 + DD5** — extended "work quality tracks recovery" into
  "runs are an idea engine that also steals sleep."
- **DD11** built on **DD2** — extended reflexive-yes into a self-reinforcing loop.

Run 1's referenced daydreams show the reinforcement on disk: **DD2** reached
`recurrence: 2` (cited by DD7 and DD11); **DD1**, **DD4**, **DD5**, **DD6** each
reached `recurrence: 1`. The second pass genuinely read and compounded the first
rather than repeating it — and the new daydreams are higher-order (cross-thread
synthesis), not restatements.

---
---

## PLANTED PATTERNS — read last

These are the patterns deliberately buried in the seed data. None was ever stated
outright in any single observation — they live only in the aggregate
(co-occurrence, timing, repetition). Compare against §3 above.

1. **Cross-cutting (between the two practices).** Physical activity co-varies with
   work wellbeing across the whole timeline. During the two deadline crunches
   (Dorian, ~Apr 9–16; Lumen, ~May 7–14) running stops, sleep degrades, coffee
   rises, irritability appears, and design work "feels like pushing wet sand" /
   "everything looks wrong." In the calmer weeks with regular runs, mood lifts and
   the creative wins land ("the logo basically drew itself", "ideas actually
   turning up", "ideas came flooding on the run"). Inferable only by aligning
   `freelance` and `health` entries by date — never said.

2. **Behavioral tendency the person hasn't noticed.** She commits to something new
   *immediately after completing/shipping*, instead of resting: ship Dorian (Apr
   16) → say yes to the Lumen rebrand + sign up for ceramics (Apr 17); ship
   Kestrel (May 1) → buy a domain and start a side project that night (May 2);
   send final Lumen files (May 14) → say yes to a new startup call (May 15). The
   "rest" never happens (capped by Sam's "would you ever take a weekend off?" on
   May 20). Each event is logged separately; the tendency is never connected.

3. **Weaker / noisy near-pattern (over-claim trap).** Afternoon headaches appear
   ~4 times with a *deliberately ambiguous* cause — once with high coffee (Apr 5),
   once after a skipped lunch (Apr 11), once after bad sleep (May 4), and once
   with no clear trigger at all (May 11). Planted to see whether the loop would
   over-claim a single clean cause.

4. **Noise / red herrings.** One-off events engineered to look pattern-like but
   aren't: the new espresso machine obsession (Apr 3 & 7, then never again); the
   car that wouldn't start (Apr 23); a one-off fight with Sam that resolves next
   day (Apr 28–29); the dog's vet visit (Apr 25); the dentist (Apr 12); a friend's
   wedding (May 9); and Dorian's glowing review/referrals (May 17).
