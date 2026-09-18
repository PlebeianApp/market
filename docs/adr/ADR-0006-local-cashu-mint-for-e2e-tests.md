# ADR-0006: Local Cashu Mint for E2E Test Infrastructure

## Status

Proposed

## Date

2026-08-20

## Context

ADR-0005 requires tests to avoid external services, and its "Cashu mint
operations" clause describes the only mechanism available at the time:
mint URLs in test fixtures are **inert strings** — no NUT-7 queries, no
mint redemptions, no real NUT-04/NUT-05 mint or melt. Token encoding uses
`getEncodedToken` (a pure function) or pre-computed token strings.

That approach is fine for tests that only need a mint URL to appear in a
seeded event, but it cannot exercise the auction **bid-funding** flow,
which requires a genuine round-trip:

1. Pay a Lightning invoice (mint deposit)
2. Mint e-cash (`NUT-04`)
3. Lock the e-cash to the auction's P2PK output (`NUT-11`)
4. Later redeem or reclaim it (`NUT-05`)

A mock mint cannot produce valid blind signatures, so any bid-funding
test built on a mock would fail at the first redemption. The settlement
work (PR #1144) introduced `e2e/utils/cashu-mint-mock.ts`, whose `/v1/swap`
endpoint echoes `B_` as `C_` without real signatures — deliberately
invalid, and only usable because the settlement tests stub the
verification step. It is not a substitute for a real mint.

## Decision

Run a **real local Cashu mint** in the e2e suite:

- **nutshell** with the **FakeWallet** backend, which auto-settles
  Lightning invoices instantly (no external Lightning node).
- Started by `e2e/start-local-mint.sh` on `127.0.0.1:3338`.
- Configured with a fixed test key, zero fees, rate limit off, and a
  data dir under `/tmp/cashu-mint-e2e`.
- Playwright starts it locally via `webServer`; CI sets up Python 3.12
  and `pip install cashu` (pinning `marshmallow<4.0.0` and
  `limits<5.0.0` to avoid the transitive-dep breaks that crash the mint).
- The app's test wallet points at it via `APP_DEV_TEST_MINT_URL`.

This is a local service, so it is consistent with ADR-0005's rule (it
belongs to the same category as the local relay and local dev server).

## Deprecation of mock mint fixtures

The previous mock approach is **deprecated** for mint flows:

| Deprecated fixture                                                 | Fate                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Inert mint URLs + `getEncodedToken`/pre-computed tokens (ADR-0005) | Superseded by the real mint for bid-funding tests; retained only for tests that need a mint URL as inert data      |
| `e2e/utils/lightning-mock.ts` (wallet/mint deposit path)           | Superseded by the FakeWallet backend for mint-deposit tests; retained for non-wallet Lightning flows (zaps, LNURL) |
| `e2e/utils/cashu-mint-mock.ts` (PR #1144)                          | Planned for removal once its settlement tests migrate to the real mint                                             |

New auction bid-funding tests MUST target the real local mint
(`http://localhost:3338`) rather than a mock.

## Roadmap

1. **Now** — local mint available for auction bid-funding tests.
2. **Later** — migrate existing mint-adjacent tests (`auction-mint-state`,
   `auction-live-chat*`) off external mint URLs (`mint.minibits.cash`,
   `testnut.cashu.space`) onto the local mint.
3. **Later** — remove `e2e/utils/cashu-mint-mock.ts` once the settlement
   tests no longer depend on the invalid-signature stub.
4. **Retain** `lightning-mock.ts` for non-wallet Lightning flows (zaps,
   LNURL payments) indefinitely; only its mint-deposit role is deprecated.

## Consequences

Positive:

- Auction bid-funding is tested against the real protocol (NUT-04 →
  NUT-11 lock → NUT-05), catching failures mocks structurally cannot.
- Removes the "invalid blind signature" footgun that forced settlement
  tests to stub verification.

Trade-offs:

- CI gains a Python + pip step and a service to keep alive (bounded by
  the `marshmallow`/`limits` pins, which are already documented).
- The mock mint fixtures remain in-tree during the transition, so both
  approaches coexist until the roadmap migration completes.

## Related

- ADR-0005: No External Service Dependencies in Tests
- `e2e/start-local-mint.sh`, `e2e/playwright.config.ts`
- `e2e/ARCHITECTURE.md` — "Local Cashu Mint" section
- PR #1144 — `e2e/utils/cashu-mint-mock.ts` (to be retired)
