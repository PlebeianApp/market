# AGENTS.md — docs

This directory follows the repository-level AGENTS.md.

## Context

The current docs tree contains:

- `docs/adr/`: architecture decision records.
- `docs/github-issues/`: issue and review context captured from GitHub work.
- `docs/handover/`: handover material.
- `docs/handovers/`: additional handover material.

ADRs record accepted architecture decisions and should not be contradicted
casually by AGENTS guidance. If docs disagree with code, tests, accepted ADRs,
or maintainer direction, label the conflict and reconcile it explicitly.

## Constraints

- Do not reference documentation directories that are not present in the repo.
- Keep protocol, payment, security, and workflow claims tied to current files,
  accepted ADRs, or maintainer direction.
- Do not use Gamma Market or external specs as proof of repo behavior; label
  those comparisons as external compatibility context.

## Instructions

- Keep docs changes narrow and reviewable.
- When changing an ADR, preserve its decision status and make clear whether the
  change is clarifying an accepted decision or proposing a new one.
- When adding issue or handover notes, avoid secrets and private operational
  details.

## Safe Checks

- `git diff --check`
- `bun run format:check`
