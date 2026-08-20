# ADR-0004: Auction Settlement Descriptor + Validator Evidence & Publish-Layer Hardening

## Status

Proposed (amended)

## Date

2026-08-02 (original), 2026-08-10 (amendment)

## Amendment Summary

This ADR is amended to document three architectural decisions made during PR #1144 review:

1. **NUT-7 ownership moves to the client** — Validators no longer query the mint for proof state. The client queries the mint directly via `checkProofStateBatch`. `validateBid` receives `nut7State` from direct mint queries, not from kind-30440 verdicts.

2. **Publish-layer self-verification** — Publishers independently fetch, validate, and derive canonical data before signing events. Path release requires `won_pending_settlement` quorum. Settlement publisher does NUT-7 pre-check for redemption atomicity.

3. **Self-verifiable events vs. network-consensus states** — Auction end states are classified by whether they can be verified from a single event (self-verifiable) or require distributed observer consensus (proving a negative). The seller derives self-verifiable states; the validator quorum derives consensus-requiring states. `griefed_no_fallback` moves from seller-derived to validator-quorum-derived.

These decisions supersede the corresponding sections of ADR-0003 §2.6 (`validateBidMintState`) and AUCTIONS.md §7.1.3 (validator MUST verify on-mint state).

## Context (original + amendment)

### Original context

The auction settlement UI shows a "settlement-step card" to each participant
in an ended auction — telling them what to do next (release a path, submit
shipping, close the auction) or what happened (you won, you were outbid, the
auction expired). The current implementation uses a boolean-input state
machine that takes 14 flat booleans and scalars and returns a partial
descriptor. The view then runs a second `switch` over the state ID to fill in
the missing fields (icon, button handler, bid amount).

This design has three structural problems:

1. **Participant identity is three independent booleans, not a role.**
   `isSeller`, `isMyBidTop`, and `isWinner` are passed as separate flags with
   no single "who is the viewer to this auction" concept. A self-bidding
   seller hits the bidder's "release your path" branch. A non-participant and
   an outbid bidder are indistinguishable (all three false → blank card).

2. **Participant-agnostic branches shadow participant-specific ones.** The
   `reserve-not-met-refund` and `settlement-expired` branches fire for
   everyone regardless of role, intercepting the seller before the seller's
   own branches are reached. The seller sees the bidder's "Refund Ready" card
   — the seller does not get a refund — and gets trapped by "Settlement
   Expired" with no close-auction button even when the reserve was not met.

3. **The descriptor is partial, forcing a parallel view-side switch that
   drifts.** Copy, tone, and bid amount live in two places with no sync
   mechanism. The griefed original winner — whose settlement names a fallback
   bidder — falls through every branch to a blank card because the machine
   has no state for "you were superseded; your proofs refund at locktime."

### Amendment context: validator evidence boundary

The original descriptor implementation (`isBidValid` wrapper) had three
defects that undermined the validation protocol:

1. **`observedAt = bid.createdAt`** — the bidder's own timestamp was used
   instead of the validator's authoritative `observed_at`. The spec
   (AUCTIONS.md §7.1) states "bidder-claimed `created_at` is advisory;
   `observed_at` is authoritative for the validator's verdict."

2. **`nut7State` always undefined** — the component never passed NUT-7 state
   to the descriptor, so `validateBid` returned `bid_pending_review` for
   every structurally-valid bid. The `isBidValid` wrapper treated
   `bid_pending_review` as valid, so NUT-7 was never enforced.

3. **`currentTopBid` never passed** — the minimum-increment / anti-sniping
   floor check used `currentTopBid = 0`, so the baseline was `starting_bid`
   instead of `topValidBid + bidIncrement`.

### Amendment context: NUT-7 ownership

ADR-0003 §2.6 and AUCTIONS.md §7.1.3 assign NUT-7 (on-mint proof state
verification) to validators. This creates an external dependency for
validators (mint API connectivity) that introduces flakiness and edge cases
depending on validator reliability.

The mint is the source of truth for proof state, not the validator. The
client already has `checkProofStateBatch` (`src/lib/cashu/nut7.ts`)
capability and uses `cashuWallet.checkProofsStates()` for wallet
consolidation. `validateBid` is a pure function that receives `nut7State` as
an input parameter — it does not query the mint itself. The source of
`nut7State` can be swapped from validator verdicts to direct mint queries
without changing `validateBid`.

**Decision:** NUT-7 checks move from validators to the client. Validators
stop querying the mint for proof state. The client queries the mint directly
and passes the result to `validateBid`.

