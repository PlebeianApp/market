# ADR-0008: Direct Lightning Invoice Funding for Auction Bids

## Status

Proposed

## Date

2026-07-31

## Scope

This ADR defines implementation decisions for auction bid funding via direct Lightning invoices.

This ADR does not define broader wallet redesign, global payment abstractions, or non-auction checkout changes.

## Context

The current auction bid flow requires users to pre-fund a wallet with e-cash via Lightning before they can bid.

This creates two user and product issues:

- Funds are held in the user's wallet before a bid is actually placed, increasing custody-like friction for normal bidding activity.
- Users must repeatedly top up wallet balance during bidding sessions when balance becomes insufficient.

For auction participation, users should be able to fund a bid at the moment of intent, not through repeated pre-deposit steps.

## Decision

Adopt a direct Lightning invoice bid-funding flow that replaces the current insufficient-balance deposit prompt during bidding.

When a user submits a bid:

1. The system calculates the required bid funding amount, including e-cash transaction fees.
2. The system resolves the seller-provided mint options and validates mint eligibility constraints.
3. The user is prompted to pay a Lightning invoice for that selected mint target.
4. After the invoice is acknowledged as paid, funds are minted as e-cash via that mint and prepared for bid locking.
5. The bid is placed immediately using the minted e-cash.

This flow replaces the current behavior where insufficient wallet balance leads users into a generic wallet top-up flow before bidding can continue.

## Implementation Decisions

### Decision 1: Auction bidding uses an invoice-first funding path

When wallet balance is insufficient for a bid, the auction bid flow must invoke direct invoice funding instead of redirecting users to a generic pre-deposit top-up path.

### Decision 2: Funding orchestration is isolated behind a dedicated boundary

Implementation should introduce or use a dedicated funding orchestration boundary for:

- invoice creation
- payment detection and acknowledgment
- mint quote/mint execution
- handoff to bid publish

This logic should not be embedded directly in UI components.

### Decision 3: Bid publish is gated on minted e-cash availability

A bid publish attempt is allowed only after the Lightning payment is acknowledged and the selected mint returns spendable e-cash proofs for the required amount.

### Decision 3a: Invoice amount must include fee padding

Invoice calculation must include the bid amount plus fee padding for both Lightning fees and e-cash mint transaction fees.

When possible, fee values should be queried from the selected mint to produce an exact required amount for the mint-fee portion.

If exact fee values are not available, the system must use a conservative estimate that does not fall below the actual required fee.

### Decision 3b: Wallet acknowledgment and mint confirmation timeout policy

Wallet acknowledgment and mint confirmation checks use a 15-second timeout per transaction attempt.

When timeout is reached, the flow must expose a manual retry path.

### Decision 4: Single-mint bids are the baseline design

The baseline implementation assumes one selected mint per bid funding flow.

Multi-mint bid funding is not required for this ADR and should be treated as a future extension if product requirements change.

### Decision 5: Bid-lock conversion occurs only after the single invoice is paid

For the baseline single-invoice flow, bid-lock conversion must occur only after the invoice is paid and the selected mint returns spendable e-cash proofs.

If the invoice fails or expires, no bid lock conversion or bid publication occurs.

### Decision 6: Invoice failure preserves reclaimability

If a single invoice payment fails, expires, or is otherwise not acknowledged, the funding attempt must remain reclaimable and must not leave the user with an unrecoverable intermediate state.

### Decision 7: Bidder selects one mint from seller-provided mints

The bidder can only select a single mint from the mints provided by the seller.

Invoice generation must use only that bidder-selected mint after eligibility and policy checks.

### Decision 8: Failure modes are explicit and recoverable

Implementations must preserve and expose at least these distinct failure classes:

- invoice expired or unpaid
- invoice paid but mint failed
- mint succeeded but bid publish failed
- deposit outcome uncertain (payment outcome unevidenced either way — see Round-3 Amendment R3-3)

Each class should support deterministic retry or compensating action, instead of collapsing into a generic payment failed outcome.

