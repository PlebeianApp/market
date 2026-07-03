# ADR-0001: Adopt Hierarchical AGENTS.md as Living Operational Guidance, Distinct from Immutable ADRs

## Status

Accepted

## Date

2026-07-03

## Context

The repository previously used a single root `AGENTS.md` focused on beads
issue-tracking workflow and a mandatory session-completion checklist. This
provided no scoped guidance for individual source directories, no separation
between operational instruction and architectural decision-making, and tightly
coupled agent guidance to a specific tool (beads).

As the codebase grew to span multiple domains — Nostr protocol handling,
payment lifecycles, relay data access, e2e testing, deployment workflows, and
shared libraries — the lack of localized, domain-aware guidance created risk
that agents and contributors would make incorrect assumptions about state
boundaries, protocol semantics, and safe operations within each area.

Simultaneously, the repository maintains ADRs in `docs/adr/` as records of
accepted architectural decisions. Without a clear statement of how AGENTS.md
files and ADRs relate, there was ambiguity about which document type governs
what, and whether guidance text could contradict or supersede recorded
decisions.

## Decision

We adopt a two-tier documentation model:

1. **AGENTS.md files are living, mutable operational guidance.** A hierarchical
   system of `AGENTS.md` files — one at the repository root and one per
   relevant subdirectory — provides context, constraints, instructions, and
   safe checks for agents and contributors working in each area. These files
   evolve with the codebase and reflect current operating practice.

2. **ADRs are immutable records of decisions taken.** Architecture Decision
   Records in `docs/adr/` capture the rationale, alternatives, and outcome of
   significant architectural choices at the point they were made. Once
   accepted, an ADR's historical record does not change; new decisions that
   supersede prior ones are recorded as new ADRs with explicit references to
   what they replace.

3. **Precedence for verified behavior is:** current code and tests, accepted
   ADRs, maintainer direction — then AGENTS.md guidance. AGENTS.md files
   describe how to work; they do not prove that behavior exists. When
   guidance conflicts with code, tests, an accepted ADR, or maintainer
   direction, the conflict must be labeled and reconciled explicitly rather
   than silently resolved in favor of the guidance text.

4. **AGENTS.md instructions are binding for all agent roles** — planner, coder,
   and maintainer/reviewer alike. The current lack of role-specific
   instructions is intentional: the initial design introduces guidance in
   broad strokes rather than prescribing per-role detail. Any change to
   repository architecture must be reflected in the relevant AGENTS.md file,
   and no change may go contrary to the instructions it contains.

5. **The AGENTS.md template is itself an evolving artifact.** The initial set
   of sections — Context, Constraints, Instructions, and Safe Checks — provides
   a starting structure. Subdirectory files may expand or introduce additional
   sections to cover repo-wide or subdirectory-specific context, constraints,
   or instructions as the need arises.

## Consequences

- Contributors and agents have scoped, domain-relevant guidance without
  relying on a single monolithic file.
- All agent roles — planner, coder, maintainer/reviewer — share the same
  baseline of operating instructions. Role-specific detail may be layered in
  later, but the initial phase deliberately keeps guidance broad and
  universal.
- Architectural changes carry a documentation obligation: the relevant
  AGENTS.md file must be updated to reflect the new state before or alongside
  the change landing. Code that contradicts AGENTS.md instructions without
  an accompanying guidance update is a process violation.
- The mutable/immutable boundary between AGENTS.md and ADRs is explicit:
  guidance changes as practice evolves; decisions are preserved as historical
  record.
- AGENTS.md files must be maintained alongside code changes that alter
  operating practice. Stale guidance that contradicts verified behavior is a
  known failure mode and must be corrected when discovered.
- Removing the old "Landing the Plane" mandatory-push workflow shifts the
  default from "always push" to "do not push without explicit authorization."
  This aligns with the broader constraint against autonomous deployment,
  workflow triggers, and metadata mutation.