### Amendment context: self-verifiable events vs. network-consensus states

The auction protocol has two fundamentally different categories of
verification:

**Self-verifiable events** contain all the proof within themselves. Any
single client can verify them without network consensus:

- **Path release (kind-1025)** — contains `derivation_path`,
  `child_pubkey`, `cashu_token`. Anyone can check
  `derive(p2pk_xpub, path) == child_pubkey` and that the token matches
  the bid.
- **Settlement `settled` (kind-1024)** — the seller redeemed proofs.
  Anyone can check: path release is valid (self-verifiable), proofs are
  spent (NUT-7, client-side per ADR-0004), seller signature is valid.
- **Settlement `cancelled` (kind-1024)** — the seller signed it. The
  seller has authority. Signature check is self-verifiable.

**Network-consensus-requiring states** require proving that something did
NOT happen across the entire network. A single client cannot verify these
because they might not be seeing all relays:

- **Winner selection** — you might not see all bids. Need distributed
  observers to confirm "this is the highest valid bid."
- **Griefed (no path release observed)** — you might not see a kind-1025
  that exists on another relay. Need distributed observers to confirm
  "no kind-1025 was observed."
- **Reserve not met** — you might not see all valid bids. Need quorum to
  confirm "no valid bid meets the reserve."

The key insight: `griefed` (no path release observed) is fundamentally
different from `fraudulent_bid` (invalid path release published):

- `griefed` is **proving a negative** — no kind-1025 exists anywhere.
  This requires network consensus.
- `fraudulent_bid` is **verifying a positive** — a kind-1025 exists and
  is invalid. This is self-verifiable (check derivation locally).

The validator code already reflects this distinction (lifecycle.ts):

```
if (release) → validate it → fraudulent_bid if invalid (self-verifiable)
if (!release && past grace) → griefed (network consensus: no release observed)
```

### Amendment context: publish-layer self-verification

The publish layer (`src/publish/auctions.tsx`) trusted caller-supplied data
for critical inputs:

- `publishAuctionSettlement` used `auctionEvent.id` (may be a replacement)
  instead of `auction_root_event_id` tag (canonical root)
- Publishers trusted `formData.winningBidEventId` without validator quorum
  verification
- `publishBidderPathRelease` did not verify the auction had ended or that the
  bidder was the canonical winner — a path release gives away the keys to
  locked Cashu funds (irreversible)
- `publishAuctionSettlement` did not pre-check NUT-7 for all legs before
  redemption, risking a half-redeemed state if one leg's proofs were already
  spent

**Decision:** Publishers are self-verifying. They independently fetch, validate,
and derive canonical data before signing. Path release requires
`won_pending_settlement` quorum. Settlement publisher does NUT-7 pre-check for
redemption atomicity.

## Decision

### 1. Unified descriptor with role enumeration (original)

Replace the boolean-input state machine and the view's parallel switch with a
single pure descriptor function that classifies the participant into an
enumerated role and returns the complete renderable descriptor. The function
lives in `src/lib/auction/`.

### Role-first dispatch

The viewer's relationship to the auction is a single enum, computed up front:

- **`seller`** — the auction author
- **`winning-bidder`** — the validated top bid is mine
- **`outbid-bidder`** — I placed a validated bid but am not the top
- **`non-participant`** — none of the above

Every state lives under a `switch (role)`. A state that should only appear
for one role is unreachable for any other.

### 2. Validator quorum + canonical winner (amendment)

A bid is only "valid" if at least `auction.auditorQuorum` validators from the
`auction.auditors` list have published `valid_bid_placed` for that bid via
kind-30440 events. The canonical winner is derived from the validated bid set
using the tie-break rule (highest amount → earliest `observed_at` →
lexicographic event ID).

A pure, reusable function `computeValidatedBids` lives in
`src/lib/auction/bidValidation.ts`. Both the settlement descriptor (for UI
state) and the publishers (for signing events) call it independently. Neither
trusts the other.

The `observedAt` used for validation is the **latest** among confirming
validators (secure against reverse-snipe). The `nut7State` is the worst-case
aggregate (any `spent` → `spent`, all `unspent` → `unspent`, else `pending`).

### 3. NUT-7 ownership: client-side (amendment)

NUT-7 proof state verification moves from validators to the client.

- **`validateBid`** receives `nut7State` from direct client-side mint queries
  via `checkProofStateBatch`, not from kind-30440 verdicts.
- Validators no longer query the mint for proof state. ADR-0003 §2.6
  (`validateBidMintState`) is amended: the client calls this, not the
  validator.
