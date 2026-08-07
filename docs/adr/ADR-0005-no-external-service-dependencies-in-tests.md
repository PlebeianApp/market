# ADR-0005: No External Service Dependencies in Tests

## Status

Proposed

## Date

2026-08-03

## Context

Tests run in CI environments (GitHub Actions) where external services
— CDNs, Cashu mints, Lightning nodes, third-party APIs — are unreachable,
rate-limited, or unreliable. When tests depend on these services, they
fail intermittently, eroding trust in the CI signal and wasting developer
time debugging flaky failures that are unrelated to the code under test.

A recent example: the product-page e2e test loaded images from
`cdn.satellite.earth`, which was unreachable from GitHub Actions runners.
The fix (commit `8de113e4`) intercepted the CDN requests with Playwright's
`page.route()` and served a local fixture image. This is the right pattern.

The existing test suite already has well-established mock patterns for
external services:

- **Lightning payments** — `e2e/utils/lightning-mock.ts` intercepts LNURL
  HTTP requests, injects a `window.webln` mock, and publishes zap receipts
  to the local relay. No real Lightning node is contacted.
- **NIP-46 remote signers** — `e2e/utils/nip46-mock.ts` simulates a remote
  signer via the local relay. No external signer service is contacted.
- **LNURL discovery** — `e2e/helpers/lnurl-mock.ts` intercepts
  `.well-known/lnurlp/*` routes with mock responses.

The local relay (`nak serve` on `ws://localhost:10547`) and the local dev
server (`bun dev` on port 3333) are the only external dependencies tests
may have. Both are started in CI workflows and are deterministic.

## Decision

Tests must not make network calls to external services. The only allowed
network dependencies are:

1. **Local relay** (`nak serve`) — started by Playwright's `webServer`
   config, seeded before tests.
2. **Local dev server** (`bun dev`) — started by Playwright's `webServer`
   config, isolated to port 3333.
3. **Other local services** that can be started in CI workflows.

All other external services must be mocked or intercepted:

- **HTTP/HTTPS requests** to external domains — use Playwright's
  `page.route()` or `context.route()` to intercept and serve mock
  responses or local fixtures.
- **WebSocket connections** to external relays — the app is configured
  with `LOCAL_RELAY_ONLY=true` in tests; no external relay connections
  should occur.
- **Cashu mint operations** — mint URLs in test fixtures are inert
  strings; no NUT-7 queries or mint redemptions are performed. Token
  encoding for test fixtures uses `getEncodedToken` (a pure function
  with no network calls) or pre-computed token strings.
- **Lightning payments** — use `LightningMock` which intercepts all
  LNURL and WebLN calls.

### Applicability

This rule applies to:

- `e2e/` — Playwright end-to-end tests
- `src/lib/__tests__/` — unit tests
- Any future test suite

### What This Does NOT Prohibit

- Importing external **packages** (e.g., `@cashu/cashu-ts`,
  `@noble/secp256k1`) in tests — these are npm dependencies, not network
  services. `getEncodedToken` and `hashToCurveHexFromString` are pure
  functions that operate locally.
- Referencing external URLs as **data** (e.g., `https://testnut.cashu.space`
  as a mint URL in a seeded event) — as long as no HTTP request is made
  to that URL.
- Starting local services (relay, dev server, ContextVM) that are part
  of the CI workflow.

## Consequences

Positive:

- CI is deterministic — tests pass or fail based on code, not network
  conditions.
- Developers can run tests offline or behind restrictive firewalls.
- Test failures are always actionable — no more "it works on my machine
  but CI is flaky."
- The mock patterns are already established and documented.

Trade-offs:

- Mocks must be maintained alongside the real services they simulate.
- Some mock setups are complex (Lightning, NIP-46) — but the complexity
  is already paid for and working.

## Related

- ADR-0001: Hierarchical AGENTS.md and ADR docs
- Commit `8de113e4`: fix(e2e): intercept CDN image requests to fix flaky
  product-page test (#1203)
- `e2e/utils/lightning-mock.ts`, `e2e/utils/nip46-mock.ts`,
  `e2e/helpers/lnurl-mock.ts` — established mock patterns
- `e2e/ARCHITECTURE.md` — e2e testing architecture documentation
