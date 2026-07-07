# Daydream Loop — Calibration Matrix (4 personas, propose bar 0.8 → 0.6)

The third real-model test of the autonomous daydream loop. Where the first two
ran one persona (Maya), this runs **four distinct people** to ask three
questions at once:

1. **Does anything finally _propose_** once the propose bar drops `0.8 → 0.6`
   (the step that feeds skills/context)?
2. **Does model confidence track _true pattern strength_** across very different
   lives?
3. **Does the `0.55 / 0.6` calibration _generalize_** — including to trading?

> **Read the daydreams blind.** §2 reports what the loop produced and graded;
> the planted patterns (with their intended strengths and the buried sample
> observations) are at the very bottom under **"PLANTED PATTERNS — read last."**
> Read §2–§4 first, then check yourself against the bottom.

- **Model:** `anthropic:claude-opus-4-8` · **Runs:** 8 (2 per persona) ·
  **Total cost:** **$0.7348** (8 calls · 61,257 input / 17,140 output tokens) ·
  **Date:** 2026-06-17
- **The only engine change:** `PROPOSE_CONFIDENCE_THRESHOLD` **`0.8 → 0.6`** in
  [`daydream-loop.ts`](../src/lib/arkive-v2/daydream-loop.ts). Surfacing held
  fixed at `SURFACE_CONFIDENCE_THRESHOLD = 0.55` / `SURFACE_RECURRENCE_THRESHOLD = 2`.
- **Fixtures preserved:**
  [`test-fixtures/daydream-calibration/<persona>/`](../test-fixtures/daydream-calibration)
  — each holds the raw filesystem store (`arkive-store/`: the observation
  stream, the two practices, every daydream, the metering ledger, any
  proposals) plus the run `dump.json`. Seeds + harness:
  [`scripts/daydream-calibration/`](../scripts/daydream-calibration).

---

## 1. Setup

**Four personas**, deliberately different *kinds* of life and four different
cross-cut mechanisms (a hobby buffer, a circadian harm, a behavioural-financial
leak, a sleep→tilt loop) — so the test isn't secretly "find health↔work four
times." Each has **two practices**, ~50–65 observations over ~7–8 weeks
(2026-04-01 → ~2026-05-24), natural uneven timing with two crunch periods. The
loop ran **twice** per persona on Opus.

| Persona | Two practices | Cross-cut mechanism |
|---|---|---|
| **Priya** — secondary-school chemistry teacher | `teaching` · `choir` | hobby-as-buffer (choir week → patient teaching/voice) |
| **Marcus** — ER nurse | `ward` · `running` | circadian harm (night blocks → wrecked runs) |
| **Tomás** — custom-furniture maker | `workshop` · `money` | **non-body**: tight cash → rush → costly mistake |
| **Dana** — retail trader *(confirmation case)* | `trading` · `sleep` | bad sleep → tilt → loss |

**Burial discipline.** Each stream was authored to a strict bar: no observation
ever states or hints at a pattern; patterns are inferable *only* by aligning
multiple entries across dates/practices; cross-cut halves live in entries of
*both* practices that never reference each other. The streams were adversarially
burial-audited (an independent agent tried to detect each pattern from a single
entry) and revised until **zero single-entry cross-cut leaks and zero
self-narration tells** remained, with every cross-cut signal confirmed present
and date-aligned in the aggregate. (Trading was held to the *identical* bar — not
tuned to be easier.)

**Harness notes (faithfulness).**
- Trading is a **built-in/authored practice** the engine ships and the config
  parser re-injects on every read. The three neutral arkives therefore
  **explicitly disable** it, so each run sees exactly its two practices; **Dana
  uses the real built-in `trading` practice** (registered via
  `installPractice(tradingPracticeConfig())`) — the most faithful trading case.
- The core-v1 migration (which would overwrite the config and force-install
  trading) is **suppressed** by writing its marker first; a fresh arkive built
  through the v2 APIs is already canonical, so nothing is lost.

---

## 2. Per-arkive results

Run-level counts (from the metering ledger and `DaydreamPassResult`):

