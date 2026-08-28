# Task: Validator NUT-7 Check for Winning Bid at Settlement Time

## Status

Future improvement — not yet implemented.

## Context

PR #1144 (`feat/settlement-steps`) manual testing revealed that the
validator should verify NUT-7 proof state for the top winning bid before
publishing `won_pending_settlement`, and walk down the bid chain to valid
fallback bids if there are issues at settlement time.

Currently the validator makes no mint calls (ADR-0004: NUT-7 is client-side
evidence). The `skipCashuTokenCheck` and `skipNut7Check` changes in this PR
were necessary to unblock the settlement flow, but they removed a fraud
detection layer from the validator. Reintroducing a targeted NUT-7 check
for the winning bid would restore that layer without the overhead of
polling every bid.

## Scope

- The validator should do a NUT-7 check (mint proof state query) for the
  **top winning bid only** before publishing `won_pending_settlement`.
- If the winning bid's proofs are `spent` (double-spend fraud), the
  validator should walk down the bid chain to find the next valid
  fallback bid and publish that as the winner instead.
- This does NOT apply to the bid-at-bid-time path — validators should
  NOT do mint interaction when a bid is first placed. Only at settlement
  time (when the auction closes and the winner is determined).
- The existing `nut7Poller` infrastructure may be reusable for a
  winner-only targeted check, or a new lighter-weight mint proof state
  query may be needed.

## Dependencies

- ADR-0004 (NUT-7 is client-side evidence) may need an amendment to
  allow the validator to do a targeted winner-only NUT-7 check at
  settlement time.
- The mint must be reachable from the validator (mint reachability
  probing is already implemented in `mintReachability.ts`).

## Non-Goals

- Polling NUT-7 for every bid (only the winning bid chain at settlement).
- Changing the bid-time validation path (validators stay passive at bid
  time).
