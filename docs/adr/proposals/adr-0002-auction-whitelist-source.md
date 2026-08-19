# ADR-0002: Auction Creator Whitelist via Nostr Admin List Event

## Status

Accepted

## Date

2026-08-19

## Context

The Plebeian Market server relay (`EventHandler` / `EventValidator`) currently gates kind-30408 auction events through `validateGeneralEvent()`, which only accepts admin pubkeys. This means only admins can publish auctions through the server relay — too restrictive for a beta where a curated set of non-admin creators should be able to list auctions.

The consultant audit (2026-08-19) found that the auction creator whitelist had **zero implementation**: no `AuctionWhitelistManager`, no `EventValidator` case for kind-30408, no env var, and no `/api/config` exposure.

The meeting notes raised an open question about the whitelist source:
- **Env var** (e.g., `AUCTION_CREATOR_PUBKEYS`): simple, but requires server restart to change.
- **Nostr event** (kind-30000 parameterized replaceable): dynamic, updatable without restart, follows existing `AdminManager`/`EditorManager` pattern.

Felix (the operator) has decided on the Nostr event approach.

## Decision

### Whitelist source: Nostr kind-30000 parameterized replaceable event

The auction creator whitelist is sourced from a **Nostr kind-30000 parameterized replaceable event** with a `d` tag value of `auction-creators`. This event contains `p` tags listing the allowed auction creator pubkeys (in hex).

```
kind: 30000
d: auction-creators
tags: [['p', '<hex_pubkey_1>'], ['p', '<hex_pubkey_2>'], ...]
```

### AuctionWhitelistManager follows AdminManager/EditorManager pattern

A new `AuctionWhitelistManagerImpl` class is created in `src/server/AuctionWhitelistManager.ts`, following the exact pattern of `AdminManager.ts` and `EditorManager.ts`:

- **Subscribes to relay updates** for the kind-30000 `auction-creators` event.
- **Caches locally** — the in-memory set of allowed pubkeys is updated when the replaceable event is replaced.
- **Exposes `isAllowed(pubkey): boolean`** — the single method consumed by `EventValidator`.
- **Dynamic, updatable without server restart** — relay subscription means changes take effect as soon as the new event propagates.

### No env var needed

The whitelist is entirely Nostr-event-driven. There is no `AUCTION_CREATOR_PUBKEYS` environment variable. The source of truth is the kind-30000 event on the relay, not a server configuration file.

This matches how `AdminManager` and `EditorManager` already work — they subscribe to their respective kind-30000 events (`d: 'admins'`, `d: 'editors'`) and cache locally. The auction whitelist follows the same lifecycle.

### Wiring into EventValidator

`EventValidator` gets a new `validateAuctionEvent()` method for kind-30408:
1. `getEventType()` returns `'auction'` for kind 30408.
2. `validateAuctionEvent()` calls `auctionWhitelistManager.isAllowed(event.pubkey)`.
3. If allowed, the event passes. If not, the event is rejected with `"Auction event rejected: pubkey not in auction whitelist"`.

`EventHandler.initialize()` constructs the `AuctionWhitelistManagerImpl`, subscribes it to the relay, and passes it to the `EventValidator` constructor — exactly as it does for `AdminManager` and `EditorManager`.

## Consequences

### Positive

- **Dynamic**: adding or removing an auction creator is a Nostr event publication, not a server restart. Operators can adjust the beta cohort in real-time.
- **Consistent with existing patterns**: `AdminManager` and `EditorManager` already use this approach. New contributors can understand the whitelist by reading the existing managers.
- **No env var management**: no `.env` file edits, no restart coordination, no secrets in environment variables.
- **Auditable**: the kind-30000 event is on the relay, visible to anyone. Changes are transparent and timestamped.
- **Relay-side caching**: the subscription keeps the local cache fresh automatically.

### Negative

- **Relay dependency**: if the relay is unreachable at startup, the whitelist may be empty (defaulting to open mode — see ADR-0005). The `AdminManager` has the same characteristic.
- **Event ordering**: if multiple kind-30000 `auction-creators` events arrive in quick succession, the replaceable event deduplication handles this (only the latest `created_at` wins).
- **No admin bypass by default**: in whitelist mode, admins who are not in the auction whitelist are rejected for kind-30408. This is intentional — admins and auction creators are separate roles. (A future decision could add admin bypass if needed.)

## Alternatives Considered

### Alternative 1: Environment variable (`AUCTION_CREATOR_PUBKEYS`)

**Rejected.** Env vars require a server restart to change. During beta, the creator cohort is expected to change frequently as new testers are onboarded. Restarting the server for each change is operationally disruptive and doesn't match the dynamic Nostr-native architecture of the platform.

### Alternative 2: Kind-30078 application-specific event

**Rejected.** Kind-30078 is used for application-specific parameterized replaceable events (e.g., V4V share config). While technically possible, kind-30000 is the standard for "list of pubkeys" (admin lists, editor lists). Using kind-30000 keeps the whitelist in the same family as the existing admin and editor lists, making the codebase more consistent.

### Alternative 3: Hardcoded list in server config

**Rejected.** Hardcoding requires code changes and deployment to update the whitelist. This is the least flexible option and doesn't match the Nostr-native, relay-driven architecture.

## Files Affected

- `src/server/AuctionWhitelistManager.ts` (NEW) — `AuctionWhitelistManagerImpl` class following `AdminManagerImpl` pattern.
- `src/server/EventHandler.ts` — Wire `AuctionWhitelistManager` into `initialize()`, pass to `EventValidator`.