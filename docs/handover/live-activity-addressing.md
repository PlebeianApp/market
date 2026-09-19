# Live-activity addressing: the relay tag-index budget

- Status: in-flight (implementation on `fix/live-activity-a-tag-budget`, not merged)
- Date: 2026-09-19
- Decision owner: maintainer ruling of 2026-09-19 (do **not** fix the relay; the
  protocol must work on any relay)
- Scope: kind `30311` (NIP-53 live activity) and kind `1311` (live chat) in the
  auctions line. No auction-event format change.

## The defect, measured

Auction live chat is unreachable on our own relays. The symptom is that
`fetchLiveChatMessages` — an `#a` filter on the live activity's address — returns
nothing, and the CVM worker's participant counter reads `0 / 0` for every
activity, so the panel looks dead even when messages exist.

The cause is not the feature and not the relay's storage: it is the **length of
the `a` value we publish**.

- The relay's storage backend (khatru's boltdb store) indexes a tag **only** when
  the tag name is a single character _and_ the tag value is at most 100
  characters: `if len(tag) < 2 || len(tag[0]) != 1 || len(tag[1]) == 0 || len(tag[1]) > 100 { continue }`
  (`eventstore/boltdb/helpers.go`).
- The query planner gives an `#a` filter "goodness 8", so it builds the query
  from that one index and never falls back to a scan. A longer value is stored,
  indexed nowhere, and returned to nobody.
- Measured A/B on both relays (2026-09-18): `a` values of 96 and 100 characters
  resolve; 101, 121 and 150 characters are stored but return zero results.
- Our coordinates: auction `30408:<seller>:<d>` = **98** (works, 2 chars of
  margin); live activity `30311:<cvm>:auction:<seller-prefix>:<auction-d>` =
  **123** (never works).
- Blast radius: on staging all 7 auction live activities read `0 / 0` and 5 real
  chat messages from 4 users (Aug 13) are unreachable. On production **442 of 500**
  sampled kind-1311 events carry `a` values longer than 100 characters, so most
  of Nostr's live chat is invisible to an `#a` lookup on our relays too. The
  latest upstream version of the backend still carries the same 100-character
  rule, so a dependency bump alone does not fix it.

## The decision

**Respect the budget; do not change the relay.** The relay-side fix is rejected
on principle: this protocol has to work on any relay, including ones we do not
operate and ones whose index rules we cannot change. A design that depends on a
relay patch is not a protocol.

The previous address was also badly shaped independently of its length: its
`d` tag embedded the auction `d` tag verbatim behind a truncated seller prefix
(`auction:<seller[0:16]>:<auction-d>`), which (a) put colons inside the
coordinate's own `d` tag, so naive `<kind>:<pubkey>:<d>` parsing was ambiguous,
(b) truncated a pubkey into the address, and (c) reconstructed the auction
coordinate by string surgery when building the reference tag.

## The format

```
live activity  30311:<cvm pubkey 64 hex>:auction:<12 hex>
               \_______ 71 chars fixed _______/\__ 20 chars __/   = 91 chars

auction (unchanged)  30408:<seller 64 hex>:<auction d tag>          = 98 chars
```

- **`d` tag: `auction:` + the first 12 hex characters of
  `sha256(auction coordinate)`.** 20 characters, 9 of the 29-character budget
  left as headroom. `sha256` of the **coordinate**, not of the bare `d` tag: d
  tags are seller-chosen, so two sellers may legitimately pick the same one, and
  the existing `buildLiveActivityDTag collision prevention` test pins that they
  must not collide.
- **Reference tag on the activity: `['a', <full auction coordinate>]`** — a plain
  NIP-01 `a` tag, 98 characters, inside the budget, so it is indexable and
  resolvable by any client.
- **Chat messages: `['a', <live activity coordinate>, <relay hint>, 'root']`** —
  unchanged shape, now 91 characters instead of 123.

**2-way reachability.**

- _auction → activity_: the derivation is deterministic and documented, so any
  client holding the auction event computes the activity's address with no
  lookup. This is what replaces the lost "seller prefix in the address" and is
  why the hash must stay stable: **changing the derivation re-addresses every
  activity.**
- _activity → auction_: the `a` reference tag above, so an activity found on its
  own still leads back to the auction it belongs to.

## Consequences and follow-ups