| Persona | Run | written | **surfaced** | **proposed** | recurrences | input tok | output tok | cost |
|---|---|---|---|---|---|---|---|---|
| **Priya** | 1 | 6 | 3 | 0 | 0 | 7,750 | 1,865 | |
| | 2 | 5 | 1 | 0 | 7 | 8,678 | 1,865 | **$0.1754** |
| **Marcus** | 1 | 6 | 4 | 0 | 0 | 6,475 | 1,881 | |
| | 2 | 6 | 3 | 0 | 8 | 7,416 | 2,358 | **$0.1754** |
| **Tomás** | 1 | 8 | 7 | **1** | 0 | 8,686 | 2,542 | |
| | 2 | 5 | 3 | **1** | 7 | 9,903 | 1,765 | **$0.2006** |
| **Dana** | 1 | 8 | 7 | **1** | 0 | 5,617 | 2,631 | |
| | 2 | 5 | 4 | **1** | 9 | 6,732 | 2,233 | **$0.1833** |
| **Total** | **8** | **49** | **29** | **4** | 24 | 61,257 | 17,140 | **$0.7348** |

**Headline:** at the `0.6` bar, **proposals finally fire** — 4 of them, in
**2 of the 4** arkives (Tomás ×2, Dana ×2). The prior tests proposed **nothing**
at `0.8`. Surfacing generalised cleanly to all four people (29 of 49 daydreams
surfaced). Run 2 compounded run 1 in every arkive (24 recurrences recorded; 18 of
the 22 run-2 daydreams carry `created_from` links).

### 2a. Priya (teacher) — 11 daydreams · 4 surfaced · **0 proposed**

Surfaced (conf ≥ 0.55): the **last-period flashpoint** ("Is last period (P5) the
consistent flashpoint? … the smooth lessons tend to be 'first period' or 'period
2'", **0.70**); a **patience↔voice** link ("classroom patience and 'losing it'
incidents track with voice/throat condition", **0.60**, recurrence 2); and a
named **de-escalation technique** with the hardest classes (0.60 / 0.55). The
**cross-cut** appeared as two threads — "is missing choir a marker of low ebb?"
(0.45, `[choir, teaching]`) and "does voice condition act as a shared root cause
for *both* classroom patience AND choir wellbeing?" (0.50, `[teaching, choir]`,
built on two priors) — both stayed just under the bar. **No proposal:** even the
0.70 P5 daydream never emitted an `implies_insight`, so nothing graduated.

### 2b. Marcus (nurse) — 12 daydreams · 7 surfaced · **0 proposed**

