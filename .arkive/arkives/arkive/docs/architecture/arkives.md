---
title: Arkives
last_updated: 2026-07-06
---

# Arkives

An arkive is a structured set of plain markdown files stored on the user's machine, in a hosted instance, or both. Because the format is plain text, an arkive is human-readable, version-controllable, and exportable as a single folder at any time. There is no proprietary database, no opaque encoding, and no dependency on Arkive's own infrastructure to read or move it. This is a deliberate constraint: a memory standard that aims to be universal and user-owned cannot rest on a format only its author can interpret.

An arkive is organized into four components, each holding a distinct kind of information.

**Journal.** The journal is the complete, append-only record of what has happened — raw data, conversations, decisions, and their outcomes. Nothing in the journal is summarized or overwritten; entries are added, never edited away. The journal is the source of truth from which everything else in the arkive is derived, and the foundation on which context compounds rather than decays.

**Context.** Context holds the current state of affairs: the rules, priorities, and working information a model needs at the start of any interaction. Where the journal is a historical record, context is a live snapshot — what is true *now*. It is read at the beginning of a session so the connected model operates from an accurate picture of the present rather than reconstructing it from raw history each time.

**Insights.** Insights are patterns the connected model surfaces from the journal and context — recurring behaviors, anomalies, or observations the user may not have noticed. Critically, an insight is not applied automatically. It is a proposal: a suggested change to the arkive's rules, skills, or context that the user must approve before it takes effect.

**Skills.** Skills are the connected model's evolving instructions for how to act in specific scenarios. Where context describes what is true, skills describe what to do. They are refined over time as insights are accepted, so the model's behavior sharpens with use rather than remaining static. Each skill is a discrete, inspectable instruction the user can review, edit, or revert.

The separation matters. By isolating the historical record (journal) from the current state (context), the proposed changes (insights) from the standing behavior (skills), an arkive keeps each kind of information in a form suited to how it is used. The journal can grow without bound because it is never read in full; context stays small because it holds only what is current; insights remain auditable because they are explicit proposals rather than silent edits; and skills stay coherent because they are versioned instructions rather than an ever-growing pile of rules. The structure is what allows the arkive to compound without becoming unwieldy.
