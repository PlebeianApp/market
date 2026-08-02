# Settlement Descriptor — Implementation Handover

> **Temporary document.** This captures the research, bug audit, and
> implementation plan for ADR-0004. It will be cleaned up (deleted) as part
> of the PR that ships the descriptor. The ADR itself is the permanent
> architectural record; this is the working detail.

## Bug audit (detailed)

The audit examined `settlementStateMachine.ts` and `AuctionSettlement.tsx`
on the `feat/settlement-steps` branch. Three structural bugs plus
contributing factors.

### Bug 1: Participant identity is three independent booleans, not a role

`getAuctionSettlementState` receives `isSeller`, `isMyBidTop`, and
`isWinner` as independent flat booleans (lines 34–37). No single
enumerated "what is the viewer to this auction" value.

- A **self-bidding seller** (`isSeller && isMyBidTop`) hits the
  `bidder-release-path` branch first (line 99), which does not check
  `!isSeller`. The seller is told "You won — release your path" and never
  reaches the seller-side branches.
- A **non-participating observer** and an **outbid bidder** both have all
  three booleans false and fall through to `NO_STATE` (line 278) — blank
  card.
- `isWinner` is a post-settlement concept (from the settlement `winner`
  tag) while `isMyBidTop` is a pre-settlement concept (from the validated
  top bid). They can desync in the fallback/griefing flow and nothing
  reconciles them.

### Bug 2: Participant-agnostic branches sit above participant-specific ones

- **`reserve-not-met-refund-*`** (lines 173–192) fires for any viewer when
  `hasLatestSettlement && settlementStatus === 'reserve_not_met'`. The
  seller sees "Refund Ready — verify the unlocked funds have returned to
  your wallet" (wrong: the seller doesn't receive a refund). A
  non-participant browsing a closed auction sees someone else's refund
  card. This branch fires before the seller branches (lines 210, 223),
  so the seller's correct close-auction view is unreachable.
- **`settlement-expired`** (lines 197–202) fires for any viewer when
  `settlementWindowExpired && !hasLatestSettlement`. It fires before
  `seller-settlement-ready`, `seller-close-auction`, and
  `seller-awaiting-path-release`. Once the window expires with no
  settlement, the seller sees "Settlement Expired" with no CTA and loses
  the ability to publish a `reserve_not_met` closure.

### Bug 3: Partial descriptor forces a parallel view-side switch

`getAuctionSettlementState` returns `title`, `message`, `buttonTitle`,
`theme`, `showButton`, and `bidAmount`, but omits `icon`,
`buttonAction`, and the real `bidAmount`. The component's `switch`
(lines 240–389) re-specifies copy and re-derives `bidAmount` from
`myTopBidEvent.amount` / `settlementFinalAmount` — values the state
machine never receives. The `bidAmount` field of `SettlementStateOutput`
(line 52) is dead code for every state except the two that set it to 0.
Any edit to copy or theme must be made in two places with no sync.

### Contributing factors

- **Griefed / superseded original winner → blank card.** When a settlement
  names a fallback bidder as winner, the original validated top bidder has
  `isMyBidTop === true` but `isWinner === false` and
  `hasLatestSettlement === true`. Every `isMyBidTop` branch is skipped
  (guarded by `!hasLatestSettlement` or `settlementStatus !== 'settled'`),
  every `isWinner` branch is false, and the machine returns `NO_STATE`.
  No "you were the winning bidder but settlement went to fallback" state
  exists. See AUCTIONS.md §8/§9.

- **Fallback-top-bidder not modeled.** AUCTIONS.md §4.5 defines kind 1026
  (fallback offer) and §9 defines the fallback cascade. The promoted
  outbid bidder is neither `winning-bidder` (not the validated top) nor
  `non-participant`. The current role taxonomy has no place for them.