### Decision 9: Mint-success and publish-failure requires reconciliation

If e-cash minting succeeds and bid publish fails, minted funds must remain reclaimable to the user and the flow must surface a resumable retry path for publish.

### Decision 9a: Publish retries are user-confirmed

Retrying bid publish after a publish failure must be user-confirmed, not automatic.

### Decision 10: Losing bids return reclaimable value as e-cash

When a bid loses, reclaimable funds are refunded as e-cash and represented with dedicated refund lifecycle states.

### Decision 10a: Refund processing and withdrawal UX

Losing-bid e-cash refunds should be processed automatically.

After refund processing, funds available to withdraw via Lightning must be clearly highlighted to the user, while withdrawal remains a manual action so the user can provide a destination address.

### Decision 11: State transitions remain distinct across payment lifecycle

Wallet acknowledgment, invoice payment, e-cash minting, bid publication, and auction settlement/refund outcomes must remain separate lifecycle transitions in code and UI.

### Decision 12: Payment/privacy-safe telemetry and logs only

Errors, logs, and telemetry must avoid leaking sensitive payment material such as invoice preimages, token proofs, seed material, or private wallet configuration.

### Decision 13: Auction rules acknowledgement is scoped per ruleset, not per auction

The "review auction rules" acknowledgement is scoped per ruleset version and per bidder — keyed as `auction-rules-ack:<version>:<bidder pubkey>` — rather than per auction. The rules content is static across all auctions; a bidder who has acknowledged the current ruleset once is not re-prompted on every auction until the ruleset version bumps. Acknowledging the rules advances the user directly into the bid-confirmation dialog.

This is a deliberate departure from the earlier per-auction scoping (keyed `auction-rules-ack:<version>:<bidder>:<auction identity>`), which re-prompted on every auction. Per-ruleset scoping was chosen because re-acknowledging identical rules per auction is redundant; the version bump remains the safety valve for materially changed rules.

## Payment and Bid State Model

The bid flow must preserve explicit lifecycle states and not collapse them into a single paid/unpaid flag.

Minimum states for this flow:

- Bid requested
- Funding session created
- Mint target resolved
- Invoice created
- Invoice payment attempted
- Invoice paid
- Invoice expired or unpaid
- Deposit outcome uncertain (round-3 R3-3)
- Wallet acknowledged payment
- E-cash minting attempted
- E-cash minted
- Bid lock conversion attempted
- Bid lock conversion complete
- Bid publish attempted
- Bid published
- Bid funding failed
- Bid publish failed
- Funding failed, funds reclaimable

Auction outcome states relevant to reclaimable funds:

- Bid lost, reclaimable
- Refund minted as e-cash
- Refund claim published or acknowledged (implementation-specific)

## Consequences

- Improved bidder UX: users pay only when placing a bid, reducing repeated top-ups and idle wallet balances.
- Reduced pre-funding friction: bidding becomes invoice-first instead of wallet-balance-first.
- Clearer operational semantics: funding, minting, and bid publication are tracked as separate state transitions.
- Fee correctness becomes a hard requirement: invoice amounts must include e-cash transaction fees to avoid underfunded bid attempts.
- Fee policy is explicit: invoices include padding for both Lightning fees and e-cash mint fees.
- Failure handling requirements: the app must handle invoice-paid-but-mint-failed and mint-successful-but-bid-publish-failed paths explicitly.
- Single-invoice simplicity: the baseline flow remains focused on one invoice and one mint target per bid.
- Mint-selection boundary is explicit: bidder selection is limited to seller-provided mint options.
- Refund handling requirement: if a bid loses, reclaimable funds are refunded as e-cash.
- Testing requirement: integration tests should cover success path, payment interruption, mint failure, publish failure, and losing-bid refund path.

## Non-goals

- No change to non-auction order checkout payment flow.
- No assumption that wallet acknowledgment equals final settlement.
- No removal of explicit refund and failure states.
- No requirement to remove optional manual top-up for unrelated workflows.