- Kind-30440 verdicts no longer carry `nut7_state` / `nut7_observed_at` tags
  (or these become optional/advisory).
- The client queries the mint directly using `proof_y` values from the bid
  event, which are published precisely for this purpose (AUCTIONS.md §4.2).

> **Amendment (2026-08): NUT-7 states are never fabricated or rewritten.**
>
> 1. **No defaulting.** An unconfirmed NUT-7 state is `pending` by definition
>    (`bid_pending_review`) — never implicitly `unspent` or `spent`. Only the
>    mint's `/checkstate` response may convert a proof state. Callers that own
>    NUT-7 evidence pass the truthful mint-reported state; callers that do not
>    (post-ADR-0004 validators) pass `skipNut7Check: true` to `validateBid`
>    so the NUT-7 step is explicitly skipped rather than bypassed with a
>    fabricated value.
> 2. **No remapping.** A mint-reported `spent` is never rewritten to
>    `unspent` (or anything else). When settlement context changes what a
>    `spent` means — a structurally-valid `settled` settlement exists, so the
>    terminal redemption/refund has legitimately consumed the proofs — it is
>    the CONSUMER of the state (`computeValidatedBids`, via the
>    `postSettlement` flag) that interprets the value, keeping the value
>    itself intact for every other consumer.
> 3. **The publisher fetches evidence.** `publishAuctionSettlement` (both the
>    settled path and the `reserve_not_met` shortcut) queries each
>    auction-allowlisted mint for every parsed bid's `proof_y` set BEFORE
>    calling `computeValidatedBids`. Bids on non-allowlisted mints are never
>    polled (they cannot win; polling attacker-supplied mint URLs would turn
>    the client into a beacon). Unreachable mints leave their bids `unknown`
>    → `pending`, which is the safe failure mode.
>
> **Amendment (2026-08-20): freshness + bare-SPENT attribution boundaries.**
>
> 4. **Freshness**: `useNut7Polling` marks bids whose mint failed a refresh
>    cycle as `unknown` and always replaces the state map — a previously
>    observed `unspent` must not survive a mint outage as fake-current
>    evidence. The freshness bound is one poll interval (60 s).
> 5. **Bare `SPENT` proves consumption, not the consumer.** In the
>    settlement publisher's resumable-redemption skip, all-spent legs count
>    as 'already redeemed' ONLY while pre-locktime (only the seller's lock
>    key can spend pre-locktime; post-locktime the bidder's refund path
>    also consumes, so all-spent stays ambiguous and redemption is
>    re-attempted).

### 4. Publish-layer self-verification (amendment)

#### Path release (`publishBidderPathRelease`)

A path release gives away the keys to locked Cashu funds — irreversible. The
publisher must verify:

1. **Auction has ended** (`now >= max_end_at`)
2. **Bidder is the canonical winner** — `computeValidatedBids` confirms the
   bid is the canonical winner with `valid_bid_placed` quorum
3. **`won_pending_settlement` quorum** — at least `auditorQuorum` validators
   have published `won_pending_settlement` for this bid. Security takes
   priority over settlement speed.
4. **No existing settlement** for a different winner

If any check fails, refuse to publish. No client can release the path to
their bid funds without validator network approval first.

#### Settlement (`publishAuctionSettlement`)

The publisher independently derives the canonical winner:

1. **`auctionRootEventId`** — read from `auction_root_event_id` tag, not
   `auctionEvent.id`. The tag is always present (injected by
   `cloneAuctionEventWithRootId`); fallback to `event.id` only for
   first-version auctions where they are the same.
2. **Validator quorum** — fetch kind-30440 verdicts, call
   `computeValidatedBids`, use `canonicalWinner`. Cross-check against
   `formData.winningBidEventId` if provided.
3. **Auction has ended** (`now >= max_end_at`)
4. **`reserve_not_met` verification** — verify `canonicalWinner === null` or
   `canonicalWinner.amount < auction.reserve`. If any validator published
   `won_pending_settlement`, refuse `reserve_not_met`.
5. **NUT-7 atomicity pre-check** — before any redemption, check ALL legs'
   proof states via `checkProofStateBatch`. If any proof is `spent` → abort
   entirely (no partial redemption). Only proceed if ALL proofs across ALL
   legs are `unspent`. This prevents a half-redeemed state where leg 1
   succeeds, leg 2 fails, and the seller has partial funds with no valid
   settlement event.

### 6. Self-verifiable events vs. network-consensus states (amendment)

