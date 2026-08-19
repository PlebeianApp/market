# ADR-0003: V4V Splits on Kind-30408 Auction Events

## Status

**Proposed**

## Context

V4V (Value for Value) splits enable revenue sharing on Nostr content. For
auction events, V4V splits would allow auction creators to designate
multiple recipients who share in the auction proceeds or associated zap
payments. This creates a more flexible economic model for auctions where
platform fees, auditor compensation, or multi-party payouts are needed.

The existing NIP-57 zap split format provides a well-understood tag
structure for specifying split recipients and their respective shares.
Reusing this format on kind-30408 events avoids inventing a new tag
schema and leverages existing client-side parsing logic.

Key questions:

- How should split tags be structured on auction events?
- How do clients parse and display splits to bidders?
- What happens when splits are absent (legacy auctions)?

## Decision

Add V4V split tags to kind-30408 events following the NIP-57 zap split
format.

Tag structure:

```
['zapSplit', recipientPubkey, lud16OrLud06Url, weight, 'label']
```

Where:

- `recipientPubkey` — hex pubkey of the split recipient
- `lud16OrLud06Url` — Lightning address or LNURL pay URL
- `weight` — relative weight (integer; shares are proportional to total weight)
- `label` — human-readable description (e.g., "Platform fee", "Auditor")

Multiple `zapSplit` tags may be present on a single auction event. The
total split is normalized so that weights sum to 100% of the zap amount.

Client behavior:

- Parse all `zapSplit` tags from the auction event
- Display a split breakdown to bidders showing each recipient and their
  percentage share
- If no `zapSplit` tags are present, the entire zap goes to the auction
  creator (default behavior)

## Consequences

**Positive:**

- Reuses NIP-57 format — no new tag schema to maintain
- Clients that already parse NIP-57 zap splits can reuse their parsing logic
- Enables multi-party auction economics (platform fees, auditor compensation)

**Negative:**

- Clients must implement split parsing and display to show the breakdown
- Bidders who send zaps without client-side split awareness may not realize
  their payment is being split
- Weight validation (sum to 100%) is client-side; relays do not enforce

**Open questions for future ADRs:**

- Should the server validate that split weights sum to a reasonable total?
- How are splits handled for settlement (Cashu token splitting)?
- Should split tags be mutable across auction updates?

## Status

**Proposed** — this ADR documents the intended design for V4V splits on
auction events. Implementation is planned for a follow-up PR after the
beta tag and whitelist features are merged.
