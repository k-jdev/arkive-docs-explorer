# Daydream Loop — Surfacing Recalibration Test

A clean before/after on **identical input**: the same preserved 65-observation
arkive (persona "Maya", practices `freelance` + `health`), the same model
(**Opus 4.8**), changing **only the surfacing thresholds**. The first real run
(`DAYDREAM_REAL_RUN_TEST.md`) surfaced nothing at the original bar; this re-tests
at a lower bar and asks whether the bar now **separates good from weak** rather
than just lowering everything.

- **Model:** `anthropic:claude-opus-4-8` · **Runs:** 2 · **Cost:** **$0.1293**
  (2 calls, 11,948 input / 2,783 output tokens)
- **Input:** unchanged — the preserved `freelance + health` 65-observation stream
  from `test-fixtures/daydream-real-run/`. Observations were **not** regenerated.
  Only the prior run's daydreams + metering were cleared so the two new passes
  form a clean pair (matching the original test's empty-daydream start).

---

## 1. The change (single variable)

| Constant (`daydream-loop.ts`) | Before | After |
|---|---|---|
| `SURFACE_CONFIDENCE_THRESHOLD` | `0.7` | **`0.55`** |
| `SURFACE_RECURRENCE_THRESHOLD` | `3` | **`2`** |
| `PROPOSE_CONFIDENCE_THRESHOLD` | `0.8` | `0.8` (unchanged — judged separately) |

Surfacing rule (unchanged in shape): a daydream surfaces if
`confidence ≥ SURFACE_CONFIDENCE_THRESHOLD` **OR** `recurrence ≥ SURFACE_RECURRENCE_THRESHOLD`.

---

## 2. Before / after on the same stream

| | daydreams | **surfaced** | proposed |
|---|---|---|---|
| Original run @ `0.7 / 3` | 11 | **0** | 0 |
| Recalibrated @ `0.55 / 2` | 10 | **4** | 0 |

Run split (recalibrated): run 1 wrote 6 (3 surfaced); run 2 wrote 4 (1 surfaced).
`recurrencesRecorded` on run 2 = 5; 4 of run 2's daydreams carry `created_from`
links into run 1 — the second pass again compounded the first.

---

## 3. What surfaced (4) — confidence ≥ 0.55

**`…cef952` · confidence 0.62 · practices [health]** — *cross-cutting*
> The run streak appears to break specifically during busy work weeks ('No time
> this week, I can feel it coming'), and resuming runs reliably improves mood
> ('shoulders dropped', 'felt human again') — is running the first thing
> sacrificed under load even though it's the strongest recovery lever?

**`…0e249d` · confidence 0.60 · practices [health, freelance]** — *cross-cutting (+ the noisy headache thread, correctly hedged)*
> Bad sleep, headaches, and skipped appetite seem to cluster tightly around
> freelance deadline crunches (e.g. Lumen final files) — could deadline intensity
> be the upstream driver of the health dips rather than independent health events?

**`…4fa06b` · confidence 0.58 · practices [freelance] · recurrence 2** — *behavioral tendency*
> Saying yes reflexively to new work ('said yes on the call before I even thought
> about it', 'a quick call, I said yes, I never learn') keeps reappearing right
> after declaring a need for a break — is there a recurring impulse-commitment
> pattern that erodes intended downtime?

**`…aecfe1` · confidence 0.55 · practices [health, freelance] · run 2, built on `…cef952`** — *cross-cutting (running ↔ work quality)*
> Runs aren't just a casualty of busy weeks but seem to be where work creativity
> is generated ('side-project ideas came flooding on the run', short run before a
> strong Lumen session) — could protecting running actually be an investment in
> work output rather than competing with it?

## 4. What stayed quiet (6) — confidence < 0.55

| id | conf | one-line | note |
|---|---|---|---|
| `…08a0bd` | 0.50 | Sam friction is downstream of the overwork/low-sleep cycle | real but secondary/lagging |
| `…baf1c2` | 0.50 | **synthesis:** reflexive-yes + late-night side-projects = one "act before deliberating" impulse | the higher-order cross-thread synthesis — landed **just** under the bar (see §5) |
| `…d031e9` | 0.48 | side-project building eats sleep | plausible, mid-strength |
| `…3474b5` | 0.45 | the highest-reward client (Lumen) is also the deepest burnout | a reach |
| `…b905fc` | 0.45 | referrals/inbound spike around milestones, blocking the break | a reach |
| `…3c3c96` | 0.40 | "the system is self-correcting — wins unlock permission to rest" | **the most speculative reach; correctly buried** |

---

## 5. Did the bar SEPARATE good from weak? (the core question)

**Largely yes.**

- **The strong cross-cutting pattern (running ↔ work quality) surfaced** — twice:
  `cef952` (0.62, running sacrificed under load / strongest recovery lever) and
  `aecfe1` (0.55, protecting running is an investment in work output). The
  deadline-drives-health-dips face of the same pattern also surfaced (`0e249d`,
  0.60).
- **The behavioral tendency (reflexive yes-to-work) surfaced** — `4fa06b` (0.58).
- **The genuinely weak / speculative reaches stayed quiet** — the weakest, a
  "the system self-corrects, wins unlock rest" reach (`3c3c96`, 0.40), correctly
  stayed below the bar, as did the reward↔burnout (0.45) and referrals-spike
  (0.45) reaches. The bar admitted the grounded patterns and excluded the
  speculative ones — it **separated**, it didn't just lower everything.
- **The noisy headache near-pattern was not over-claimed.** Rather than asserting
  a single clean cause, the model folded headaches into the deadline-crunch
  cluster as a hedged question ("could deadline intensity be the upstream driver…
  rather than independent health events?"), which surfaced at 0.60 as part of the
  legitimate cross-cutting hypothesis — not as a spurious "headaches are caused by
  X" claim.

**One honest caveat:** the **higher-order synthesis** — the "no protected boundary
on intake / single low-friction commitment impulse" meta-hypothesis (`baf1c2`) —
landed at **0.50 this run and did NOT surface** (just under the 0.55 bar). Its
component (reflexive-yes, `4fa06b` at 0.58) did surface, so the underlying signal
is visible to the user, but the elegant cross-thread synthesis itself fell just
short. Two readings: (a) 0.55 is roughly the right knife-edge and the synthesis
genuinely sat a notch below the model's most-grounded thoughts this run; or (b) a
bar around **0.50** would also admit the synthesis and the "side-project eats
sleep" (0.48) thought at the cost of also admitting two 0.45 reaches. The current
0.55 favors precision over recall. Worth watching across more runs before moving
it again. (Model output is non-deterministic — confidences shift run to run.)

---

## 6. Proposals & cost

- **Proposals: 0.** The propose bar is still `0.8`; nothing this run reached it
  (top confidence 0.62). Proposal calibration is deliberately out of scope here.
- **Cost: $0.1293** total for both passes (`claude-opus-4-8`, 2 calls,
  11,948 in / 2,783 out tokens), from the metering ledger.

---

## 7. Notes — observed, NOT addressed in this pass (kept single-variable)

These are logged for separate follow-up; neither was touched here.

1. **Write bug — doubled extension + duplicated frontmatter.** Daydream files are
   written as `…<hash>.md.md` (doubled `.md`) and contain **two stacked YAML
   frontmatter blocks** (four `---` delimiters): one alphabetical/JSON-valued
   block followed by a second insertion-ordered/YAML-list block carrying the same
   fields. Confirmed on `…aecfe1.md.md`. Functionally the loop still reads/writes
   correctly, but the on-disk format is wrong and should be fixed separately. The
   same `.md.md` doubling also affects other entry types in the store (e.g.
   `arkive.protocol.md.md`, stream `…<hash>.md.md`).
2. **Empty practices.** `freelance` and `health` exist with valid `practice.config`
   files, but their `journal/`, `insights/`, `skills/`, `context/` folders were
   never populated — observations live in the universal stream (routed via hints),
   and no proposals were written (0 this run), so the practice subtrees stay
   empty. Observed only; not addressed here.
