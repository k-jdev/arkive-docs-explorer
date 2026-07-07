// Authored example practice templates — reference shapes the setup flow learns from.
//
// These are NOT installed on a fresh arkive (unlike trading). They are the
// gold-standard SHAPES the in-chat "set up a new practice" flow pattern-matches
// against: when a user starts a new domain, the model finds the closest shape
// here and adapts it. Each spans a distinct structural shape:
//
//   - fitness  — STATE-heavy   (current program/lifts/metrics; one TRUTH home)
//   - writing  — TRUTH-heavy   (mostly accumulating learned craft truths)
//   - health   — MIXED         (current state + learned triggers; privacy-minded)
//   - sales    — BUSINESS/team  (pipeline state + institutional playbook)
//
// Authored to the same standard as trading (./trading.ts): real journal entity
// types, context files split into STATE (update_mode "replace") vs TRUTH/PATTERN
// (update_mode "accumulate" — the home for accepted insights), sensible
// insight_flow/loading defaults, and a placement playbook. Surfaced to the model
// via the list_practice_templates MCP tool.
//
// GENERATED from a reviewed authoring pass; edit the data below directly.

import type { PracticeConfigFile } from "../schemas";

export type PracticeTemplate = {
  /** Slug used as the practice name in the example config. */
  key: string;
  display_name: string;
  /** The dominant structural shape — used to match a user's domain. */
  shape: "state" | "truth" | "mixed" | "business";
  /** Why this shape; what is STATE vs TRUTH in this domain. */
  shape_rationale: string;
  description: string;
  /** A complete, valid example practice.config. */
  config: PracticeConfigFile;
  /** The operational placement playbook (what goes where + why). */
  placement_instructions: string;
};

