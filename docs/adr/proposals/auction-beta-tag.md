# Proposal: Auction Beta Tag

## Status

**Proposed** — implemented on the `auctions` lineage; seeking acceptance as the record of the decision.

**Date:** 2026-08-14

## Context

Auctions are being rolled out progressively on the marketplace. During the
roll-out phase some auctions are published by early-access merchants and run
under features that are still being hardened. Consumers (web UI, future mobile
clients, indexers) need a cheap, self-contained way to tell "this auction
opted into the beta program" from a regular auction, without out-of-band
configuration or a separate event kind.

Nostr conventions already solve this: optional, non-indexed tags on the event
itself. The tag travels with the event to every relay and every client, and
its absence is meaningful (a plain, non-beta auction).

## Decision

Kind-30408 auction events MAY carry an optional `beta` tag:

```
["beta", "true"]
```

- **Format:** exactly `["beta", "true"]`. The tag is a boolean flag; there is
  no versioning, date or free-text payload in this proposal.
- **Emitters:** only the auction publish UI sets it today, on the seller's
  explicit opt-in while creating the auction. The tag is optional — sellers
  publishing regular auctions simply omit it, and legacy events without the
  tag are valid forever.
- **Consumers:** the auction detail page renders a `beta` badge when (and only
  when) the parsed event carries `beta: true`. The tag is informational for
  humans; it gates no protocol behavior, no validation, and no settlement
  rules.
- **Indexing:** `beta` is not a single-letter tag, so it is not addressable
  via NIP-01 `#beta` filters. Clients that want to segment beta auctions must
  fetch normally and filter client-side. This is deliberate — the flag is for
  display, not for relay-side routing.

## Consequences

- Positive: zero-cost backwards compatibility (absence = regular auction); a
  single self-describing event; no extra kind or relay round-trips.
- Positive: the UI can honestly label early-program auctions without leaking
  why they are special.
- Negative: no relay-side filtering; a consumer aggregating only-beta or
  only-non-beta auctions must inspect every event.
- Future: if beta auctions ever need relay-side indexing, the migration path
  is a dedicated single-letter tag or a separate kind, decided in its own ADR.

## Implementation

- Constants: `AUCTION_BETA_TAG_NAME` / `AUCTION_BETA_TAG_VALUE`
  (`src/lib/auction/constants.ts`).
- Emission: auction publish UI (`src/publish/auctions.tsx`).
- Parsing: auction event Zod schema — `beta` is an optional boolean
  (`src/lib/schemas/auction/auctionEvent.ts`).
- Display: `beta-badge` testid on the auction detail page
  (`src/routes/auctions.$auctionId.tsx`).
- Coverage: `e2e/tests/auction-beta-tag.spec.ts` (UI publish round-trip,
  badge presence/absence, persistence across updates).
