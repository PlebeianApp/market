# AGENTS.md — Plebeian Market

AGENTS.md records intended contributor and agent operating guidance. Current
code, tests, accepted ADRs, and maintainer direction remain the source of
verified behavior. Conflicts require explicit reconciliation.

## Context

Plebeian Market is a decentralized marketplace built around Nostr events and
Bitcoin/Lightning payment workflows. The repository includes the marketplace
client, ContextVM services, Playwright e2e tests, documentation, scripts,
deployment assets, and GitHub workflow configuration.

Primary directories:

- `src/`: React/TanStack/Bun marketplace application code, including the client
  and current server entry areas.
- `contextvm/`: independently deployed ContextVM service code.
- `e2e/`: Playwright end-to-end tests and scenario fixtures.
- `docs/`: ADRs, GitHub issue notes, and handover material.
- `scripts/`: Bun and shell utility scripts for local and project workflows.
- `.github/`: GitHub Actions workflows and issue templates.
- `public/`: static assets.

AGENTS files are operating guidance. ADRs in `docs/adr/` are accepted
architecture decisions. Code, tests, current behavior, and maintainer direction
still win for verified behavior. Do not use AGENTS text as proof that behavior
already exists.

## Constraints

- Read the relevant directory AGENTS file and parent AGENTS files before
  changing files in that area.
- Keep project boundaries explicit. Do not add direct cross-project imports
  without maintainer approval and matching documentation.
- Preserve the distinction between UI/form state, query/cache state, relay
  state, signed-event state, payment state, backend/service state, local storage
  state, service-assisted payment state, and manual payment state.
- Treat relay data as untrusted until validated. Prefer pubkeys, event IDs,
  coordinates, and tags over display text.
- Do not collapse payment lifecycles into booleans. Keep requested, attempted,
  wallet acknowledged, settled/proven, receipt published, merchant confirmed,
  expired, failed, refunded, and fulfilled states distinct when touching payment
  flows.
- Do not equate wallet acknowledgement, receipt publication, zap presence, or an
  external payment marker with settlement unless current code and maintainer
  direction explicitly define that behavior.
- Avoid printing or committing secrets, private keys, tokens, NWC URIs, Cashu
  seed material, wallet files, or sensitive local configuration.
- Do not commit, push, deploy, trigger workflows, mutate GitHub metadata, or
  change secrets unless explicitly authorized.
- No new event kinds, payment semantics, relay assumptions, or network egress
  paths without code, tests, and documentation that make the decision explicit.
- An outbox-style publisher is an architectural option for future server-side
  work, not a verified current architecture for this repository.

## Instructions

- Inspect current files before changing them. Prefer small, reviewable diffs
  that fit the surrounding code.
- For implementation behavior, cite current code, tests, command output,
  accepted ADRs, or maintainer direction. Label inferred behavior clearly.
- If a change modifies architecture or contributor workflow, update the relevant
  AGENTS file or ADR only when the maintainer-requested scope includes that
  documentation change.
- Use Bun-compatible commands and APIs. Do not assume a Makefile exists.
- `.beads/` exists in this checkout. `bd`/beads can provide supplemental local
  workflow context, but GitHub issues/PRs and current repo files remain the
  canonical public review context. Do not require beads sync, commits, pushes,
  or GitHub updates unless explicitly authorized.

## NDK to Applesauce Wave 0

- New relay I/O should route through `src/lib/nostr/io.ts`.
- The NDK footprint guard tracks literal `@nostr-dev-kit` usage under `src/` and
  `contextvm/`.
- NDK remains the default adapter in Wave 0.
- Do not turn Wave 0 guidance into automatic push, merge, CI rerun, deployment,
  or broad rewrite instructions.

## Safe Checks

For docs-only changes:

- `git diff --check`
- `bun run format:check`

For behavior changes, when relevant and authorized by the task:

- `bun run test:unit`
- `bun run test:integration`

Commands that build, start services, seed data, run generators, deploy, or run
full e2e suites require explicit approval before execution.

## Subdirectory AGENTS.md Template

```markdown
# AGENTS.md — <directory>

This directory follows the repository-level AGENTS.md.

## Context

## Constraints

## Instructions

## Safe Checks
```
