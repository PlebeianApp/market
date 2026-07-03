# AGENTS.md — e2e

This directory follows the repository-level AGENTS.md.

## Context

`e2e/` contains Playwright tests, helpers, scenarios, and local test
configuration. The tests exercise browser workflows against app and relay test
infrastructure.

## Constraints

- E2E tests may start services, seed scenario data, and interact with local
  relays. Do not run full e2e, startup, or seed commands without explicit
  approval.
- Keep scenario data cumulative unless the seed scripts and affected tests are
  updated together.
- Treat test keys, wallet material, NWC URIs, and payment fixtures as sensitive
  even when they are only for tests. Do not print or duplicate them in docs.
- Do not treat browser UI state, relay presence, or wallet acknowledgement as
  proof of canonical payment or order state.

## Instructions

- Prefer user-visible Playwright locators where existing tests support them.
- When changing e2e behavior, document required local services and any data
  seeding assumptions.
- Keep protocol assertions explicit: validate event kind, tags, author, and
  expected relay behavior where tests inspect Nostr events.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- Full e2e execution requires explicit approval.