- **Stale activities.** Activities published under the retired format keep their
  own addresses and are never superseded (addressable events are keyed by `d`).
  The reader requires an exact match on the derived `d`, so it ignores them; the
  CVM worker publishes a fresh activity under the new address on its next poll.
  A NIP-09 cleanup of the old events (the worker can query them by
  `#a` = auction coordinate + its own author) is a deliberate follow-up, not
  part of this change.
- **Auction `d` tag budget.** The auction coordinate sits at 98 of 100
  characters — 2 characters of margin. Growing the auction `d` tag format by 3
  characters silently breaks auction `#a` lookups on these relays. Worth a
  guard later; not touched here.
- **The discovery filter is not indexable either.** The worker finds auctions to
  advertise with `'#live_chat': ['enabled']`. The index rule requires a
  *single-character* tag name, so that filter cannot use the tag index; the
  planner falls back to a kind scan plus in-memory filtering. It works (the
  worker did create activities on staging), but it is a scan over every auction
  per poll and the obvious next pass if this area gets more attention.
- **`existing` means "an activity with this `a` tag", not "the canonical one".**
  `fetchExistingLiveActivity` filters on the auction coordinate and the issuer
  author, so it also matches activities left behind under the retired format.
  Harmless for publishing (the worker always writes the canonical `d`), and it
  only affects whether the poll reports `created` or `updated`.
- **Third-party live activities.** 442 of 500 sampled production kind-1311
  events are over the budget and stay unreachable through `#a` regardless of
  this change. That is their publishers' problem to fix; our own producer no
  longer contributes to it.
- **Relay-side.** The underlying 100-character rule is upstream behaviour we
  cannot change from here. If it is ever relaxed, this format still works — it
  simply has more headroom than it needs.

## What changed

- `src/lib/nip53.ts` — `RELAY_TAG_INDEX_VALUE_MAX_LENGTH`,
  `LIVE_ACTIVITY_DTAG_MAX_LENGTH`, `AUCTION_HASH_HEX_LENGTH`,
  `isWithinRelayTagIndexBudget`; `buildLiveActivityDTag` now returns the digest;
  `buildLiveActivityTags` takes `auctionCoord` and derives both the `d` and the
  `a` from it (no string surgery, one source of truth).
- `contextvm/tools/live-activity-worker.ts` — passes the auction coordinate
  through and uses `buildLiveActivityCoord` for the address it counts
  participants on.
- `src/queries/liveChat.tsx` — comment only (the derivation is shared).
- `e2e/test-config.ts` — `TEST_CVM_PRIVATE_KEY` / `TEST_CVM_PUBLIC_KEY`, so a
  spec can seed a kind-30311 activity as the identity the app is configured to
  trust.
- `e2e/tests/auction-live-chat.spec.ts`, `auction-live-chat-ui.spec.ts` — the
  seeded activity is now authored by the configured CVM identity and carries the
  derived `d`; both were wrong before, which is why this family could not pass
  (see below).

## Evidence and coverage

- `src/lib/__tests__/nip53.test.ts` — the digest shape, determinism, cross-seller
  separation, no colon leakage, and the budget for a realistic coordinate plus a
  29-character auction `d` tag.
- `src/queries/__tests__/liveChat.test.ts` — the reader's `#d` filter is the
  derived tag and its fixture is a conforming activity.
- `e2e/tests/auction-live-chat.spec.ts` — asserts the activity's author is the
  configured CVM identity, its `d` is the derived digest, its `a` is the full
  auction coordinate, and the activity coordinate fits the budget.
- Baseline vs fixed for the live-chat family (the run that proves the fixture
  bug): see the PR body — the family failed on the base commit and passes here.

## Why the live-chat e2e family was red before this change

Two independent fixture defects, both in the specs rather than the app:

1. the seeded kind-30311 activity was signed by `devUser1`, while the reader
   fails closed on any author other than the configured CVM pubkey
   (`CVM_SERVER_KEY` in the Playwright webServer env →
   `f73cdfc8c0ef0c3c6dd5674bb292838c7385eb40b9a6c247b7bb8ae196674a7c`);
2. the seeded activity carried the auction's bare `d` tag, while the reader
   requires the derived live-activity `d` exactly.

Either one alone makes the app fall back to "Live chat not available", so every
"the chat is visible" assertion in the family was asserting the fallback.