## Implementation Plan

### PR 1: Funding orchestration boundary and state machine

Scope:

- add direct invoice funding orchestration for bidding
- add single-invoice funding state machine with payment and mint checkpoints
- add fee quote/estimate handling that prefers exact mint-provided values
- add 15-second timeout handling for wallet acknowledgment and mint confirmation, with manual retry state
- encode explicit funding and bid publish states
- preserve recovery metadata for retries

### PR 2: Bid flow integration

Scope:

- wire auction bid submit to invoice-first funding path
- render the selected invoice and payment status in the bidding UX
- surface seller-provided mint options and selected mint-target plan before payment
- enforce bidder mint selection only from seller-provided mint options
- replace insufficient-balance top-up prompt in auction bidding UX
- gate publish on minted-proof readiness

### PR 3: Refund and reconciliation paths

Scope:

- implement losing-bid reclaim as e-cash refund lifecycle
- implement invoice-failure reclaim and redeem flow for abandoned funding attempts
- implement invoice-paid/mint-failed and mint-succeeded/publish-failed reconciliation behavior
- implement automatic refund processing and highlighted manual Lightning withdrawal action

## Testing Strategy

The implementation should add integration tests for:

- happy path single-invoice: invoice paid -> e-cash minted -> bid published
- exact mint fee quote path used in invoice calculation
- fallback fee estimate path does not underfund invoice amount
- invoice amount includes configured Lightning-fee and mint-fee padding
- invoice expiration/unpaid interruption path
- bidder can select only from seller-provided mint options
- bidder-selected mint fails eligibility/policy checks and is rejected deterministically
- wallet acknowledgment and mint confirmation timeout at 15 seconds with manual retry
- invoice paid but mint failure path
- mint success but bid publish failure with user-confirmed retry and reclaim behavior
- losing-bid e-cash refund path
- losing-bid refund is automatic and manual withdrawal CTA is highlighted
- state transition integrity (no lifecycle collapse)

## Resolved Policy Answers

1. Invoice amounts include fee padding for both Lightning fees and e-cash mint fees.
2. Wallet acknowledgment and mint confirmation use a 15-second timeout with a manual retry path.
3. Publish retries are user-confirmed.
4. Losing-bid refunds are processed automatically as e-cash; withdrawable funds are clearly highlighted and withdrawn manually so the user can enter a destination address.
5. If seller preference and bidder-selected mint differ: bidder selection is allowed only from seller-provided mint options.

## Alternatives Considered

- Keep current pre-deposit e-cash wallet top-up flow during bidding.

Rejected because it keeps unnecessary custodial friction and repeated balance-management overhead for users.

## Notes

This ADR defines flow and state semantics. Specific UI copy, retry policy, timeout values, and relay/publication sequencing remain implementation details to be finalized in code and tests.

## Round-3 Review Amendments (2026-09)

Maximotodev's round-3 review of PR #1235 (2026-09-03) surfaced four monetary-safety gaps in the direct-funding implementation. These amendments record the accepted mechanisms (implemented in the round-3 fix branch); they refine — and never weaken — the decisions above.

### Amendment R3-1: Pre-lock recovery record with confirmed-write semantics (the mint boundary is irreversible)

Once a Cashu swap/lock request may have been sent to the mint, failure handling must assume the mint mutated state (inputs consumed, P2PK-locked proofs issued). The refund authority for a bid leg — the per-leg refund private key, a non-seed-derived secret that cannot be reconstructed — must therefore be durably observable BEFORE the mint call that could consume it, or a post-swap throw strands the locked leg with no usable refund branch (not even timelock-reclaimable).

