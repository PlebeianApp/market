# Path Release Full Trace: Button → Publish → Relay → Query → Validate

## 1. Button Click (`AuctionSettlement.tsx`)

```
handleReleasePath()
  → nip60Actions.settleAuctionAsWinner({ bidEventId: myTopBidEvent.id, releaseReason: 'settlement' })
  → optimistic UI (synthetic ParsedPathReleaseEvent appended)
  → queryClient.invalidateQueries(pathReleases)
  → toast.success('Path release published — seller can now redeem')
```

The CTA appears when `descriptor.cta.kind === 'release-path'`, which requires:
- `role === 'winner'`
- `ended === true`
- `!myAlreadyReleased` (no existing path release for this bid)
- `!!myBidderRecord` (localStorage record exists)
- Settlement window not expired (`now <= maxEndAt + settlementGrace`)

## 2. Publish (`publishBidderPathRelease` in `src/publish/auctions.tsx`)

```
walkBidderRecordChain(bidEventId)  → chain: BidderBidRecord[]
  for each leg:
    getEncodedToken({ mint: leg.mintUrl, proofs: leg.proofs })  → cashuToken
    buildPathReleaseTags({
      bidEventId, auctionCoordinate, sellerPubkey,
      derivationPath, childPubkey, releaseReason,
      cashuToken
    })
    new NDKEvent(ndk)
    event.kind = 1025
    event.tags = [e, a, p, derivation_path, child_pubkey, release_reason, cashu_token]
    event.sign(signer)
    ndkActions.publishEvent(event, getWriteRelaySet())
```

### Published event structure (kind 1025):
```
{
  kind: 1025,
  pubkey: <bidder's pubkey>,     // event.author
  content: '',                    // optional note
  tags: [
    ['e', bidEventId],
    ['a', auctionCoordinate],     // "30408:<seller_pk>:<d_tag>"
    ['p', sellerPubkey],
    ['derivation_path', 'm/0'],
    ['child_pubkey', childPubkey],
    ['release_reason', 'settlement'],
    ['cashu_token', 'cashuB<base64>'],
  ]
}
```

### Relay delivery:
- `publishEvent(event, getWriteRelaySet())`
- `getWriteRelaySet()` in dev/staging → `NDKRelaySet.fromRelayUrls([getMainRelay()], ndk)`
- In production → `undefined` (all connected relays)
- `event.publish(relaySet)` → sends to each relay in the set

## 3. Listener Query (`useAuctionPathReleases` in `src/queries/auctions.tsx`)

```
useAuctionPathReleases(auctionRootEventId, 200, auctionCoordinates)
  → fetchAuctionPathReleases(auctionEventId, 200, auctionCoordinates)
    → buildAuctionPathReleaseFilter(auctionCoordinates, 200)
      → { kinds: [1025], '#a': [auctionCoordinates], limit: 200 }
    → ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: 8000 })
    → filterBlacklistedEvents(events)
    → .filter(event => isAuctionPathReleaseForCoordinate(event, coordinate))
    → .sort(by created_at desc)

staleTime: 5000, refetchInterval: 5000  (refetches every 5 seconds)
```

### `isAuctionPathReleaseForCoordinate`:
```ts
event.tags.some(tag => tag[0] === 'a' && tag[1] === auctionCoordinates)
```
This double-checks the `a` tag matches the coordinate. The relay filter `#a` already does this, but this is a client-side safety net.

## 4. Parse (route `auctions.$auctionId.tsx`)

```
pathReleasesQuery.data (NDKEvent[])
  → .map(pr => parsePathReleaseEvent(pr.rawEvent()))
  → .filter(r => r.ok)
  → .map(r => r.value)  → ParsedPathReleaseEvent[]
```

### `parsePathReleaseEvent` extracts:
| Tag           | Parsed field        | Zod validation                          |
|---------------|---------------------|-----------------------------------------|
| `e`           | bidEventId          | nostrEventIdHex (64 hex)                |
| `a`           | auctionCoordinate   | addressableCoordinate                   |
| `p`           | sellerPubkey        | nostrPubkeyHex                           |
| `derivation_path` | derivationPath | bip32Path                               |
| `child_pubkey`| childPubkey         | compressedPubkeyHex (33 hex, 02/03)     |
| `release_reason` | releaseReason  | enum: settlement, fallback_settlement, voluntary_late |
| `cashu_token` | cashuToken          | string.min(1), optional                 |
| `auditor_ref` | auditorRefs         | array, default []                       |
| `fallback_offer` | fallbackOfferId | optional                               |

**Any Zod parse failure → event silently dropped** (`.filter(r => r.ok)`)

## 5. Descriptor Validation (`getSettlementDescriptor`)

```
postCloseDecision = !ended ? null
  : (rawSettlementWinner && rawSettlementWinner !== topBid.bidderPubkey)
    ? 'loser' : 'winner'

pathReleases = topBid
  ? rawPathReleases.filter(pr => isValidPathRelease(auction, topBid, pr, now, postCloseDecision))
  : []
```

### `isValidPathRelease` → `validatePathRelease` checks (IN ORDER):

