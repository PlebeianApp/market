# ADR-0005: Whitelist Empty-Mode Behavior — Open When Empty

## Status

Accepted

## Date

2026-08-19

## Context

ADR-0002 establishes that the auction creator whitelist is sourced from a Nostr kind-30000 parameterized replaceable event with `d` tag = `auction-creators`. The `AuctionWhitelistManager` subscribes to this event and caches the allowed pubkeys locally.

A critical behavioral question arises: **what happens when the whitelist is empty?** The kind-30000 event may not yet exist on the relay, may have been deleted, or may have been published with no `p` tags. The `AuctionWhitelistManager` must define its behavior in this state.

The meeting notes identified this as open question #5:
> When whitelist is empty, should all pubkeys be allowed (open beta) or none (closed beta)?

The recommended answer was: **open when empty = open beta, populated list = closed beta**. Felix (the operator) has accepted this recommendation.

## Decision

### Empty whitelist = open mode (all pubkeys allowed)

When the whitelist is empty (no pubkeys configured — either the kind-30000 `auction-creators` event doesn't exist, or it exists with zero `p` tags), the `AuctionWhitelistManager` operates in **open mode**: `isAllowed(pubkey)` returns `true` for ALL pubkeys.

This means: **anyone can create auctions when the whitelist is empty.** This is the "open beta" state.

### Populated whitelist = closed mode (only listed pubkeys allowed)

When the whitelist has at least one pubkey (the kind-30000 event exists and contains `p` tags), the `AuctionWhitelistManager` operates in **closed mode**: `isAllowed(pubkey)` returns `true` only for pubkeys in the whitelist.

This means: **only explicitly whitelisted pubkeys can create auctions.** This is the "closed beta" state.

### Kill switch: populate with a dummy pubkey to lock down

The open-when-empty behavior provides a natural **kill switch**: if the operator needs to immediately halt all new auction creation (e.g., due to a security issue or abuse), they publish a kind-30000 `auction-creators` event with a single dummy pubkey (e.g., the operator's own pubkey or a known invalid key). This immediately switches the system to closed mode, and since no real creator has that dummy pubkey, no one can create new auctions.

To re-open: delete the event or publish a new one with no `p` tags. The system returns to open mode.

### Initial beta whitelist

The initial beta whitelist includes the following pubkey:

```
npub1a3um269aaf3u5cy37kuykrrrnsg2pyv7za06pxjduv25lq5sdujs2qmdj6
```

This is the first auction creator authorized for the closed beta. Additional pubkeys may be added by publishing an updated kind-30000 `auction-creators` event. The list may also be cleared to enter open mode.

### Mode is derived, not configured

There is no explicit "mode" env var or config field. The mode is **derived from the whitelist state**:
- `whitelist.size() === 0` → open mode (all allowed)
- `whitelist.size() > 0` → closed mode (only listed allowed)

This eliminates the need for a separate mode toggle and ensures the behavior is always consistent with the whitelist state. The `AuctionWhitelistManager.getMode()` method returns `'open'` or `'whitelist'` based on the current size.

## Consequences

### Positive

- **Safe default**: when the relay has no whitelist event yet (e.g., first boot, relay migration), the system defaults to open. This prevents accidental lockout where no one can create auctions because the whitelist event hasn't been published.
- **Simple kill switch**: populate the list to lock down, clear it to open. No separate mode configuration, no env var, no restart.
- **No mode desync**: because mode is derived from the list state, it's impossible for the mode to be out of sync with the list. Compare with an explicit mode flag that could say "open" while the list has entries — a confusing state.
- **Intuitive for operators**: "empty = open, has entries = restricted" is the natural mental model.

### Negative

- **Cannot lock down to "nobody"**: the empty state is "everyone," not "nobody." If the operator wants to block all auction creation (including for the dummy-pubkey kill switch approach), they must ensure the dummy pubkey is not a real creator's key. In practice, using the operator's own key as the sole entry effectively blocks everyone else.
- **Relay event gap**: if the relay loses the kind-30000 event (e.g., relay wipe, pruning), the system silently switches to open mode. This is a security consideration — operators should monitor the whitelist event's presence.
- **Race condition at startup**: if the relay is slow to deliver the kind-30000 event at server startup, the system briefly operates in open mode until the event arrives. The `AdminManager` has the same characteristic. Mitigation: the subscription updates the cache as soon as the event arrives, closing the window.

### Mitigations

- **Monitoring**: operators can check `GET /api/config` which exposes `auctionWhitelist.mode` and `auctionWhitelist.count`. A sudden switch to `open` mode indicates the whitelist event is missing.
- **Bootstrap event**: the operator should publish the kind-30000 `auction-creators` event before enabling auction creation, ensuring the system starts in closed mode from the beginning.

## Alternatives Considered

### Alternative 1: Empty whitelist = closed (nobody allowed)

**Rejected.** This would mean that if the relay has no whitelist event, no one can create auctions — including the operator. This creates a bootstrapping problem: how do you publish the first whitelist event if you can't access the system? It also creates a lockout risk if the event is accidentally deleted or the relay is wiped.

### Alternative 2: Explicit mode env var (`AUCTION_WHITELIST_MODE=open|whitelist`)

**Rejected.** An explicit mode flag adds a configuration dimension that can desync from the actual list state. For example, mode could be set to `whitelist` while the list is empty — a confusing state where "whitelist mode" actually allows everyone. Deriving mode from the list state eliminates this entire class of bugs.

### Alternative 3: Default to closed with operator override

**Rejected.** This would require a separate "operator override" pubkey that's always allowed, adding complexity. The open-when-empty approach is simpler: the operator's pubkey is simply the first entry in the whitelist when they want closed mode.

## Files Affected

- `src/server/AuctionWhitelistManager.ts` — `isAllowed()` returns `true` when whitelist is empty (size === 0). `getMode()` returns `'open'` when empty, `'whitelist'` when populated.
- `src/server/http/config.ts` — Expose `auctionWhitelist: { mode, count }` in the `/api/config` response so the client can display whether auction creation is open or restricted.