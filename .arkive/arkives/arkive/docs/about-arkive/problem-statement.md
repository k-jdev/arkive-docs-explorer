---
title: Problem Statement
last_updated: 2026-07-06
---

# Problem Statement

Frontier AI's usefulness in any interaction is bounded by what it knows about the user. A model can reason brilliantly, but reasoning without context produces generic output — what most people would want, not what a specific user needs. As AI's reasoning continues to improve, and as it takes on more of the cognitive load in all domains that require said reasoning, context and memory become the binding constraints on the quality of its output. Every memory feature shipped to date has failed to provide an adequate solution for one simple reason: the failures are structural, not incidental. Three main shortcomings recur across every implementation.

**Decay.** Vendor memory is generative, not accumulative. As new information enters, older information is summarized, compressed, or pruned to fit within model context limits. What survives is a lossy resume of what happened, not a complete record. A user who has interacted with a model for two years has a memory representation that bears only a partial resemblance to those two years of actual interaction. Each summarization step discards detail; each discard compounds. The longer the relationship, the less faithful the memory.

**Lock-in.** Vendor memory is bound to the vendor's system. A user who has built up months of context with one model cannot transport that context to another. Switching models means starting over — manually re-explaining preferences, rules, and history, often imperfectly. The cost of switching grows with the depth of the relationship, which makes the relationship increasingly captive. The user becomes a tenant of the vendor's memory rather than the owner of their own.

**Isolation.** Vendor memory is bound to a single user's account. Two people working on the same project, or a team operating under shared rules, cannot share AI memory in any structured way. Each user maintains a separate, partial picture; the AI cannot reason across them. Teams that depend on shared context — investment partners, research groups, distributed organizations — get no help from the memory layer at all.

These are not implementation failures. They are structural consequences of treating AI memory as a vendor product rather than as user-owned infrastructure. Solving them within the existing model is impossible: a vendor that owns and operates its users' memory will always face commercial pressure to summarize aggressively, lock users in, and gate sharing behind product tiers. The interests of the vendor and the interests of the user diverge by design.

What is needed is an alternative substrate — one where AI memory is structured to compound rather than decay, portable across any model, shareable across users where collaboration is wanted, and owned outright by the user. The remainder of this paper outlines such a substrate.