- The publish flow persists an `AuctionBidPreLockRecoveryRecord` (refund keypair + auction/leg/mint/lock metadata, bounded at 25 entries, keyed by refund pubkey) before every `lockAuctionBidFunds` call, with CONFIRMED-WRITE semantics: a strict user-scoped save plus a read-back equality check. If the record is not confirmed, the publish aborts with `AuctionBidPreLockRecordWriteFailedError` and provably zero mint interaction (fail closed BEFORE the irreversible boundary). At the bound, persisting a NEW record fails closed instead of evicting an oldest entry (eviction could silently delete a still-pending leg's refund key); in-place updates/supersede of an existing key at the bound still succeed.
- The record is removed once the full bidder record supersedes it (the leg became publishable), on a provably-pre-mint lock failure, or after a successful reclaim.
- The wallet's pending-token store is written STRICTLY and reordered before the first fallible post-swap check (the P2PK-lock assert), so the locked proofs become durably observable before any post-swap local failure can strand them. A strict-write failure after the swap surfaces as mutation-possible (see R3-2) — honest "uncertain", no in-session retry.

This is the NIP-60-runtime implementation of the auctions gate in the proposed ADR-0010 (PR #1255) §7/G8 — refund authority durable and verified before the mint lock; locked result durable before bid publication. It is consistent with the proposed ADR-0010, not required by it (that ADR is unaccepted). Cutover deltas if ADR-0010 is accepted: the record gains a Coco operation-id/durable-link field, the locked-result authority re-homes to Coco operation state, and refund-key protected storage plus a user-controlled disaster-recovery/export path (ADR-0010 §7 step 5, §11) land at cutover.

### Amendment R3-2: Mutation-possible lock outcomes refuse retries

Any escape from the lock flow once a swap request may have been sent is classified `AuctionBidLockMutationPossibleError` (conservative: wallet creation and DLEQ-filter failures inside the swap phase are included; fail closed). The publish layer surfaces it as `AuctionBidLockOutcomeUncertainError` — a sibling (never a subclass) of the two existing post-lock tiers — carrying the persisted recovery record id. The funding lifecycle records the record id and REFUSES the retry outright: no full re-submit (double-consume risk at the mint), no rebroadcast (nothing is known publishable), with honest guidance that reclaim MAY be available after the refund timelock. Raw pre-lock validation errors (amount / wallet / balance / selection) stay raw: provably pre-mint, so a full re-submit remains legitimate. `reclaimToken` falls back to the pre-lock record for the refund privkey so an uncertain leg with a persisted pending token is actually reclaimable.

### Amendment R3-3: `deposit_outcome_uncertain` — Lightning outcomes are claimed only with evidence

Lightning payment outcomes are uncertain until positively confirmed or disproven. A terminal deposit error is only classifiable when an invoice existed for the session (a payment could have been made); pre-invoice errors create nothing and get no classification. Closing the deposit modal while a payment may be in flight lands the new `deposit_outcome_uncertain` lifecycle state — terminal for the session, close-preserves the pending submission, but NOT reclaimable-branded (claiming "reclaimable" without evidence is as dishonest as claiming "paid"). The close preserves the deposit's recovery so the SAME deposit can still settle late; a late success walks the lifecycle forward (`payment_acknowledged → minting_started → ecash_minted → publish`), which keeps the user-confirmed publish retry (Decision 9a) reachable, and a fresh funding session can start from the state. The progress dialog renders a distinct "Payment outcome unconfirmed" branch that claims neither unpaid nor reclaimable. The no-mint pre-flight branch lands `funding_canceled` — nothing was ever created.

### Amendment R3-4: Retry identity binding — an unsigned cached bid republish is bound to the original bidder

Signing a Nostr event fixes its identity: NDK's `sign` overwrites the event's pubkey with the active signer, so re-signing an unsigned cached kind-1023 from a different account would publish a foreign-authored bid carrying the original bidder's lock secrets under a DRIFTED event id (the bidder record — refund key + proofs — exists only under the original id). `republishAuctionBid` therefore guards twice without publishing and without discarding the cached entry: pre-sign, the signer's pubkey must equal the cached event's author; post-sign, the recomputed event hash/id must equal the original bid event id. The publish pipeline asserts the same invariant before broadcasting, and failure copies carry the finalized (pre-sign) event id so a drift can never poison the retry tracker with a foreign id.