| # | Check                                   | Failure code                    |
|---|-----------------------------------------|---------------------------------|
| 1 | release.bidderPubkey === bid.bidderPubkey | unauthorized_signer          |
| 2 | release.bidEventId === bid.id            | bid_reference_mismatch          |
| 3 | release.auctionCoordinate === bid.auctionCoordinate === auction.coordinate | auction_mismatch |
| 4 | release.sellerPubkey === bid.sellerPubkey === auction.sellerPubkey | seller_mismatch |
| 5 | validateReleaseReason(postCloseDecision, releaseReason) | release_reason_invalid |
| 6 | deriveAuctionChildP2pkPubkeyFromXpub(auction.p2pkXpub, release.derivationPath) succeeds | derivation_invalid |
| 7 | derivedChildPubkey === release.childPubkey | child_pubkey_mismatch        |
| 8 | derivedChildPubkey === bid.childPubkey  | child_pubkey_mismatch           |
| 9 | release.cashuToken exists               | cashu_token_missing            |
| 10 | getDecodedToken(release.cashuToken) succeeds | cashu_token_decode_failed  |
| 11 | decodedToken.proofs.length > 0          | cashu_token_proof_count_mismatch |
| 12 | decodedToken.proofs.length === bid.proofYs.length | cashu_token_proof_count_mismatch |
| 13 | decodedToken.mint === bid.mint (normalized) | cashu_token_mint_mismatch  |
| 14 | For each proof: parseAuctionLockSecret matches bid's locktime, childPubkey, refundPubkey | cashu_token_lock_mismatch |
| 15 | Each proof.secret is in bid.lockSecrets | cashu_token_secret_mismatch     |
| 16 | hashToCurve(proof.secret) is in bid.proofYs | cashu_token_proof_y_mismatch |
| 17 | All bid secrets consumed (no missing)   | cashu_token_secret_mismatch     |
| 18 | All bid proofYs consumed                | cashu_token_proof_y_mismatch    |
| 19 | sum(proof.amounts) === bid.amount       | cashu_token_amount_mismatch     |

**Any check failure → event silently filtered out** (not in `pathReleases`)

## 6. Critical Data Flow — What the bidder publishes vs what the validator checks

### Published from bidder record (localStorage):
```
leg.auctionCoordinate  → tag 'a'          → parsed.auctionCoordinate   → check #3 (vs auction.coordinate)
leg.sellerPubkey        → tag 'p'          → parsed.sellerPubkey       → check #4 (vs auction.sellerPubkey)
leg.derivationPath      → tag 'derivation_path' → parsed.derivationPath → check #6 (derive from auction.p2pkXpub)
leg.childPubkey         → tag 'child_pubkey'    → parsed.childPubkey    → check #7 (vs derived), #8 (vs bid.childPubkey)
leg.mintUrl + proofs    → tag 'cashu_token'    → parsed.cashuToken      → checks #9-19
leg.bidEventId          → tag 'e'              → parsed.bidEventId      → check #2 (vs bid.id)
event.sign(signer)      → event.pubkey         → parsed.bidderPubkey   → check #1 (vs bid.bidderPubkey)
'settlement'            → tag 'release_reason' → parsed.releaseReason  → check #5 (postCloseDecision must be 'winner')
```

### Cross-referenced against:
- **auction** (from kind-30408 event): `auction.coordinate`, `auction.sellerPubkey`, `auction.p2pkXpub`
- **bid** (from kind-1023 event): `bid.bidderPubkey`, `bid.id`, `bid.auctionCoordinate`, `bid.sellerPubkey`, `bid.childPubkey`, `bid.locktime`, `bid.refundPubkey`, `bid.lockSecrets`, `bid.proofYs`, `bid.mint`, `bid.amount`

### Key insight: the `auctionCoordinate` in the bidder record MUST match the `auctionCoordinate` in both the auction event AND the bid event. If the bidder placed a bid with a coordinate that differs from the auction page's computed coordinate, the path release will be filtered out.

## 7. Existing E2E Tests

### Test 1: "clicking Release Path publishes a kind-1025 event to the relay"
- Seeds auction + bid on relay
- Injects bidder record into localStorage
- Clicks "Release Path" button
- Opens relay subscription BEFORE clicking
- Waits for kind-1025 event on relay with matching `a` tag
- Verifies all required tags (e, a, p, derivation_path, child_pubkey, release_reason, cashu_token)
- ✅ Covers: button → publish → relay delivery

### Test 2: "after clicking Release Path, UI transitions to path-released state"
- Same setup as test 1
- Clicks button
- Verifies optimistic UI shows "path release published"
- Waits 8 seconds for query refetch
- Verifies state persists (real event from relay)
- Reloads page
- Verifies state persists after reload (no optimistic, pure relay read)
- ✅ Covers: button → publish → relay → query refetch → descriptor shows "Path Released"

### GAP: No E2E test verifies that a SECOND client (seller) detects the path release
- The existing tests only check the bidder's own view
- The seller's view is tested by seeding the path release directly on the relay (not via the button)
- There is NO test that:
  1. Client A (bidder) clicks "Release Path"
  2. Client B (seller) on a different browser session detects the kind-1025 event
  3. Client B's descriptor transitions to "Settlement Ready"