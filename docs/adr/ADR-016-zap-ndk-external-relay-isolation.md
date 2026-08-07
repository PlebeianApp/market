# ADR-016: Zap NDK External Relay Isolation

## Status

Accepted

## Date

2026-08-05

## Related

- Extends ADR-0002 (NDK external relay connections cause e2e flakiness)
- PR: PlebeianApp/market#1211

## Context

The app creates a second NDK instance ("Zap NDK") to monitor NIP-57 zap
receipts on public relays. LSPs publish zap receipts to their own public
relays, not the app relay, so the Zap NDK must subscribe there to detect
paid invoices.

This was done unconditionally — even in development, staging, and CI/E2E
tests where the local relay will never receive external zaps. Each page
load opened 7 WebSocket connections to external relays (relay.damus.io,
nos.lol, etc.) that take 5-30s to fail. While pending, Playwright's
`waitForLoadState('networkidle')` in test fixtures never fired, causing
the entire E2E suite to hang until timeout.

## Decision

Gate external Zap NDK connections via a single server-computed boolean
(`externalZapRelaysEnabled`) exposed in `/api/config`. The browser
consumes one decision — no client-side stage checks, no env reads, no
drift between gating sites.

Policy:

| Stage                       | External zap relays | Rationale                                        |
| --------------------------- | ------------------- | ------------------------------------------------ |
| Production                  | ON                  | LSPs publish zap receipts to public relays       |
| Staging                     | OFF                 | Staging events must not reach public relays      |
| Dev + `LOCAL_RELAY_ONLY`    | OFF                 | CI/E2E — external connections hang `networkidle` |
| Dev (no `LOCAL_RELAY_ONLY`) | ON                  | Developers can test zap purchases                |

The server-side `EventHandler.ts` independently applies the same policy
(`isStaging || isLocalOnly`) since it cannot read the `/api/config`
response it produces.

When disabled, the Zap NDK is set to `null` instead of creating a
redundant NDK pointed only at the local relay.

## Consequences

- **Positive:** E2E tests no longer hang on external relay connections.
  ~45 reliable tests can run on every PR (up from 10).
- **Positive:** CI server startup ~15s faster (no external relay
  connection timeouts).
- **Positive:** Normal development unaffected — developers can still
  test zap purchases with external relays.
- **Negative:** Any future feature opening another public relay
  connection will re-introduce the `networkidle` issue. Fixing the
  test fixtures to use `domcontentloaded` + explicit locators (instead
  of `networkidle`) would make the suite robust independently of relay
  egress. This is tracked as a follow-up.