The **cross-cut is the star**: "failed long runs cluster within ~48h of a
night-shift block" surfaced at **0.66 with recurrence 3** (the highest recurrence
in the test), reinforced run 2 by "the strongest confirmation yet of the
night-block → failed-long-run chain … could the system flag scheduled long runs
that fall within ~48h of a night block?" (**0.68**). The **understaffing** STRONG
pattern surfaced as a usable proxy ("staffing language itself may be a usable
proxy variable", 0.60), and the **ambiguous-illness** SUBTLE pattern surfaced
*hedged* (0.55, see §5). The loop **correctly isolated the noise**: the heatwave
run was filed as a *separate* time-of-day constraint (0.70), and the leaving-do
hangover run as having "an obvious cause unrelated to the ward" (0.40, unsurfaced).
**No proposal** despite the actionable-sounding 0.68 chain daydream — it never set
`implies_insight`.

### 2c. Tomás (maker) — 13 daydreams · 10 surfaced · **2 proposed** → both `workshop`

Surfaced the **STRONG** under-quoting ("systematically under-quoting time by
~30-40%", 0.66), the **MODERATE** impulse-buy ("buying timber on impulse right
after money arrives", 0.68), the **SUBTLE** friend-job drain ("favour jobs consume
disproportionate time … push the high-value wardrobe past seven weeks", 0.62),
plus deposit-as-working-capital (0.72) and a craft-fair-as-cashflow-smoother idea
(0.55).

**Proposals (both well-formed, in `workshop/insights/pending/`):**
1. **`rushing-precedes-the-costly-mistakes.md`** — `loop_confidence 0.70`,
   `proposed_output: skill`, `provenance_kind: journal`, **3 evidence** (stream
   paths). Body: *"Multiple scrapped-work incidents … were each explicitly
   preceded by hurry … A pre-glue-up / pre-irreversible-cut pause check may
   prevent the most expensive errors."* (From a `[workshop]` daydream.)
2. **`add-a-buffer-to-time-quotes-based-on-past-overrun-rate.md`** —
   `loop_confidence 0.60`, `proposed_output: ask_user`, `provenance_kind:
   journal`, **1 evidence**. Body: *"Applying a fixed buffer (e.g. quoted weeks ×
   1.4) … starting with the oak dining table, could make promises realistic."*
   (From a **`[workshop, money]` cross-cutting** daydream — see routing, §6.)

### 2d. Dana (trader, confirmation case) — 13 daydreams · 11 surfaced · **2 proposed** → both `trading`

The **sleep↔trading cross-cut was the best-assembled in the whole test.** The loop
built the *full causal chain* itself: "short-sleep night (≤5h) precedes the biggest
red days" (**0.72**), "late-night phone screen time … the upstream cause of the
short-sleep nights" (0.68), and then "**late-screen → short sleep → revenge-sizing
red day as a single linked sequence** … 05-22 shows the full chain" (**0.70**,
built on three priors). It found the **STRONG** revenge-sizing (0.78 — the highest
confidence in the test), the **MODERATE** green-giveback (0.60), the **SUBTLE**
alpha-caller losses (0.75), and **saw through the coffee decoy** (§5).

**Proposals (both well-formed, in `trading/insights/pending/`):**
1. **`doubling-size-after-a-stop-out-coincides-with-worst-days.md`** —
   `loop_confidence 0.78`, `proposed_output: ask_user`, `provenance_kind:
   journal`, **6 evidence**. *"A hard rule against increasing size on a re-entry
   within the same session may protect the account."*
2. **`elevated-risk-trading-state-ties-revenge-sizing-and-alpha-group-…md`** —
   `loop_confidence 0.68`, **4 evidence**. Ties the revenge-sizing and
   alpha-group losses into one "elevated-risk state."

Both came from **single-practice `[trading]`** daydreams. The richer
`[sleep, trading]` cross-cut daydreams surfaced as Notices but **did not propose**
(see §6).

---

## 3. THE KEY TABLE — planted strength → found / confidence / surfaced / proposed

Confidence shown is the best (highest) the loop assigned to a daydream expressing
that pattern. "Found" = a daydream clearly articulates the hypothesis.

| Arkive | Planted pattern | **Strength** | Found? | Best conf | Surfaced | Proposed |
|---|---|---|---|---|---|---|
| Priya | Last-period/afternoon is the flashpoint | **STRONG** | ✅ | **0.70** | ✅ | ✗ |
| Priya | Report weeks → depleted patience | MODERATE | ✅ (merged w/ Gerald) | 0.50 | ✗ | ✗ |
| Priya | HoD "Gerald" check-ins precede bad days | SUBTLE | ✅ *hedged* | 0.35–0.50 | ✗ | ✗ |
| Priya | Choir week ↔ patient teaching / voice holds | CROSS-CUT | ✅ (via "voice" mediator) | 0.60 | ✅ | ✗ |
| Marcus | Chronic understaffing he absorbs | **STRONG** | ✅ | 0.60 | ✅ | ✗ |
| Marcus | Long runs collapse after shift runs | MODERATE | ✅ | 0.66 | ✅ | ✗ |
| Marcus | Ambiguous-cause minor illness | SUBTLE | ✅ *hedged* | 0.55 | ✅ | ✗ |
| Marcus | **Night blocks** → wrecked runs + niggles | CROSS-CUT | ✅ **strongly** (rec 3) | **0.68** | ✅ | ✗ |
| Tomás | Underestimates every build | **STRONG** | ✅ | 0.66 | ✅ | ✅→`workshop` |
| Tomás | Impulse buy right after a deposit | MODERATE | ✅ | 0.68 | ✅ | ✗ |
| Tomás | Friend/cheap jobs are the ones that hurt | SUBTLE | ✅ | 0.62 | ✅ | ✗ |
| Tomás | Tight cash → rush → costly mistake | CROSS-CUT *(non-body)* | ⚠️ **partial** — rush→mistake found; cash→rush **not bridged** | 0.70 | ✅ | ✅→`workshop` *(rush half)* |
| Dana | Revenge / oversize after a loss | **STRONG** | ✅ | **0.78** | ✅ | ✅→`trading` |
| Dana | Gives back green opens by the close | MODERATE | ✅ | 0.60 | ✅ | ✗ |
| Dana | Alpha-caller / degen ticker lures | SUBTLE | ✅ (surfaced *high*, see §5) | 0.75 | ✅ | ✅→`trading` *(combined)* |
| Dana | **Bad sleep → tilt → loss** chain | CROSS-CUT | ✅ **fully assembled** | 0.72 | ✅ | ✗ |
| Dana | Coffee/energy-drink **(decoy)** | — | ✅ correctly *rejected* as causal | 0.50 | ✗ | — |

