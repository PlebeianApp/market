# ADR-0003: V4V Recipient Splits as Tags on Kind-30408

## Status

Accepted

## Date

2026-08-19

## Context

The Plebeian Market auction feature needs to support Value-for-Value (V4V) recipient splits — allowing auction creators to designate additional pubkeys that receive a portion of the auction's value, expressed in basis points (bps). For example, a creator might allocate 500 bps (5%) to a validator and 200 bps (2%) to a content creator, with the seller receiving the remainder.

The V4V system already exists for sales (kind-30078 companion events), and the `V4VManager` UI component has been made agnostic via a prior ADR. The question for auctions is: **where do V4V recipient splits live on the auction event?**

The meeting notes identified two options:
1. **Tags on kind-30408** (the auction event itself) — simpler, same event, consistent with existing tag patterns.
2. **Companion parameterized replaceable event** (kind-30078, `d='auction-v4v:{auction_d_tag}'`) — more flexible, can update without re-publishing the auction, but adds complexity and a second event to fetch/subscribe.

Felix (the operator) has decided on tags on kind-30408.

## Decision

### V4V recipient splits stored as tags on the kind-30408 auction event

V4V recipient splits (pubkey + bps pairs) are stored as **tags directly on the kind-30408 auction event**:

```
['v4v_recipient', '<hex_pubkey>', '<bps>']
```

Each `v4v_recipient` tag contains:
- **Element 1**: tag name `'v4v_recipient'`
- **Element 2**: recipient pubkey (64-char hex string)
- **Element 3**: basis points (integer string, e.g., `'500'` for 5%)

Multiple recipients are represented as multiple `v4v_recipient` tags:

```
['v4v_recipient', 'abc123...', '500']
['v4v_recipient', 'def456...', '200']
```

The seller's share is the implicit remainder: `10000 - sum(all v4v_recipient bps)`.

### Consistent with existing tag patterns

This approach is consistent with how other auction data is already stored as tags on kind-30408:
- `mint` tags for Cashu mint URLs
- `auditors` tags for validator pubkeys
- `shipping_option` tags for shipping configuration
- `schema` tag for protocol version

All of these are tags on the auction event itself. V4V recipients follow the same pattern — no companion event, no second relay subscription, no cross-event synchronization.

### Splits are set at auction creation

V4V splits are configured by the seller at auction creation time via the `V4VManager` UI component (now agnostic). The splits are written as tags when `createAuctionEvent()` builds the kind-30408 event. Splits rarely change after creation — they represent the seller's intent for how auction value should be distributed.

## Consequences

### Positive

- **Simplicity**: one event, one subscription, one parse. No companion event to fetch, subscribe to, or synchronize with the auction event.
- **Atomicity**: the V4V splits and the auction metadata are published in a single event. Either the complete auction (with splits) is on the relay, or it isn't. No partial state.
- **Consistency**: matches the existing pattern of putting auction data as tags (`mint`, `auditors`, `shipping_option`). Contributors familiar with the tag pattern can extend it without learning a new event type.
- **Query efficiency**: clients fetching kind-30408 events get V4V splits "for free" — no additional relay round-trip for a companion event.
- **Parser simplicity**: `parseAuctionEvent()` reads `v4v_recipient` tags alongside all other tags in a single pass.

### Negative

- **Requires re-publishing to update splits**: changing V4V splits after auction creation requires re-publishing the entire kind-30408 event (parameterized replaceable). This is a full event replacement, not a delta. For high-frequency split changes, this would be inefficient.
- **Event size**: each `v4v_recipient` tag adds ~80 bytes. With the V1 limit of 16 auxiliary entries, V4V tags add at most ~1.3 KB. This is well within event size limits but worth noting.
- **No independent split updates**: splits are coupled to the auction event's lifecycle. If a creator wants to change splits without touching other auction fields, they still must re-publish the full event (which replaces the old one).

### Mitigations

- **Splits are set at creation and rarely change**: the trade-off of re-publishing is acceptable because splits represent the seller's value-distribution intent, which is established when the auction is created.
- **Replaceable events handle updates**: kind-30408 is a parameterized replaceable event. Re-publishing replaces the old event cleanly. Clients see the latest version via standard relay queries.

## Alternatives Considered

### Alternative 1: Companion parameterized replaceable event (kind-30078, `d='auction-v4v:{auction_d_tag}'`)

**Rejected.** This approach stores V4V splits in a separate kind-30078 event, keyed by the auction's `d` tag. Advantages: splits can be updated independently of the auction event, without re-publishing kind-30408. Disadvantages:
- **Adds complexity**: clients must fetch and subscribe to two events (the auction and the V4V companion) and correlate them by `d` tag.
- **Race conditions**: the companion event may arrive before or after the auction event, requiring handling of "V4V config exists but auction not yet seen" and vice versa.
- **Second relay subscription**: more relay traffic, more failure modes, more code.
- **Inconsistent with auction tag pattern**: `mint`, `auditors`, `shipping_option` are all tags on kind-30408. V4V splits as a companion event would be the only auction-related data stored off-event.

The flexibility of independent updates is not needed because splits are set at creation and rarely change. The simplicity of tags wins.

### Alternative 2: V4V splits in the auction event content (JSON body)

**Rejected.** Tags are the Nostr-native way to attach structured data to events. Putting splits in the content body (as JSON) would require parsing the content separately from tags, break compatibility with relay tag-based filtering, and diverge from the established pattern of using tags for all auction metadata.

## Files Affected

- `src/publish/auctions.tsx` — In `createAuctionEvent()`, emit `['v4v_recipient', pubkey, bps]` tags from `v4vRecipients` in `AuctionFormData`.
- `src/lib/auction/tagBuilders.ts` — Add `v4vRecipients?: Array<{pubkey: string, bps: number}>` to `AuctionEventTagsInput`. Emit `v4v_recipient` tags in `buildAuctionEventTags()`.
- `src/queries/v4v.tsx` — Add auction-specific V4V query hooks that read `v4v_recipient` tags from kind-30408 events (rather than kind-30078 content as sales do).