- **Validated-empty vs still-loading conflated.** The early-return guard
  (lines 204–219) only fires when `ended && !validatedData && isLoading`.
  Once `validatedData` resolves to `{ bids: [] }` (all streamed bids
  failed #1170 validation), the guard is skipped and the machine runs with
  `topBid: null`. A bidder whose only bid failed validation falls to
  `NO_STATE` — blank card instead of "your bid failed validation."

- **Two parallel settlement UIs.** The dashboard route renders its own
  settlement UI from raw, unvalidated events and does not use the state
  machine. The public view uses #1170-validated data. The two can disagree.

- **`now` captured once per render.** `Date.now()` is read per render
  (line 145). Re-renders depend on the 5-second `refetchInterval`. If the
  relay is unreachable, `settlementWindowExpired` and
  `refund-pending → ready` transitions never fire. The card freezes.

- **Optimistic UI never reverts on publish failure.**
  `setOptimisticallyReleased(true)` (line 196) runs inside the `try`
  before the `invalidateQueries` await. If `invalidateQueries` throws, the
  flag stays `true` and the card is stuck in `bidder-path-released` even
  though no path release was published.

## Descriptor function design

### Role classification (priority order)

1. `seller` — `currentUserPubkey === auction.sellerPubkey`
2. `fallback-top-bidder` — settlement names me but I am not the validated
   top bidder (minimum recognition; full kind-1026 wiring is follow-up)
3. `winning-bidder` — validated top bid is mine (and I am not the seller)
4. `outbid-bidder` — I appear in the validated bid set but am not the top
5. `non-participant` — none of the above

A self-bidding seller classifies as `seller` only.

### Phase classification

Derived from timing + settlement status:
`bidding-open`, `settlement-window-open`, `settlement-window-expired`,
`settled`, `reserve-not-met`, `cancelled`, `closed`.

### State inventory

**13 reproduced states** (copy carried verbatim from the old machine):

| Role           | State ID                         | Description                              |
| -------------- | -------------------------------- | ---------------------------------------- |
| winning-bidder | `bidder-release-path`            | Won; release path to settle              |
| winning-bidder | `bidder-path-released`           | Path published; awaiting seller          |
| winning-bidder | `winner-with-order`              | Won; shipping submitted; view order      |
| winning-bidder | `winner-claim-dialog`            | Won; submit shipping address             |
| seller         | `seller-order-received`          | Winner submitted shipping; view order    |
| seller         | `seller-awaiting-shipping`       | Waiting for winner's shipping details    |
| seller         | `seller-settlement-ready`        | Path released; publish settlement        |
| seller         | `seller-close-auction`           | Reserve not met / no bids; close auction |
| seller         | `seller-awaiting-path-release`   | Waiting for winner's path release        |
| any bidder     | `reserve-not-met-refund-ready`   | Refund window opened                     |
| any bidder     | `reserve-not-met-refund-pending` | Refund pending at locktime               |
| any bidder     | `settlement-expired`             | Window closed without my path release    |
| any bidder     | `bidder-local-record-missing`    | Can't find release path; refresh         |

**5 new states** (the fixes):

| Role                  | State ID                                                         | Description                                                                 |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| seller                | `seller-closed-reserve-not-met`                                  | Auction closed; reserve not met (NOT the bidder's refund card)              |
| seller                | `seller-settlement-window-expired`                               | Window expired with no path; terminal (NOT trapped by `settlement-expired`) |
| winning-bidder        | `winning-bidder-superseded-by-fallback`                          | Settlement went to fallback; proofs refund (NOT blank card)                 |
| winning-bidder/outbid | `*-bid-invalid`                                                  | Bid failed validation; not counted (NOT blank card)                         |
| fallback-top-bidder   | `fallback-top-bidder-winner-with-order` / `-winner-claim-dialog` | Reserved; minimum recognition                                               |

### Parity harness design

The parity harness ran the old `getAuctionSettlementState` and the new
`getSettlementDescriptor` over the same consistent scenarios and asserted a
**translation table** (not raw equality):

- **12 states**: direct equality (`oldStateId === newStateId`).
- **Winner/fallback seam**: the old `isWinner` boolean collapses two cases
  the new function distinguishes:
  - `isWinner && isMyBidTop` → `winning-bidder` → `winner-with-order`
  - `isWinner && !isMyBidTop` → `fallback-top-bidder` → `fallback-top-bidder-winner-with-order`
- **2 deliberate exclusions** (bug fixes, not parity failures):
  - seller + `reserve_not_met`: old gives refund card (wrong); new gives
    `seller-closed-reserve-not-met` (correct).
  - seller + settlement-window-expired: old gives `settlement-expired`
    (stuck); new gives `seller-settlement-window-expired` or
    `seller-close-auction` (correct).

The parity harness was a transient gate — it was deleted along with the old
state machine once the 21 tests passed and the old machine was removed.

### Verified badge precedence

`settlement > path-release > none`. The badge is derived from the same
validated arrays as the state, eliminating the old divergence where the
badge said "Settlement confirmed" while the card said "Settlement Expired."

## Migration plan

### Base topology

The settlement layer sits on `origin/auctions` (which already contains the
#1170 validators), not `master`. The migration is **one PR against
`origin/auctions`**, not a stack.

### PR contents (single PR)

1. **Descriptor function** (`src/lib/auction/settlementDescriptor.ts`) —
   the pure function per ADR-0004 decisions. Role-first `switch(role)`,
   18 states (13 reproduced + 5 new).

2. **Matrix test** (`src/lib/__tests__/settlementDescriptor.test.ts`) —
   71 tests, 116 assertions. `(role × phase)` matrix covering all cells
   including the 5 new states. Factory helpers: `makeAuction`,
   `makeBid`, `makePathRelease`, `makeSettlement`, `makeClaimOrder`,
   `makeInput`.

3. **View switch** (`src/components/AuctionSettlement.tsx`) — thinned to
   `getSettlementDescriptor` + `ICON_REGISTRY` + `TONE_CLASSES` + CTA
   dispatch + `useNow` (1s tick) + optimistic synthetic release. Dead
   `bids: NDKEvent[]` prop replaced with `hasPlacedBid: boolean`.

4. **Route update** (`src/routes/auctions.$auctionId.tsx`) — pass
   `hasPlacedBid` instead of `bids` to `<AuctionSettlement>`.

5. **Delete old machine** — `settlementStateMachine.ts` + its test +
   the parity harness (all removed once parity passed).

6. **E2e** — update `auction-settlement.spec.ts` assertions:
   - "Close Auction" → "Auction Closed" (not "Refund Pending")
   - "Settlement Expired" → "Reserve Not Met" (seller can still close)

### Commit sequence (clean history)

```
1. docs(adr): ADR-0004
2. feat(auction): #1170 local-only validators + validated query layer
3. feat(auction): settlement descriptor + matrix tests
4. feat(auction): order-detail page + #1170 integration
5. refactor(auction): wire AuctionSettlement to descriptor
6. test(e2e): settlement + order-detail tests + seed fixtures
```

### Follow-up PRs (not part of this PR)

- **Dashboard route adoption** — retire the parallel raw-event settlement
  UI, consume the same descriptor. Ships after the public view has run
  without seller-side regression.
- **Fallback-top-bidder flow** — implement kind-1026 read, surface offers
  to outbid bidders, accept via kind-1025 `release_reason=fallback_settlement`.
  The descriptor starts assigning the `fallback-top-bidder` role. Plugs
  into the architecture without changing the descriptor contract.
- **Outbid-bidder and participant-tracking cards** — "You were outbid,"
  "This auction's top bid was X," "This auction settled at X sats,"
  settlement-window tracking for all participants. The descriptor's
  `outbid-bidder` and `non-participant` branches return meaningful states
  instead of `no-state`.

## Key constants and timing contract (for tests)

```
SELLER_PUBKEY = 'a'.repeat(64)
BUYER_PUBKEY = 'b'.repeat(64)
OTHER_BIDDER_PUBKEY = 'c'.repeat(64)
AUCTION_END = 100
AUCTION_GRACE = 50
AUCTION_LOCKTIME = 150  (cutoff + grace)

now = 50  → bidding open
now = 120 → ended, settlement window open
now = 200 → settlement window expired
```

## Test results

- Matrix test: 71 pass, 0 fail, 116 assertions
- Parity harness (transient): 21 pass, 0 fail (deleted with old machine)
- Old machine tests (pre-deletion): 38 pass, 0 fail
- Prettier: clean
- No dangling imports of the old state machine
