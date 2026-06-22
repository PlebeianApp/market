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

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

## NDK → Applesauce Migration

Full plan & progress checklist: [`docs/ndk-to-applesauce-migration-plan.md`](docs/ndk-to-applesauce-migration-plan.md).
Upstream epic: `PlebeianApp/market#1005`. Worktree: `~/worktrees/ndk-to-applesauce`.

**Do NOT add new `@nostr-dev-kit` imports.** A CI guard (`scripts/check-ndk-footprint.sh`,
baseline `scripts/ndk-baseline.txt`) fails the build if the footprint grows. New
relay I/O must route through the **strangler-fig seam** instead:

```ts
import { fetchEvents, subscribe, publish, sign, getUser } from '@/lib/nostr/io'
```

- `src/lib/nostr/io.ts` — the Port (raw nostr-tools events).
- `src/lib/nostr/io-ndk.ts` — temporary NDK bridge (currently the default adapter).
- `src/lib/nostr/io-applesauce.ts` — destination adapter.

**Migration rules:**

1. **App-first, tests as gate.** Flip app modules off NDK; `bun run test:unit` (and
   the relevant `bun test:e2e -- <spec>` for root-cause waves) must stay green with
   **assertions unchanged**.
2. **Two-step flip per module:** (a) route through `io.*` while still NDK-backed;
   (b) flip that module to applesauce. One revert if wrong.
3. **Stacked PRs, one per wave, base = predecessor.** Only the bottom wave is
   non-draft at a time. Merge target: `PlebeianApp/market` `master`.
4. **Conflict-zone files** (`nip60.ts`, `publish/featured.tsx`, `publish/orders.tsx`,
   `dashboard/index.tsx`) are Wave C — last. `nip60.ts` is handed to the auctions team.
5. **NIP-46 bunker** rewrite is deferred to A3b (gates Wave D).
6. When a wave **reduces** the NDK footprint, lower the baseline in
   `scripts/ndk-baseline.txt` in the same PR so the guard ratchets down.