**Does confidence track strength? Largely yes.**
- The **STRONG** patterns took the top confidences in three of four arkives
  (0.78 Dana revenge, 0.70 Priya P5, 0.66 Tomás under-quote) and all surfaced.
- The **speculative reaches stayed low and quiet** — Priya's "Ofsted as
  background stressor" (0.35), Marcus's "forced rest = inadvertent taper" (0.40),
  Priya's "recovery-arc across the term" (0.45) all sat below the bar. The bar
  *separated*, it didn't just lower everything.
- **Two honest wrinkles** (read trends, not decimals): (a) Dana's *SUBTLE*
  alpha-caller pattern surfaced **high (0.75)** because the loss magnitudes (−26%
  to −31%) are salient — *magnitude can inflate a "subtle" pattern's confidence*;
  (b) Tomás's *non-body cross-cut* was only **partially** assembled (next item).

---

## 4. Cross-arkive verdict

**(1) Did anything finally propose at 0.6? Yes — but selectively.** 4 proposals
across 2 arkives. Crucially, **propose ≠ confidence ≥ 0.6 alone.** Priya (0.70 P5)
and Marcus (0.68 night-chain) cleared the confidence bar and surfaced, yet
proposed **nothing**, because the loop only emits an `implies_insight` when the
daydream implies a **durable, actionable rule**. It proposed prescriptions —
*"add a 1.4× time buffer," "a pre-glue-up pause check," "a hard size cap after a
stop-out"* — and withheld on purely **diagnostic** observations — *"P5 is the
flashpoint," "nights wreck runs"* — even at equal or higher confidence. That is a
sensible, conservative behaviour: the loop graduates **levers, not labels**.

**(2) Does confidence track strength? Yes**, with the two wrinkles in §3.

**(3) Does `0.55 / 0.6` generalise — including to trading? Yes.** All four very
different people surfaced their grounded patterns and buried their reaches. **Dana
(trading) behaved like the neutral arkives** — in fact like Tomás (it proposed),
and its cross-cut was the *best-assembled of all four*. The calibration was **not
tuned toward trading**, yet trading was a clean confirmation case.

**One real limit — the non-body cross-cut (Tomás).** The `workshop × money`
cross-cut (tight cash → rush → mistakes) was the only one the loop **did not fully
connect.** It found the workshop-internal half (rush → mistake) *and* the
money-internal patterns (deposit-as-capital, impulse buys) — but never bridged
*cash-stress → rush*. The two body/behaviour cross-cuts (Marcus nights→runs, Dana
sleep→tilt) assembled cleanly; the abstract financial one, whose halves share no
vocabulary, was hardest. Worth watching whether non-body cross-cuts are
systematically harder for the loop.

---

## 5. The SUBTLE / ambiguous patterns — did the loop HEDGE or OVER-CLAIM?

This is as important as whether it found the strong ones: a good loop must **not**
invent a clean cause for a genuinely ambiguous signal. Across every SUBTLE,
ambiguous, and decoy pattern, **the loop hedged correctly and over-claimed
nothing:**

