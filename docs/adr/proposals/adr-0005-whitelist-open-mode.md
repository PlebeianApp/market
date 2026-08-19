# ADR-0005: Whitelist Default Open Mode

## Status

**Proposed**

## Context

The auction whitelist system (see ADR-0002) supports two modes:

- `'open'` — any pubkey can publish auction events
- `'whitelist'` — only explicitly listed pubkeys can publish

The choice of default mode has significant operational implications:

- **Defaulting to `whitelist`** would break existing deployments where
  auctions are already being published by unlisted pubkeys
- **Defaulting to `open'`** preserves backwards compatibility but means
  operators must explicitly opt in to restriction

The Plebeian Market codebase has existing deployments and test environments
that do not set `AUCTION_WHITELIST_MODE`. Any default that requires
explicit configuration to maintain current behavior would be a breaking
change.

## Decision

The default mode for the auction whitelist is `'open'`.

Rationale:

- **Backwards compatibility** — existing deployments continue to accept
  all auction events without configuration changes
- **Explicit opt-in for restriction** — operators who want to restrict
  auction publishing must set `AUCTION_WHITELIST_MODE=whitelist` and
  provide `AUCTION_WHITELIST_PUBKEYS`
- **Safe default for testing** — development and CI environments do not
  need to configure whitelist settings to publish test auctions

Implementation:

- `runtime.ts` exports `AUCTION_WHITELIST_MODE` with fallback to `'open'`
  when the env var is not set
- `AuctionWhitelistManager` treats any mode value other than `'whitelist'`
  as `'open'` (defensive default)
- The `/api/config` endpoint reports the effective mode so clients can
  display the current state

## Consequences

**Positive:**

- No breaking change to existing deployments
- Operators have a clear, explicit path to enable restriction
- CI and test environments work without additional configuration

**Negative:**

- Operators who forget to set the mode will run in open mode, potentially
  allowing unwanted auction publications during beta
- The safe default means the whitelist feature is effectively disabled
  until an operator takes action

**Mitigation:**

- Documentation should clearly state that beta deployments should set
  `AUCTION_WHITELIST_MODE=whitelist` to restrict publishing
- The config endpoint exposes the mode so monitoring tools can alert
  when a production deployment is in open mode

## Status

**Proposed** — this ADR documents the default-mode decision that is
implemented alongside the whitelist feature in ADR-0002. The default is
intentionally conservative (open) to avoid breaking existing deployments.
