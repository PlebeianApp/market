# ADR-0015: Settlement Steps — Validation Logic Split

**Status:** Proposed
**Date:** 2026-07-28
**Supersedes:** None
**Superseded by:** None
**Related PRs:** #1144 (feat/settlement-steps), #1170 (feat/1151-auction-validation)

## Context

PR #1144 (`feat/settlement-steps`) introduces auction settlement-step UI and
order-detail UX. During development, WIP validation logic was prototyped
directly on this branch in two commits:

- `885fdfb2` — "WIP: Local Validation"
- `a6fe339f` — "WIP: Auction validation"

These commits added client-side validation helpers (`validateAuctionImmutableTags`,
`validateBidLocalOnly`, `validateSettlementEventLocalOnly`,
`validatePathReleaseLocalOnly`) and related query functions
(`fetchAndValidateAuctionEvent`, `fetchAuctionRelatedEvents`,
`useAuctionWithRelatedEvents`) to `src/lib/auction/validation.ts` and
`src/queries/auctions.tsx`.

Concurrently, PR #1170 (`feat/1151-auction-validation`) was developed as the
dedicated, comprehensive auction validation branch. That PR has undergone
detailed review (see maximotodev review on #1170) and addresses blocking
concerns that the WIP validation in #1144 does not:

1. Event authentication before parsing or buffering
2. Requiring every expected proof to be spent (not just any)
3. Validator-observed release timing (not seller-controlled `created_at`)
4. Post-grace redemption observability
5. Per-mint availability scoping (not gating the entire auction)
6. Close-role assignment wiring into the production lifecycle
7. Pinned auction identity (seller, `d` tag, coordinate, root lineage)

## Decision

**Strip all validation logic from `feat/settlement-steps` and treat
`feat/1151-auction-validation` (#1170) as the parent branch for all auction
validation work.**

This branch (`feat/settlement-steps-no-validation`) is created from
`feat/settlement-steps` with the two WIP validation commits reverted. Clear
placeholders have been added in the stripped files pointing to #1170 and this
ADR.

### Merge strategy

1. `feat/settlement-steps-no-validation` should be merged into `feat/settlement-steps`
   (or replace it) to produce a clean settlement-UI-only branch.
2. The clean settlement branch should then be merged **into** `feat/1151-auction-validation`
   (#1170), which is the parent branch for validation.
3. When merging, re-introduce the validation functions from #1170's
   implementation, which is more complete and addresses all blocking review
   findings.
4. Do **not** re-introduce the stripped WIP validation code — it is superseded
   by #1170.

## Consequences

- `feat/settlement-steps` (or its successor) becomes a pure UI/UX branch with
  no validation logic, making it easier to review and merge independently.
- All validation concerns are centralized in #1170, avoiding duplication and
  divergent implementations.
- Placeholder comments in `src/lib/auction/validation.ts` and
  `src/queries/auctions.tsx` document what was removed and where it should
  come from.
- The merge order is: settlement-UI → #1170 (validation parent) → `auctions`.

## Files modified

| File | Change |
|------|--------|
| `src/lib/auction/validation.ts` | Stripped `validateAuctionImmutableTags`, `validateBidLocalOnly`, `validateSettlementEventLocalOnly`, `validatePathReleaseLocalOnly`; added placeholder |
| `src/queries/auctions.tsx` | Stripped `fetchAndValidateAuctionEvent`, `fetchAndValidateRelatedAuctionEvent`, `fetchAuctionRelatedEvents`, `auctionWithRelatedEventsQueryOptions`, `useAuctionWithRelatedEvents`; added placeholder |
| `src/components/AuctionSettlement.tsx` | Reverted validation-related imports and `useAuctionWithRelatedEvents` usage; restored pre-validation state |
| `docs/adr/ADR-0015-settlement-validation-split.md` | This ADR |