- **Marcus — ambiguous illness (the over-claim trap).** Each niggle was planted
  with ≥2 possible causes. The loop framed it as a **question** and *quoted the
  ambiguity back*: "the runner explicitly hedges 'ward lurgy or burned the candle
  both ends' — but the timing is consistent enough that the immune dip seems
  load-driven" (0.55). It leaned toward a hypothesis without asserting a single
  clean cause, and kept confidence modest.
- **Dana — the coffee decoy (inconsistent with tilt by design).** The loop
  **declined the bait.** A "does caffeine co-occur with jittery trading?" thought
  stayed at 0.50 and **did not surface**; a later thought explicitly reclassified
  it: caffeine-delay is "just a *marker* of the same calm, well-rested morning …
  *correlated facets of one good-state morning rather than independent levers*"
  (0.55). It refused to promote coffee to a cause.
- **Priya — Gerald / HoD (subtle social trigger).** Hedged hard: floated as a
  *possible background stressor* — "might the looming Ofsted rumour and Gerald's
  report-checking be background stressors … even though they aren't named in the
  incident notes?" (0.35) — low confidence, unsurfaced, no asserted causation.
- **Dana — alpha-caller (the one that surfaced high).** The single "subtle"
  pattern that came in *strong* (0.75). This is **not** an over-claim — the −26%
  to −31% losses are real and large; the loop correctly weighted a salient,
  repeated, costly signal. The lesson is calibration, not error: *loss magnitude
  legitimately raises a pattern's confidence*, so "subtle" in authored-frequency
  terms can still be high-confidence when its instances are severe.

Net: the over-claim discipline held in all four arkives. The loop treated
ambiguous evidence as hypotheses, named the competing causes, and never
manufactured certainty.

---

## 6. Observe-only findings (run design unchanged)

**Proposals are physically well-formed insights, not just a count.** All 4
proposals were written to `…/insights/pending/<date>-<slug>.md` as proper
entities carrying `status: pending`, real `evidence` arrays (1–6 stream paths
each), `proposed_output` (`skill` / `ask_user`), `loop_reasoning` (the full
thought), `loop_confidence` (0.60–0.78), and `provenance_kind: journal` (derived
correctly — every proposal is grounded in stream observations, not other
daydreams). Single `.md`, single frontmatter.

**Cross-cutting proposal routing — the concrete behaviour.** The open routing
question (where does a `[a, b]`-tagged insight write?) **did fire once, exactly as
the code predicts.** Tomás's **`[workshop, money]` cross-cutting daydream**
(conf 0.60) proposed — and the engine wrote it to **`workshop` only**. The model
self-selected a single `implies_insight.practice = "workshop"`; the `money` tag
was **silently dropped — no error, no second write, no fan-out**
([daydream-loop.ts:179-197](../src/lib/arkive-v2/daydream-loop.ts) takes the
singular `implies.practice` and passes it straight to `proposeInsight`). The
other three proposals came from single-practice daydreams (no ambiguity). And
notably, the **richest cross-cuts never proposed at all** — Dana's
`[sleep, trading]` chain (0.72) and Marcus's `[running, ward]` chain (0.68)
surfaced as Notices but stayed daydreams, because the loop only emitted
`implies_insight` on single-practice levers. So in practice the routing dilemma is
**mostly sidestepped** (the loop proposes single-practice rules) and, when it does
arise, **resolves by collapsing to one practice and dropping the other** — no
crash, but the cross-practice nature of the insight is lost at the proposal
boundary. **The routing question remains genuinely open** (flagged, not solved).