Auction end states are classified by verification category:

| State                 | Published by                  | Verification category | Why                                                                          |
| --------------------- | ----------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `settled`             | Seller (kind-1024)            | Self-verifiable       | Path release valid + proofs spent + seller signature — all checkable locally |
| `cancelled`           | Seller (kind-1024)            | Self-verifiable       | Seller signature + authority — checkable locally                             |
| `reserve_not_met`     | Seller (kind-1024)            | Network consensus     | Requires knowing the highest valid bid — needs quorum                        |
| `griefed_no_fallback` | Validator quorum (kind-30440) | Network consensus     | Requires proving no path release was observed anywhere — needs quorum        |
| `fraudulent_bid`      | Validators (kind-30440)       | Self-verifiable       | Kind-1025 exists but is invalid — derivation check is local                  |

**`griefed_no_fallback` moves from seller-derived to validator-quorum-derived.**
The seller may still publish kind-1024 with `griefed_no_fallback` as a
formality, but the source of truth is the validator quorum. The descriptor
determines grief from `griefed` quorum in kind-30440 verdicts, not from the
seller's kind-1024 claim.

The seller follows the quorum: they observe validator verdicts and publish
kind-1024 in alignment with what the quorum has established. The descriptor
cross-checks the seller's kind-1024 against validator consensus.

If the seller never publishes kind-1024 (e.g. seller goes offline), the
descriptor can still determine the auction outcome from validator verdicts
and show appropriate UI. The kind-1024 is a confirmation, not a requirement
for the UI to show the correct state.

### 7. `computeValidatedBids` as shared pure function (amendment)

Both the settlement descriptor and the publishers call the same pure function
to determine bid validity and canonical winner. This is defense-in-depth: if
one module has a bug, the other catches it. The function is pure (no React,
no DOM, no side effects) and reusable.

> **Amendment (2026-08-20): publisher stamping + path gate + scoped
> interpretation.** Validators MUST stamp `observed_at` with their first
> observation of the bid (now enforced in the verdict publisher, not just
> assumed) so upgrade verdicts survive the client-side eligibility screen.
> Path release now FAILS CLOSED unconditionally when the
> `won_pending_settlement` quorum cannot be positively established — the
> post-close exception is removed, since a published path lets the seller
> redeem locked proofs at the mint directly, bypassing every downstream
> canonical-winner check. `settledBidIds` scopes the post-settlement
> `proof_spent` interpretation to the bids recorded in the `settled`
> settlement (winning_bid + payout legs), so a drained non-settlement bid
> cannot displace the real winner. Condemn claims pass the same
> eligibility screen as confirms. The `hasSettled` structural predicate is
> centralized in `isStructurallyValidSettledSettlement`
> (`src/lib/auction/events.ts`) — one definition, no 4× copy-paste drift.

> **Amendment (2026-08): quorum-eligibility and truthful evidence.**
> `computeValidatedBids` consumes kind-30440 verdicts with a per-verdict
> eligibility screen (ADR-0003 §2.3 amendment): a confirm verdict counts
> toward `auditorQuorum` only when its `observed_at` passes the window + skew
> checks against the bid's signed `created_at`. Condemn verdicts
> (`bid_invalid`/`fraudulent_bid`) require the same quorum — no single
> validator can veto or promote a bid. Verdicts are deduplicated per
> (validator, referenced bid) keeping the latest replaceable copy. The
> client-side `validateBid` re-run for quorum-confirmed bids uses the bid's
> own `created_at` (deterministic across clients) and the caller's
> mint-reported `nut7States` verbatim (§3 amendment: never defaulted, never
> remapped). Post-settlement, `proof_spent` on a quorum-confirmed bid is
> interpreted as terminal redemption/refund — a consumer decision, not a
> state rewrite.

## Consequences

- **NUT-7 responsibility shift:** Validators stop querying mints. The client
  takes over NUT-7 checks using the existing `checkProofStateBatch` helper.
  `validateBid`'s interface is unchanged — only the source of `nut7State`
  changes. ADR-0003 §2.6 is amended accordingly.

- **Quorum-gated settlement:** Bids without quorum confirmation are "pending"
  — no CTAs, no settlement. The auction's `auditors` list and
  `auditorQuorum` field are the authoritative source for the threshold.

- **`won_pending_settlement` gate:** The path release publisher requires
  `won_pending_settlement` quorum before publishing. If validators are slow or
  offline, the bidder waits. Security takes priority over settlement speed.

