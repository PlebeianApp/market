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

## Test Isolation

Tests must not make network calls to external services. Only the local
relay (`nak serve`) and local dev server (port 3333) are allowed. All
external services (CDNs, mints, Lightning nodes) must be mocked or
intercepted via `page.route()` / `context.route()`.

See ADR-0005 and the repository-level AGENTS.md "Test Isolation" section
for the full policy and established mock patterns.

### Mocks Available

- `e2e/utils/lightning-mock.ts` — LNURL, WebLN, zap receipts
- `e2e/utils/nip46-mock.ts` — NIP-46 remote signer
- `e2e/helpers/lnurl-mock.ts` — LNURL discovery interception

### Intercepting External Requests

Use `page.route()` to intercept requests to external domains and serve
local fixtures or mock responses. See `e2e/tests/product-page.spec.ts`
for the CDN image interception pattern.

## Safe Checks

- `git diff --check`
- `bun run format:check`
- Full e2e execution requires explicit approval.