**Daydreams are correctly practice-tagged across all 4 arkives.** Cross-cutting
daydreams carry **both** tags (`[choir, teaching]`, `[running, ward]`,
`[workshop, money]`, `[sleep, trading]`); single-practice ones carry one; and
general/whole-life thoughts carry **none** (e.g. Priya's "recovery arc across the
term" daydream has no practice tag). The filter to installed practices held — no
daydream was tagged with the disabled phantom `trading` in any neutral arkive.

**Recurrence / `created_from` compounding works in all 4, not just one.** Run 2
recorded 7 / 8 / 7 / 9 recurrences (Priya/Marcus/Tomás/Dana); 18 of 22 run-2
daydreams carry `created_from` links into run 1; and prior daydreams were
re-surfaced when reinforcement cleared the bar (e.g. Marcus's night-block chain
reached **recurrence 3**, Priya's voice link and report-load thoughts reached
recurrence 2). The second pass genuinely read and *built on* the first in every
arkive (Dana's "full chain" daydream is explicitly a synthesis of three priors).

**Metering: all 8 runs wrote a ledger row; costs sum correctly.** Each persona's
`_internal/daydream-runs/` holds exactly **2 rows** (8 total), each with
`run_id`, `model_id`, `input_tokens`, `output_tokens`. Per-persona token sums
match the reported per-run usage, and the four costs sum to **$0.7348**.

**Structure-population gap — re-confirmed (expected).** Every practice across all
four arkives has **only** its `practice.config` + `practice.instructions`;
`journal/`, `skills/`, and `context/` are **empty everywhere**. Observations still
live entirely in the universal stream (63–66 files each). The **only** writes into
a practice subtree are the 4 proposals in `insights/pending/` (Tomás `workshop`
×2, Dana `trading` ×2). So the loop now *proposes* into a practice, but still does
**no "librarian" filing** of per-practice Journal/Context — the gap is unchanged.

---

## 7. Caveats

- **Model confidence is non-deterministic.** Read **trends across arkives**, not
  exact decimals — a 0.62 here could be 0.55 on a re-run. The structural findings
  (strong > reach; hedging on ambiguous; propose = lever not label; cross-cut
  collapses to one practice) are what to trust.
- **"Strength" is authored frequency, not findability.** Dana's *subtle*
  alpha-caller pattern surfaced *high* because its instances were severe. Salience
  (loss size, incident drama) legitimately raises confidence independent of how
  *rarely* a pattern was planted.
- **Fixtures are clean post-fix.** All four `arkive-store/` snapshots are **single
  `.md`, single frontmatter** (0 `.md.md` files) — the frontmatter write-bug fix
  holds for freshly generated stores. (The older `test-fixtures/daydream-real-run`
  snapshot remains pre-fix `.md.md` and is read via the backward-compatible
  reader; it was left untouched.)
- **Same-day proposal slug-collisions** would surface as `proposeFailures`, not
  errors (the filename is `<date>-<slug>`, date-only). None occurred here
  (`proposeFailures: 0` on all 8 runs) — the two proposals per proposing arkive had
  distinct slugs.
- **The phantom built-in `trading` practice** is disabled in the three neutral
  arkives (it appears in `arkive.config` as `enabled: false`) and is the real
  practice for Dana. No neutral arkive's run or daydreams were affected by it.

---
---

## PLANTED PATTERNS — read last

These are the patterns deliberately buried in each seed, with their **intended
strength**. None was ever stated in any single observation; each lives only in
the aggregate (co-occurrence, timing, cross-practice date alignment). Compare
against §2–§5.

**Strength key:** STRONG = recurs often (dominant in aggregate, never announced);
MODERATE = a handful of times, needs a couple entries aligned; SUBTLE = 2–3×,
ambiguous; CROSS-CUT = lives in entries of *both* practices that never reference
each other.

### Priya (teacher) — `teaching` × `choir`
1. **STRONG — afternoon/last-period (P5) is the flashpoint; mornings are fine.**
   Many afternoon entries log a behaviour incident (each blaming the specific
   class/kid), timestamped ~14:00–15:30; morning entries are logged separately and
   positively. The systematic "always last period, never mornings" truth lives in
   the timestamps across entries. → *Found, 0.70, surfaced.*
2. **MODERATE — report-writing weeks → eats at desk / skips lunch → flat.**
   Report-due entries and desk-lunch/flat entries sit a day or two apart and were
   never linked. → *Found (merged with the Gerald thread), 0.50, unsurfaced.*
3. **SUBTLE — Head-of-Dept "Gerald" check-ins precede her worst days.** ~2–3×,
   the down-day never names him. → *Found but hedged, 0.35–0.50, unsurfaced.*
4. **CROSS-CUT — choir-attended weeks → patient teaching + voice holds;
   choir-skipped weeks → frayed temper + lost voice.** Choir entries are about
   singing only; teaching entries about classes only; neither references the
   other. → *Found via the "voice" mediator (0.60, surfaced) + a "missing choir =
   low ebb" thread (0.45–0.50).*
5. **Noise:** broken-boiler cold lab, a fire drill, an Ofsted rumour that fizzles,
   an actual head-cold week (decoy for the voice signal), constant staffroom-tea.

### Marcus (ER nurse) — `ward` × `running`
1. **STRONG — chronic understaffing he just absorbs.** Logged shift by shift,
   never framed as "the problem." → *Found (as a "staffing proxy"), 0.60,
   surfaced.*
2. **MODERATE — long runs collapse/skip after a run of shifts.** → *Found, 0.66,
   surfaced.*
3. **SUBTLE — minor illnesses with deliberately ambiguous cause** (each offers
   ≥2 causes — the over-claim trap). → *Found and correctly hedged, 0.55,
   surfaced.*
4. **CROSS-CUT — night-shift blocks specifically (not days) wreck his running and
   bring the niggles.** Ward entries log shift type as logistics; running entries
   log pace/feel; neither references the other. → *Best-found cross-cut: 0.66–0.68,
   surfaced, recurrence 3.*
5. **Noise:** a one-week new-shoes obsession, one heavy patient case, a leaving-do
   hangover run, a heatwave run, a car-park dispute, protein-shake tweaks. *(The
   loop correctly isolated the heatwave and the hangover as separate causes.)*

### Tomás (furniture maker) — `workshop` × `money`
1. **STRONG — he underestimates every build; commissions overrun.** → *Found,
   0.66, surfaced, proposed.*
2. **MODERATE — impulse timber/tool buys right after a deposit lands.** → *Found,
   0.68, surfaced.*
3. **SUBTLE — friend/referral jobs quoted low are the ones that hurt.** → *Found,
   0.62, surfaced.*
4. **CROSS-CUT (non-body) — tight-cashflow weeks → he rushes → expensive
   mistakes.** Money entries are about cash/invoices only; workshop entries about
   the bench/mistakes only (mistakes cite *time/rush* pressure, never cash); the
   link lives only in week-alignment. → **Partially found:** rush→mistake found
   and proposed (0.70); cash→rush never bridged. *The one cross-cut the loop did
   not fully assemble.*
5. **Noise:** a dust extractor dies once, a warped delivery returned, a craft
   fair, a 2-day helper, blaming humidity inconsistently.

### Dana (retail trader, confirmation case) — `trading` × `sleep`
1. **STRONG — revenge / oversize / flip re-entry after a loss.** Logged as flat
   trade entries; the chase is in the recurrence. → *Found, 0.78 (highest in the
   test), surfaced, proposed.*
2. **MODERATE — gives back green opens by the close.** → *Found, 0.60, surfaced.*
3. **SUBTLE — an "alpha" caller / degen ticker lures the worst trades.** → *Found,
   0.75 (surfaced high — severe losses), proposed (combined with revenge).*
4. **CROSS-CUT — worst P&L / tilt days follow short/bad nights, which follow
   late-night screen time.** Sleep entries are about hours/quality/screens only
   (no tickers/charts); trading entries about P&L/tilt only (no sleep refs); the
   chain lives only in date alignment. → **Fully assembled by the loop** (the
   "late-screen → short sleep → revenge-sizing red day" chain), 0.68–0.72,
   surfaced — but **did not propose** (stayed a cross-cutting Notice).
5. **DECOY — coffee/energy-drink intake, deliberately inconsistent with tilt.** →
   *The loop correctly refused to promote it to a cause (0.50, unsurfaced; later
   reclassified as a correlated marker, not a lever).*
6. **Noise:** a gas-fee spike, an exchange outage, an April tax scramble, a trading
   book read then dropped.
