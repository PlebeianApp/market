# ADR-0004: Direct Lightning Invoice Funding for Auction Bids

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
