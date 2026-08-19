# ADR-0002: Auction Whitelist Source of Truth

## Status

**Proposed**

## Context

During the beta phase of the auction feature, there is a need to restrict
which pubkeys can publish auction events (kind 30408). Without restriction,
any Nostr user could publish auctions to the marketplace's relay, potentially
creating spam or confusion during the testing period.

The whitelist must be:

- **Configurable** — operators can set the mode and list of allowed pubkeys
- **Default-safe** — in the absence of configuration, the system defaults to
  open mode (see ADR-0005 for rationale)
- **Runtime-evaluated** — changes to the whitelist take effect on server
  restart (env vars are read at startup)

The current server architecture uses `EventValidator` to gate event
acceptance based on event kind and author. A new validation path for
kind-30408 events is needed.

## Decision

Implement server-side auction publishing whitelist via environment variables.

Configuration:

- `AUCTION_WHITELIST_MODE` — either `'open'` (default) or `'whitelist'`
- `AUCTION_WHITELIST_PUBKEYS` — comma-separated list of hex pubkeys

Implementation:

- `AuctionWhitelistManager` class in `src/server/AuctionWhitelistManager.ts`
  manages the mode and pubkey set
- `EventValidator` checks `isAllowed(pubkey)` for kind-30408 events
- `EventHandler` initializes the manager from runtime config and exposes it
  via `getAuctionWhitelist()`
- The `/api/config` endpoint reports the current mode and pubkey count

Future migration path:

- Replace env-var-based whitelist with a Nostr admin list (kind 30000,
  d-tag `auction_whitelist`) so that authorized admins can update the
  whitelist by publishing a signed event rather than editing env vars

## Consequences

**Positive:**

- Operators have immediate control over who can publish auctions
- No code changes needed to adjust the whitelist — just env vars
- The config endpoint exposes whitelist state for client-side UI feedback

**Negative:**

- Centralized control during beta — the whitelist is maintained by the
  server operator, not by Nostr consensus
- Changes require a server restart (env vars are read at startup)
- No audit trail for whitelist changes (unlike a Nostr event-based approach)

**Migration considerations:**

- When the Nostr admin list approach is implemented, the env-var config
  should become the fallback/bootstrap seed, with the admin list event
  taking precedence if present
- The `AuctionWhitelistManager` interface is designed to be swappable —
  the config source can change without modifying the validation logic

## Status

**Proposed** — pending maintainer review. The env-var approach is a
pragmatic beta-phase decision with a clear migration path to decentralized
admin lists.
