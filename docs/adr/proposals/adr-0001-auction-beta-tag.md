# ADR-0001: Auction Beta Tag for Kind-30408 Events

## Status

**Proposed**

## Context

Auction events on Plebeian Market use NIP-30408 (kind 30408) addressable
events. As the auction feature moves through beta testing, there is a need to
distinguish experimental or beta-phase auctions from stable, production-ready
auctions. Without a clear marker, clients cannot alert users that they are
interacting with a feature that may still undergo breaking changes.

Legacy auction events already published to relays do not carry any beta
indicator. Any solution must be backwards-compatible: existing events without
the tag should be treated as non-beta, and no protocol-level changes should
be required on relays that already store kind-30408 events.

The beta tag must be:

- **Optional** — present only on auctions explicitly marked as beta
- **Parseable** — clients and servers can detect it without ambiguity
- **Addressable-stable** — survives auction updates (replaceable events with
  the same d-tag)

## Decision

Add a `['beta', 'true']` tag to kind-30408 events that are in beta phase.

The tag follows standard Nostr tag conventions:

- Tag name: `beta`
- Tag value: `true` (string, matching Nostr convention for boolean tags)
- Position: alongside existing auction tags (order not significant)

Client-side behavior:

- The route component (`src/routes/auctions.$auctionId.tsx`) displays a
  "Beta" badge with `data-testid="beta-badge"` when the tag is present
- The `isBetaAuction` helper in `src/queries/auctions.tsx` provides a
  simple boolean check for components

Server-side behavior:

- No server-side enforcement of the beta tag — it is purely informational
- Relay queries can filter by `#beta` tag to find beta auctions

## Consequences

**Positive:**

- Users are clearly informed when viewing a beta auction
- Relay-level filtering by `#beta` tag enables clients to show/hide beta
  auctions based on user preference
- No protocol change required — standard Nostr tag semantics

**Negative:**

- Legacy auctions without the tag are treated as non-beta by default
- If the beta tag is added to an existing auction via an update event,
  older clients that have cached the previous version will not see the
  badge until they refetch

**Neutral:**

- The tag is informational only — no server-side access control is tied to
  the beta tag. Access control is handled separately by the whitelist
  mechanism (see ADR-0002).

## Status

**Proposed** — pending maintainer review. Implementation is complete in the
working tree; this ADR documents the design decision for the record.