- **Griefed state derived from quorum:** `griefed_no_fallback` is determined
  by validator quorum (kind-30440 `griefed` claims), not by the seller's
  kind-1024. The descriptor shows grief based on quorum consensus. The
  seller's kind-1024 with `griefed_no_fallback` is a confirmation, not the
  source of truth.

- **Self-verifiable vs. consensus-requiring:** The protocol distinguishes
  events that contain their own proof (path release, settlement,
  cancellation — verifiable by any client) from states that require proving
  a negative (no path release observed, no valid bid above reserve — require
  quorum). The seller derives self-verifiable states; the validator quorum
  derives consensus-requiring states.

- **Atomicity guarantee:** The settlement publisher pre-checks all legs'
  proof states before any redemption. All-unspent or abort. No partial
  redemption states.

- **Self-verifying publishers:** Publishers don't trust callers. They
  independently fetch, validate, and derive canonical data. Cross-check
  assertions catch UI bugs. Sensitive publish actions (path release,
  settlement) are marked as high-sensitivity.

- **No cross-module trust:** The descriptor and the publishers both call
  `computeValidatedBids` independently. Neither trusts the other's output.

- **Canonical root event ID:** All events reference `auction_root_event_id`
  (the tag), not `event.id` (which may be a replacement). This is already
  in the spec; the publisher is corrected to read the tag.

## Known limitations

### Locked amount not verifiable at bid time

The kind-1023 bid event publishes `lock_secret` (P2PK lock script) and
`proof_y` (for NUT-7 state checks), but not the proof's `C` (mint
signature), `amount`, or keyset `id`. NUT-7 verifies spend state only —
it does not return the proof's amount.

This means a bidder can lock a small amount at the mint and publish a
bid claiming a larger cumulative `amount`. The mismatch is only caught
at settlement when the kind-1025 reveals the full `cashu_token`. During
the auction, the fake bid affects winner selection and floor computation.

This is a griefing vector, not a theft vector. Mitigations include
validator policy gates, rate limits, and `vadium_ratio_bps`.

A future protocol enhancement could close this gap by publishing `C` and
enabling offline signature validation (e.g. NUT-12 DLEQ proofs). The proof's
`C` is safe to publish — P2PK-locked proofs cannot be spent without the
seller's private key, regardless of whether `C` is public (the spec already
publishes full proofs including `C` in the kind-1025 path release). However,
the specific approach is not yet settled:

- NUT-12 DLEQ proofs require the blinding factor `r` for third-party
  verification, which has a privacy trade-off (the mint can correlate
  swaps to proofs).
- Requiring NUT-12 changes mint compatibility — not all mints support it,
  and the current wallet code falls back to non-DLEQ proofs for
  reliability.
- The invariant to enforce (verifiable bid amounts) and whether requiring
  NUT-12 is acceptable for auctions needs team discussion before a
  solution is specified.

Documented in AUCTIONS.md §9.1.1 as a known gap.

## Amendments to other documents

- **ADR-0003 §2.3** (`validateBidTemporal`): amended with the quorum-
  eligibility rule for consuming kind-30440 verdicts (per-verdict window +
  skew screen against the bid's `created_at`; condemn claims gated by the
  same quorum; no synthetic timestamp composition).
- **ADR-0003 §2.6** (`validateBidMintState`): ownership moves from validator
  to client. The function signature and checks remain the same; the caller
  changes. 2026-08 amendment: unconfirmed states are never defaulted,
  mint-reported states are never remapped; validators pass `skipNut7Check`
  instead of fabricating a state.
- **AUCTIONS.md §4.3.2** (kind-1024 status enum): each status annotated
  with verification category (self-verifiable vs. network-consensus).
  `griefed_no_fallback` annotated as validator-quorum-derived.
- **AUCTIONS.md §7.1.3** (validator MUST verify on-mint state): removed from
  validator responsibilities. Added to client responsibilities.
- **AUCTIONS.md §7.5** (validator audit protocol): validators now determine
  `griefed_no_fallback` via quorum. The seller follows the quorum.
- **AUCTIONS.md §8.1** (settlement flow): step 3 (bidder publishes kind-1025)
  now explicitly requires `won_pending_settlement` quorum (MUST, not
  implied by ordering). The griefed path shows validators determining grief
  via quorum, not the seller.
- **AUCTIONS.md §8.2** (settlement edge cases): `griefed_no_fallback` and
  `fraudulent_bid` edge cases annotated with verification category.
- **`src/publish/AGENTS.md`**: high-sensitivity publish marker convention
  and self-verification requirements.