export const PRACTICE_TEMPLATES: PracticeTemplate[] = [
  {
    "key": "fitness",
    "display_name": "Strength & Fitness Training",
    "shape": "state",
    "shape_rationale": "Strength training is fundamentally STATE-heavy: at any moment there is one current program/mesocycle, one set of current PRs and working weights, and one current bodyweight/metric snapshot — all of which get overwritten as the lifter progresses, deloads, or recomposes. The discrete history (workouts logged, PRs hit) is append-only EVENT data that feeds progression and trend analysis. The TRUTH layer is real but secondary: a handful of durable, person-specific responses (\"you respond better to lower volume\", \"your squat stalls when you skip sleep\") that accumulate slowly over many cycles. Hence the shape is STATE with a single accumulate TRUTH file as the home for accepted insights.",
    "description": "A structured strength-training practice. Tracks the current program/mesocycle, current PRs and working lifts, and body metrics as live STATE that gets overwritten as it changes; logs workouts and PRs as append-only EVENTS; and accumulates a small set of learned training truths (what works for this body) where accepted insights land.",
    "config": {
      "name": "fitness",
      "version": "1.0.0",
      "based_on": "arkive-core-v1",
      "description": "A structured strength-training practice. Tracks the current program/mesocycle, current PRs and working lifts, and body metrics as live STATE that gets overwritten as it changes; logs workouts and PRs as append-only EVENTS; and accumulates a small set of learned training truths (what works for this body) where accepted insights land.",
      "provides": {
        "journal_entity_types": [
          {
            "name": "workout",
            "folder": "workouts",
            "schema": {
              "required": [
                "workout_id",
                "date",
                "session_type",
                "exercises",
                "sources"
              ],
              "optional": [
                "bodyweight",
                "duration_min",
                "rpe",
                "soreness",
                "sleep_hours",
                "notes"
              ]
            },
            "append_only": true,
            "allowed_mutations": {
              "body_appends": [
                "post_session_note"
              ]
            }
          },
          {
            "name": "pr",
            "folder": "prs",
            "schema": {
              "required": [
                "pr_id",
                "date",
                "lift",
                "value",
                "rep_scheme",
                "sources"
              ],
              "optional": [
                "bodyweight_at_pr",
                "video",
                "notes"
              ]
            },
            "append_only": true
          },
          {
            "name": "checkin",
            "folder": "checkins",
            "schema": {
              "required": [
                "checkin_id",
                "date",
                "metrics",
                "sources"
              ],
              "optional": [
                "photos",
                "subjective_energy",
                "notes"
              ]
            },
            "append_only": true
          }
        ],
        "context_files": [
          {
            "name": "current_program.md",
            "purpose": "The program / mesocycle the user is running right now: split, current week, planned progression, and the week's prescribed sessions.",
            "schema": "structured",
            "structured_fields": [
              {
                "program_name": "string — e.g. '5/3/1 BBB', 'Hypertrophy Block A', 'GZCLP'"
              },
              {
                "goal": "string — strength | hypertrophy | peaking | fat-loss recomp | maintenance"
              },
              {
                "mesocycle_week": "string — e.g. 'Week 3 of 5 (accumulation)'"
              },
              {
                "split": "string — e.g. 'Upper/Lower 4x', 'PPL 6x', 'Full-body 3x'"
              },
              {
                "main_lifts": "string — the prescribed main movements and their current top sets / %1RM"
              },
              {
                "progression_scheme": "string — how load/volume advances week to week; deload trigger"
              },
              {
                "start_date": "string — ISO date this block began"
              }
            ],
            "update_triggers": [
              "program_changed",
              "new_mesocycle_started",
              "deload_scheduled",
              "weekly_recap",
              "user_states_plan"
            ],
            "update_mode": "replace"
          },
          {
            "name": "current_lifts.md",
            "purpose": "The lifter's current working maxes / estimated 1RMs and working weights per main lift — the live strength snapshot used to prescribe loads. Overwritten as PRs land or training maxes are reset.",
            "schema": "structured",
            "structured_fields": [
              {
                "lift": "string — squat | bench | deadlift | OHP | row | accessory name"
              },
              {
                "working_max": "string — current training max or e1RM in kg/lb"
              },
              {
                "best_recent": "string — most recent top set that informs this (weight x reps)"
              },
              {
                "last_updated": "string — ISO date this entry was last changed"
              },
              {
                "trend": "string — progressing | stalled | deloading | maintaining"
              }
            ],
            "update_triggers": [
              "pr_logged",
              "training_max_reset",
              "new_mesocycle_started",
              "weekly_recap"
            ],
            "update_mode": "replace"
          },
          {
            "name": "body_metrics.md",
            "purpose": "Current body snapshot — bodyweight, key measurements, and any tracked physiological markers. Replaced with the latest values; history lives in checkin events.",
            "schema": "structured",
            "structured_fields": [
              {
                "bodyweight": "string — latest weight + unit + measure date"
              },
              {
                "goal_direction": "string — bulk | cut | recomp | maintain, with target if any"
              },
              {
                "measurements": "string — waist/arms/etc if tracked"
              },
              {
                "resting_markers": "string — resting HR, sleep avg, or other markers if tracked"
              },
              {
                "last_updated": "string — ISO date"
              }
            ],
            "update_triggers": [
              "checkin_logged",
              "weekly_recap",
              "user_reports_weight"
            ],
            "update_mode": "replace"
          },
          {
            "name": "training_truths.md",
            "purpose": "Durable, person-specific training truths learned over time — how THIS body responds (recovery patterns, volume tolerance, exercise responders, stall causes). Each accepted insight appends a new dated truth; never overwritten.",
            "schema": "free_form",
            "update_triggers": [
              "insight_accepted",
              "user_explicitly_states_truth",
              "recurring_pattern_confirmed"
            ],
            "update_mode": "accumulate"
          },
          {
            "name": "intentions.md",
            "purpose": "What the lifter is trying to achieve right now — the current training focus or goal framing (e.g. 'add 10kg to squat by autumn', 'lean down to 80kg without losing bench').",
            "schema": "free_form",
            "update_triggers": [
              "user_states_intention",
              "goal_changed",
              "weekly_recap"
            ],
            "update_mode": "replace"
          }
        ],
        "skill_format": {
          "description": "Versioned training playbooks the loop grows — how to act on recurring situations (handling a stall, programming a deload, autoregulating by RPE, returning from a layoff). Each carries an explicit recovery/load envelope so prescriptions stay safe.",
          "required_sections": [
            "when_this_applies",
            "how_to_act",
            "load_and_recovery_envelope"
          ],
          "optional_sections": [
            "exceptions",
            "related_skills",
            "examples"
          ],
          "versioning": "semver_per_skill",
          "envelope_required": true
        }
      },
      "loading": {
        "default_mode": "active",
        "triggers": [
          "workout_logged",
          "lift_mentioned",
          "pr_mentioned",
          "program_discussed",
          "deload_or_stall_mentioned",
          "bodyweight_or_checkin_mentioned",
          "weekly_recap"
        ]
      },
      "insight_flow": {
        "default_output": "context",
        "evidence_threshold": 3,
        "evidence_types": [
          "workout",
          "pr",
          "checkin"
        ],
        "rejection_cooldown_threshold": 10
      },
      "starter_pack": {
        "seed_skills": [],
        "seed_context": [
          "intentions.md"
        ],
        "initial_intentions": [
          "Train consistently and progress the main lifts",
          "Recover well and avoid injury",
          "Learn how my body responds over time"
        ]
      }
    },
    "placement_instructions": "## Where things go (fitness practice)\n\nThis practice is STATE-heavy. Most of what changes session to session is *current state* that should be overwritten, not history that accumulates. Route every piece of information by asking: \"Did something happen at a specific moment?\" (event → journal) vs. \"Is this the current truth about my program/body right now?\" (state → context) vs. \"Is this a durable lesson about how my body responds?\" (truth → accumulate context).\n\n### Events → journal/ (append-only, one file per occurrence)\n- A completed training session → `workouts/` (workout event). Always a NEW file; never edit a past session to \"update\" it. A post-session reflection appends as `post_session_note` on that same file.\n- A new personal record → `prs/` (pr event). One file per PR. PRs are permanent history even after they're beaten.\n- A weigh-in / progress check-in → `checkins/` (checkin event). The dated snapshot of metrics lives here.\nNEVER keep a running \"all my workouts\" file in context — that is the append-only journal's job. NEVER overwrite or delete a logged workout or PR.\n\n### Current state → context/ (read-modify-WRITE the whole file; replace in place)\n- `current_program.md` — the one program/mesocycle being run now. When the block changes, you deload, or the week advances, REPLACE the relevant fields. Do not append old blocks; their record already exists implicitly via the workout history.\n- `current_lifts.md` — current working maxes / e1RMs. When a PR lands or a training max resets, OVERWRITE the affected lift's row. This file should always reflect *today's* numbers, never a log of every number ever hit.\n- `body_metrics.md` — latest bodyweight and markers. Replace with the newest values; the time-series lives in `checkins/`.\n- `intentions.md` — what the lifter is chasing right now. Replace when the goal shifts.\nThe read-modify-write rule: always read the current file, change only what moved, and write the full updated body back. Anti-pattern: appending a new dated block to `body_metrics.md` every week — that turns a STATE file into a junk log; the dated series belongs in checkin events.\n\n### Learned truths → training_truths.md (accumulate; never overwrite)\nThis is the ONLY context file that grows by appending. A durable, person-specific lesson — \"your squat stalls when sleep drops below 6h\", \"you respond better to 12–16 sets/week than 20+\", \"high-bar aggravates your knee, low-bar doesn't\" — appends as a new dated entry. **When an insight is accepted, it lands here** (as a dated truth), unless it is a prescriptive how-to-act procedure, in which case it becomes a versioned skill instead. Never overwrite an existing truth; if one is later contradicted, append the correction as a new entry rather than editing history.\n\n### Quick routing\n- Conclusion / lesson → `training_truths.md` (accumulate). Procedure → skill. Current fact → STATE context (replace). Something that happened → journal (append). NEVER write a conclusion into the append-only journal, and NEVER let a STATE file accumulate dated history."
  },
  {
    "key": "writing",
    "display_name": "Writing Craft",
    "shape": "truth",
    "shape_rationale": "This is a TRUTH/pattern-heavy domain. Almost everything valuable is a learned behavioral truth about the writer's own process — how they draft, when their voice appears, where they reliably stall, which revision moves actually fix things. The only genuine STATE is a thin current-projects list (what is being worked on right now and its phase). Everything else accumulates: craft_truths, process_patterns, voice_notes grow with each accepted insight and are never overwritten, because a truth learned in 2024 is still true in 2026. Events (sessions, drafts, submissions) are append-only history; the conclusions drawn from them are accumulate-context.",
    "description": "A working writer's practice for compounding self-knowledge about their own craft. Logs the discrete events of a writing life (sessions, drafts/revisions, submissions) and accumulates learned behavioral truths about process, voice, and craft so the writer stops relearning the same lessons. Truth-heavy: the durable value is diagnostic self-knowledge (\"you stall when you outline past three levels\", \"your voice only arrives in revision\"), not hard state.",
    "config": {
      "name": "writing",
      "version": "1.0.0",
      "based_on": "arkive-core-v1",
      "description": "A working writer's practice for compounding self-knowledge about their own craft. Logs the discrete events of a writing life (sessions, drafts/revisions, submissions) and accumulates learned behavioral truths about process, voice, and craft so the writer stops relearning the same lessons. Truth-heavy: the durable value is diagnostic self-knowledge (\"you stall when you outline past three levels\", \"your voice only arrives in revision\"), not hard state.",
      "provides": {
        "journal_entity_types": [
          {
            "name": "session",
            "folder": "sessions",
            "schema": {
              "required": [
                "session_id",
                "date",
                "project",
                "phase",
                "duration_min",
                "word_delta",
                "time_of_day"
              ],
              "optional": [
                "energy",
                "location",
                "interruptions",
                "felt_sense",
                "note"
              ]
            },
            "append_only": true
          },
          {
            "name": "draft",
            "folder": "drafts",
            "schema": {
              "required": [
                "draft_id",
                "project",
                "version",
                "status",
                "date",
                "scope"
              ],
              "optional": [
                "word_count",
                "summary_of_changes",
                "feedback_source",
                "note"
              ]
            },
            "append_only": true,
            "allowed_mutations": {
              "status_field": [
                "status: drafting -> revised -> done"
              ],
              "body_appends": [
                "revision_note"
              ]
            }
          },
          {
            "name": "submission",
            "folder": "submissions",
            "schema": {
              "required": [
                "submission_id",
                "work_title",
                "venue",
                "date_sent",
                "status"
              ],
              "optional": [
                "fee",
                "response_date",
                "editor_notes",
                "next_action"
              ]
            },
            "append_only": true,
            "allowed_mutations": {
              "status_field": [
                "status: sent -> rejected -> accepted -> withdrawn"
              ],
              "body_appends": [
                "response_logged"
              ]
            }
          }
        ],
        "context_files": [
          {
            "name": "projects.md",
            "purpose": "The works currently in flight and their phase — what the writer is actively drafting, revising, or shopping right now.",
            "schema": "structured",
            "structured_fields": [
              {
                "title": "working title of the piece"
              },
              {
                "form": "novel / short story / essay / poem / screenplay"
              },
              {
                "phase": "outlining / drafting / revising / submitting / shelved"
              },
              {
                "current_word_count": "approximate length so far"
              },
              {
                "target": "the next concrete milestone for this piece"
              },
              {
                "last_touched": "date of most recent session on it"
              }
            ],
            "update_triggers": [
              "session_logged",
              "draft_completed",
              "phase_changed",
              "user_mentions_new_project",
              "submission_status_changed"
            ],
            "update_mode": "replace"
          },
          {
            "name": "craft_truths.md",
            "purpose": "Durable, hard-won truths about how this writer's craft actually works — diagnostic lessons about structure, scene, pacing, and what reliably fixes a broken draft. Each accepted insight appends a new dated truth; nothing is ever overwritten.",
            "schema": "free_form",
            "update_triggers": [
              "insight_accepted",
              "user_explicitly_states_a_craft_lesson"
            ],
            "update_mode": "accumulate"
          },
          {
            "name": "process_patterns.md",
            "purpose": "Behavioral patterns in how this writer produces work — best/worst times of day, energy and word-count correlations, what causes stalls, what unblocks them, healthy vs. self-defeating habits. Each accepted process insight appends a new dated entry.",
            "schema": "free_form",
            "update_triggers": [
              "insight_accepted",
              "user_states_a_process_observation"
            ],
            "update_mode": "accumulate"
          },
          {
            "name": "voice_notes.md",
            "purpose": "What this writer's voice is and how it surfaces — recurring strengths, tics to watch, the draft stage at which voice appears, register and rhythm preferences, lines/passages that felt true. Each accepted voice insight appends a new dated entry.",
            "schema": "free_form",
            "update_triggers": [
              "insight_accepted",
              "user_reflects_on_their_voice"
            ],
            "update_mode": "accumulate"
          }
        ],
        "skill_format": {
          "description": "A reusable craft playbook the writer can act from — a named move for a recurring situation (e.g. 'when a scene goes inert', 'how to enter a revision pass', 'how to start a session cold').",
          "required_sections": [
            "when_this_applies",
            "how_to_act",
            "why_it_works"
          ],
          "optional_sections": [
            "watch_for",
            "related_skills",
            "examples"
          ],
          "versioning": "semver_per_skill",
          "envelope_required": false
        }
      },
      "loading": {
        "default_mode": "active",
        "triggers": [
          "session_starting",
          "stuck_or_blocked",
          "revision_pass",
          "draft_finished",
          "submission_decision",
          "voice_question",
          "outlining",
          "project_mentioned"
        ]
      },
      "insight_flow": {
        "default_output": "context",
        "evidence_threshold": 3,
        "evidence_types": [
          "session",
          "draft",
          "submission"
        ],
        "rejection_cooldown_threshold": 8
      },
      "starter_pack": {
        "seed_skills": [],
        "seed_context": [
          "projects.md"
        ],
        "initial_intentions": [
          "Write consistently and finish what I start",
          "Learn my own process instead of relearning the same lessons",
          "Let my real voice come through on the page"
        ]
      }
    },
    "placement_instructions": "## Where things go (and why)\n\nThis practice has three homes. Route by asking: did something happen at a moment (journal), is this the current state of a project (STATE context), or is this a durable lesson about how I write (TRUTH context)?\n\n### journal/ — append-only history (one file per event, never rewritten)\n- session — every time the writer sits down to write. Log date, project, phase, duration, word delta, and time_of_day. These are raw data points; never edit a past session to \"correct\" it.\n- draft — a discrete version reaching a milestone (finished a draft, completed a revision pass, sent for feedback). status flips drafting -> revised -> done; a revision_note may be appended. Do not overwrite the prior version — log a new draft.\n- submission — a piece sent out. status flips sent -> rejected/accepted/withdrawn as responses arrive (append the response, don't rewrite the send).\n\nAnti-pattern: do NOT write \"I always write worse after lunch\" into a session file. That is a conclusion, not an event. The session records what happened at 2pm today; the pattern belongs in TRUTH context.\n\n### context/ — current state and learned truth (read the whole file, modify, write the whole file back)\n- projects.md (STATE, replace) — the live list of works in flight and their phase. When a phase changes or a session moves the word count, read the file, update that project's row, write the whole file back. It should never accumulate stale finished projects — shelved/published work drops off (its history lives in the journal).\n- craft_truths.md, process_patterns.md, voice_notes.md (TRUTH, accumulate) — learned self-knowledge. These GROW. Append a new dated entry; never overwrite an old truth, because last year's lesson is still true.\n\n### Where an accepted insight lands\nWhen the loop accepts an insight, it appends (never replaces) to the matching TRUTH file:\n- A diagnostic about the work itself — structure, scene, pacing, what fixes a broken draft -> craft_truths.md.\n- A diagnostic about the writer's behavior — time of day, energy, stalls, blocks, habits -> process_patterns.md.\n- A diagnostic about voice — register, rhythm, tics, when voice appears -> voice_notes.md.\nA prescriptive, repeatable how-to-act move (not just a truth) becomes a skill instead.\n\nAnti-patterns: never park a learned truth in a session file (it will be lost in the timeline); never let projects.md balloon into a log of past work; never overwrite a TRUTH entry to \"update\" it — append a new entry that supersedes it and let the history stand."
  },
  {
    "key": "health",
    "display_name": "Personal Health Management",
    "shape": "mixed",
    "shape_rationale": "This domain is genuinely MIXED because it has two equally load-bearing halves. The STATE half is the set of facts that are true right now and get overwritten as life changes: which medications and supplements you currently take, your current baseline metrics (weight, resting BP, average sleep, resting HR), and your current active symptoms/flare status. The TRUTH half is the slowly-accumulated diagnostic knowledge that should never be overwritten because each entry was earned through repeated observation: learned triggers (\"dairy reliably spikes joint pain ~24h later\", \"you sleep worse the two nights after alcohol\") and what-helps patterns (\"10-min morning walk drops afternoon brain-fog\", \"magnesium before bed improves deep sleep\"). Events (a symptom episode, a doctor visit, a lab panel) are append-only history that feed the pattern engine but are never the place where a conclusion lives.",
    "description": "A structured practice for managing personal health — tracking current medications, supplements, and baseline metrics (current state), logging discrete events (symptom episodes, appointments, test results), and accumulating hard-won learned truths about what triggers symptoms and what helps. Genuinely balanced between mutable current-state facts and slowly-earned behavioral patterns.",
    "config": {
      "name": "health",
      "version": "1.0.0",
      "based_on": "arkive-core-v1",
      "description": "A structured practice for managing personal health — tracking current medications, supplements, and baseline metrics (current state), logging discrete events (symptom episodes, appointments, test results), and accumulating hard-won learned truths about what triggers symptoms and what helps. Genuinely balanced between mutable current-state facts and slowly-earned behavioral patterns.",
      "provides": {
        "journal_entity_types": [
          {
            "name": "symptom_log",
            "folder": "symptoms",
            "schema": {
              "required": [
                "symptom_id",
                "date",
                "symptom",
                "severity",
                "suspected_triggers"
              ],
              "optional": [
                "duration",
                "context",
                "remedies_tried",
                "relief",
                "notes"
              ]
            },
            "append_only": true,
            "allowed_mutations": {
              "body_appends": [
                "resolution_note"
              ]
            }
          },
          {
            "name": "appointment",
            "folder": "appointments",
            "schema": {
              "required": [
                "appointment_id",
                "date",
                "provider",
                "type",
                "reason"
              ],
              "optional": [
                "outcome",
                "follow_up_date",
                "prescriptions_changed",
                "notes"
              ]
            },
            "append_only": true,
            "allowed_mutations": {
              "status_field": [
                "scheduled_to_completed"
              ],
              "body_appends": [
                "visit_summary"
              ]
            }
          },
          {
            "name": "test_result",
            "folder": "test_results",
            "schema": {
              "required": [
                "result_id",
                "date",
                "panel",
                "ordered_by",
                "values"
              ],
              "optional": [
                "reference_ranges",
                "flags",
                "interpretation",
                "notes"
              ]
            },
            "append_only": true,
            "allowed_mutations": {
              "body_appends": [
                "physician_interpretation"
              ]
            }
          }
        ],
        "context_files": [
          {
            "name": "medications.md",
            "purpose": "Current medications and supplements actively being taken — name, dose, frequency, purpose, started_date. Overwritten in place as the regimen changes.",
            "schema": "structured",
            "structured_fields": [
              {
                "name": "name",
                "type": "string",
                "description": "Medication or supplement name"
              },
              {
                "name": "dose",
                "type": "string",
                "description": "Strength per administration, e.g. 500mg"
              },
              {
                "name": "frequency",
                "type": "string",
                "description": "How often, e.g. 2x daily with food"
              },
              {
                "name": "purpose",
                "type": "string",
                "description": "What it is for, e.g. blood pressure, joint pain"
              },
              {
                "name": "started_date",
                "type": "date",
                "description": "When this was started"
              },
              {
                "name": "prescriber",
                "type": "string",
                "description": "Provider who prescribed it, or self if OTC"
              }
            ],
            "update_triggers": [
              "medication_started",
              "medication_stopped",
              "dose_changed",
              "appointment_logged_with_rx_change"
            ],
            "update_mode": "replace"
          },
          {
            "name": "metrics.md",
            "purpose": "Current baseline health metrics — the latest known value for each tracked measure (weight, resting BP, resting HR, average sleep, key recent labs). Replaced in place as new readings arrive.",
            "schema": "structured",
            "structured_fields": [
              {
                "name": "metric",
                "type": "string",
                "description": "Measure name, e.g. weight, resting_bp, avg_sleep"
              },
              {
                "name": "current_value",
                "type": "string",
                "description": "Latest known value with unit"
              },
              {
                "name": "as_of",
                "type": "date",
                "description": "Date of the latest reading"
              },
              {
                "name": "target",
                "type": "string",
                "description": "Goal or clinician-set target, if any"
              },
              {
                "name": "trend",
                "type": "string",
                "description": "Short note on direction, e.g. down from 78kg in Mar"
              }
            ],
            "update_triggers": [
              "new_reading_logged",
              "test_result_logged",
              "weekly_checkin"
            ],
            "update_mode": "replace"
          },
          {
            "name": "baseline.md",
            "purpose": "Current health baseline and active status — the standing picture of how you are right now: active diagnoses/conditions, current flare or remission status, current symptom load, and what 'normal' feels like for you at this moment. Replaced as the baseline shifts.",
            "schema": "free_form",
            "update_triggers": [
              "status_change",
              "flare_started_or_resolved",
              "diagnosis_added",
              "weekly_checkin"
            ],
            "update_mode": "replace"
          },
          {
            "name": "triggers-and-remedies.md",
            "purpose": "Accumulated learned truths about this body — confirmed symptom triggers ('dairy spikes joint pain ~24h later') and what-helps patterns ('magnesium before bed deepens sleep', '10-min morning walk cuts afternoon brain-fog'). Each accepted insight APPENDS a new dated entry with its evidence; never overwritten.",
            "schema": "free_form",
            "update_triggers": [
              "insight_accepted",
              "trigger_confirmed_across_episodes",
              "remedy_confirmed_effective"
            ],
            "update_mode": "accumulate"
          }
        ],
        "skill_format": {
          "description": "A health management playbook — a repeatable protocol for handling a recurring situation (a flare, a trigger-avoidance routine, a pre-appointment prep, a symptom-tracking regimen).",
          "required_sections": [
            "when_this_applies",
            "how_to_act",
            "safety_envelope"
          ],
          "optional_sections": [
            "watch_for",
            "when_to_escalate",
            "related_skills",
            "examples"
          ],
          "versioning": "semver_per_skill",
          "envelope_required": true
        }
      },
      "loading": {
        "default_mode": "private",
        "triggers": [
          "symptom_mentioned",
          "medication_mentioned",
          "appointment_upcoming",
          "test_result_received",
          "flare_reported",
          "metric_logged",
          "sleep_or_diet_mentioned"
        ]
      },
      "insight_flow": {
        "default_output": "context",
        "evidence_threshold": 3,
        "evidence_types": [
          "symptom_log",
          "appointment",
          "test_result"
        ],
        "rejection_cooldown_threshold": 5
      },
      "starter_pack": {
        "seed_skills": [],
        "seed_context": [
          "triggers-and-remedies.md"
        ],
        "initial_intentions": [
          "Track symptoms and metrics consistently enough to spot patterns",
          "Learn what reliably triggers or relieves my symptoms",
          "Arrive at appointments with a clear, current picture of my health"
        ]
      }
    },
    "placement_instructions": "## Where things go (health practice)\n\nThis practice has three storage classes. Route every piece of information by asking: *did something happen at a moment* (event → journal), *is this a fact that is true right now and will change* (current state → STATE context, replace), or *is this a durable truth I learned about my body* (pattern → TRUTH context, accumulate).\n\n### journal/ — append-only events (one file per event, never rewritten)\n- **symptoms/** — a symptom episode at a moment in time. Severity, suspected triggers, what you tried, whether it relieved. Log the episode as it happened; if it later resolves, append a `resolution_note` to that same file — do NOT edit the original observation.\n- **appointments/** — a visit (GP, specialist, dentist, therapist). Reason and outcome. May flip `scheduled → completed`; append a `visit_summary` after the visit.\n- **test_results/** — a lab panel or scan with its values as of that date. A new panel three months later is a NEW file, never an edit of the old one — the history of values IS the data.\n\nNever write a conclusion into the journal. \"Bloodwork on 2026-06-10 showed ferritin 18\" is an event. \"Low ferritin is why I'm fatigued\" is a conclusion — that belongs in TRUTH context once confirmed.\n\n### context/ — current state, READ-MODIFY-WRITE the whole file (replace)\n- **medications.md** — what you take *now*. When you stop a drug, delete its row; when a dose changes, overwrite the row. The file must always read as your current regimen, never a changelog.\n- **metrics.md** — the latest value of each tracked measure. A new weight reading overwrites the old `current_value` and `as_of`; the long history of readings lives in test_results/ and symptom logs, not here.\n- **baseline.md** — how you are right now (active conditions, flare vs remission, current symptom load). Replace when status shifts.\n\nRead-modify-write rule: load the full file, apply the change to the body, write the whole file back. Appending a new line \"Stopped lisinopril\" to medications.md instead of removing the row is the classic anti-pattern — that turns a STATE file into a junk log.\n\n### context/triggers-and-remedies.md — the TRUTH file (accumulate, never overwrite)\nThis is the home for accepted insights. When the loop confirms a pattern across ≥3 events (e.g. three symptom logs all showing joint pain ~24h after dairy), the accepted insight APPENDS a new dated entry here with its supporting evidence: \"Confirmed 2026-06-17: dairy → joint flare ~24h later (logs s-0312, s-0341, s-0359).\" Earlier entries are never edited or deleted — superseding knowledge is added as a new dated entry that references the old one. A prescriptive *routine* built on a trigger (e.g. a dairy-elimination protocol) becomes a **skill**; the diagnostic *truth itself* lives here.\n\n### Anti-patterns\n- Putting \"dairy triggers my flares\" in a symptom log (conclusion in the journal). → triggers-and-remedies.md.\n- Overwriting triggers-and-remedies.md when a new trigger is found (losing history). → append.\n- Keeping a running list of every past weight in metrics.md. → metrics.md holds only the current value; history is the journal.\n- Editing a past test_result to \"correct\" it. → results are immutable; log a new one."
  },
  {
    "key": "sales",
    "display_name": "Sales Pipeline & Consultancy",
    "shape": "business",
    "shape_rationale": "This is a BUSINESS/TEAM domain because the durable value is institutional knowledge, not the deals themselves. STATE in this domain is the live pipeline (each deal's stage, value, owner, next step) and the roster of current clients — facts that are simply wrong the moment a deal moves or a client churns, so they are read-modify-replaced. TRUTH is everything the operation has learned about HOW it wins: which patterns precede a close, which objection gets which response, who the real ICP is, and what pricing holds — these accumulate across deals and outlive any single one. The deal has a genuine lifecycle (lead→qualified→won/lost), so it carries a status_field mutation rather than living only as static history.",
    "description": "A structured-memory practice for a solo or small consultancy / sales operation. It logs the discrete events of selling (calls, meetings, proposals sent, deal stage-changes) as append-only history, tracks the live pipeline and current clients as mutable state, and — most importantly — compounds the institutional knowledge that is the real asset: what actually closes, the objection→response playbook, ICP/qualification learnings, and pricing learnings. The pipeline turns over; the learned truths are the moat.",
    "config": {
      "name": "sales",
      "version": "1.0.0",
      "based_on": "arkive-core-v1",
      "description": "A structured-memory practice for a solo or small consultancy / sales operation. It logs the discrete events of selling (calls, meetings, proposals sent, deal stage-changes) as append-only history, tracks the live pipeline and current clients as mutable state, and — most importantly — compounds the institutional knowledge that is the real asset: what actually closes, the objection→response playbook, ICP/qualification learnings, and pricing learnings. The pipeline turns over; the learned truths are the moat.",
      "provides": {
        "journal_entity_types": [
          {
            "name": "interaction",
            "folder": "interactions",
            "schema": {
              "required": [
                "interaction_id",
                "type",
                "deal_id",
                "contact",
                "channel",
                "summary"
              ],
              "optional": [
                "sentiment",
                "objections_raised",
                "next_step",
                "attendees"
              ]
            },
            "append_only": true
          },
          {
            "name": "deal",
            "folder": "deals",
            "schema": {
              "required": [
                "deal_id",
                "account",
                "stage",
                "value",
                "owner",
                "source",
                "next_step"
              ],
              "optional": [
                "close_date_target",
                "competitor",
                "loss_reason",
                "win_reason"
              ]
            },
            "append_only": true,
            "allowed_mutations": {
              "status_field": [
                "lead_to_qualified",
                "qualified_to_proposal",
                "proposal_to_won",
                "proposal_to_lost",
                "qualified_to_lost"
              ],
              "body_appends": [
                "stage_note"
              ]
            }
          },
          {
            "name": "proposal",
            "folder": "proposals",
            "schema": {
              "required": [
                "proposal_id",
                "deal_id",
                "account",
                "scope",
                "price",
                "status"
              ],
              "optional": [
                "sent_date",
                "valid_until",
                "discount_applied",
                "decision_note"
              ]
            },
            "append_only": true,
            "allowed_mutations": {
              "status_field": [
                "sent_to_accepted",
                "sent_to_rejected",
                "sent_to_revised"
              ],
              "body_appends": [
                "response_note"
              ]
            }
          }
        ],
        "context_files": [
          {
            "name": "pipeline.md",
            "purpose": "The live pipeline: every open deal with its current stage, value, owner, and next step. The single source of truth for 'where does everything stand right now'.",
            "schema": "structured",
            "structured_fields": [
              {
                "account": "Company or client name"
              },
              {
                "deal_id": "Stable id linking to the deal event file"
              },
              {
                "stage": "lead | qualified | proposal | won | lost"
              },
              {
                "value": "Deal size in currency"
              },
              {
                "owner": "Who is driving this deal"
              },
              {
                "next_step": "The single next concrete action"
              },
              {
                "updated": "Date this row last changed"
              }
            ],
            "update_triggers": [
              "deal_created",
              "deal_stage_changed",
              "proposal_sent",
              "deal_won",
              "deal_lost",
              "weekly_pipeline_review"
            ],
            "update_mode": "replace"
          },
          {
            "name": "clients.md",
            "purpose": "Current active clients (closed-won and engaged): account, primary contact, engagement scope, status, and renewal/expansion notes. Overwritten as relationships change.",
            "schema": "structured",
            "structured_fields": [
              {
                "account": "Client company name"
              },
              {
                "primary_contact": "Main point of contact and role"
              },
              {
                "engagement": "What we are delivering"
              },
              {
                "status": "active | paused | at_risk | churned"
              },
              {
                "renewal_or_expansion": "Next renewal date or expansion opportunity"
              }
            ],
            "update_triggers": [
              "deal_won",
              "client_status_changed",
              "engagement_scope_changed",
              "client_churned"
            ],
            "update_mode": "replace"
          },
          {
            "name": "playbook.md",
            "purpose": "Institutional knowledge that compounds — the moat. What-closes patterns, the objection→response playbook, ICP/qualification learnings, and pricing learnings. Each accepted insight appends a new dated entry; nothing here is ever overwritten.",
            "schema": "free_form",
            "update_triggers": [
              "insight_accepted",
              "objection_response_validated",
              "win_loss_pattern_confirmed",
              "icp_learning_confirmed",
              "pricing_learning_confirmed"
            ],
            "update_mode": "accumulate"
          },
          {
            "name": "intentions.md",
            "purpose": "What the operation is focused on right now — current quarter targets, which segment to push, which deals are the priority. Replaced as focus shifts.",
            "schema": "free_form",
            "update_triggers": [
              "user_states_intention",
              "quarterly_planning",
              "weekly_pipeline_review"
            ],
            "update_mode": "replace"
          }
        ],
        "skill_format": {
          "description": "A sales play: a named, repeatable move for a recurring situation (discovery for a segment, handling a specific objection, a pricing/negotiation pattern, a qualification gate). Grown by the insight loop, not declared at setup.",
          "required_sections": [
            "when_this_applies",
            "how_to_act",
            "qualification_gate"
          ],
          "optional_sections": [
            "objection_handling",
            "pricing_guidance",
            "related_skills",
            "examples"
          ],
          "versioning": "semver_per_skill",
          "envelope_required": true
        }
      },
      "loading": {
        "default_mode": "active",
        "triggers": [
          "deal_mentioned",
          "account_mentioned",
          "objection_raised",
          "proposal_being_drafted",
          "pricing_discussed",
          "call_or_meeting_logged",
          "stage_change",
          "pipeline_review"
        ]
      },
      "insight_flow": {
        "default_output": "ask_user",
        "evidence_threshold": 3,
        "evidence_types": [
          "interaction",
          "deal",
          "proposal"
        ],
        "rejection_cooldown_threshold": 8
      },
      "starter_pack": {
        "seed_skills": [],
        "seed_context": [
          "playbook.md"
        ],
        "initial_intentions": [
          "Run a consistent, qualified pipeline",
          "Turn every win and loss into reusable institutional knowledge",
          "Protect pricing and qualify hard before investing time"
        ]
      }
    },
    "placement_instructions": "## Where things go, and why\n\nThis practice separates three kinds of writing. Route by asking: *did something happen at a moment* (journal), *what is true right now* (STATE context), or *what have we learned that compounds* (TRUTH context).\n\n### journal/ — append-only history (events)\nOne file per event, never rewritten.\n- **interactions/** — every call, meeting, email thread, or demo. Each is a frozen record of what was said: who, what channel, the summary, objections raised, agreed next step.\n- **deals/** — the deal as a tracked object. A deal carries a real lifecycle, so its stage flips via allowed_mutations (`lead_to_qualified`, `qualified_to_proposal`, `proposal_to_won`, `proposal_to_lost`, `qualified_to_lost`) and accepts a `stage_note` body-append at each transition. Record the win_reason / loss_reason here at close — that raw signal is what the playbook later learns from.\n- **proposals/** — each proposal sent, with scope and price frozen at send time; status flips `sent_to_accepted | sent_to_rejected | sent_to_revised`.\n\nNever edit a past interaction to reflect a later outcome. The outcome is a NEW event (or a status flip on the deal), not a rewrite of history.\n\n### context/ — current state, read-modify-WRITE the whole body\nBefore writing, read the file, modify the relevant rows, write the full body back. Ask: *\"would this be wrong if I just kept appending?\"* — if yes, it's STATE.\n- **pipeline.md (STATE/replace)** — the live board. When a deal moves stage, update its row in place; do not append a second row for the same deal. When a deal is won or lost, move it out of the open pipeline.\n- **clients.md (STATE/replace)** — active engagements. Update status (active/at_risk/churned) in place.\n- **intentions.md (STATE/replace)** — current focus; overwrite when priorities shift.\n\n### The one TRUTH file — where learning lands\n- **playbook.md (TRUTH/accumulate)** — this is the moat and the home for every accepted insight. A learned diagnostic truth (\"deals from referral source close 2x faster\", \"the 'no budget this quarter' objection is really a champion problem\", \"discounting below X never recovers margin\") APPENDS a new dated entry here. Nothing in playbook.md is ever overwritten — it only grows.\n\n### Routing insights specifically\n- Prescriptive, repeatable *how-to-act* → a **skill** (e.g. \"Discovery play for mid-market\", \"Handling the security-review objection\").\n- A learned *diagnostic truth* (a pattern about what closes, who the ICP really is, what pricing holds) → **playbook.md** (accumulate).\n\n### Anti-patterns\n- Do NOT log a conclusion (\"we should stop discounting\") into the journal — conclusions are not events; they go to playbook.md.\n- Do NOT overwrite a won/lost deal's loss_reason later — open a new interaction if new information arrives.\n- Do NOT keep stale won/lost deals in pipeline.md — STATE reflects only what is live.\n- Do NOT append duplicate pipeline rows on a stage change — replace the row."
  }
];

/** Look up a template by its dominant structural shape. */
export function templateByShape(shape: PracticeTemplate["shape"]): PracticeTemplate | undefined {
  return PRACTICE_TEMPLATES.find((t) => t.shape === shape);
}

/** Compact catalog (no placement bodies) — cheap to surface when choosing a shape. */
export function templateCatalog(): Array<{
  key: string;
  display_name: string;
  shape: PracticeTemplate["shape"];
  shape_rationale: string;
  context_files: Array<{ name: string; update_mode: "replace" | "accumulate"; purpose: string }>;
  journal_entity_types: string[];
}> {
  return PRACTICE_TEMPLATES.map((t) => ({
    key: t.key,
    display_name: t.display_name,
    shape: t.shape,
    shape_rationale: t.shape_rationale,
    context_files: t.config.provides.context_files.map((f) => ({
      name: f.name,
      update_mode: (f.update_mode ?? "replace") as "replace" | "accumulate",
      purpose: f.purpose,
    })),
    journal_entity_types: t.config.provides.journal_entity_types.map((j) => j.name),
  }));
}
