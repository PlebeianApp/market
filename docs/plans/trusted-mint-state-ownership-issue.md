fix(auctions): tie trusted mint form state to source of truth

## Problem

The auction form initializes `trustedMints` from `availableMints` only once — in the `useState` lazy initializer at mount time. If `availableMints` changes after mount (e.g. dev mode toggle, app stage change, async config load), the form's mint selection drifts from the current source of truth.

This means a user who opens the form in staging (with dev test mints pre-selected) could publish an auction with dev-only mints if the environment changes before they submit. Conversely, if new mints are added to the available set while the form is open, the user won't see them.

## Scope

- Add a `useEffect` + `useRef` to sync `formData.trustedMints` when `availableMints` changes
- Sync strategy: add newly-available mints, remove disappeared mints, preserve user's explicit removals
- Extract the sync logic into a pure, unit-testable function
- Add unit tests for the sync function
- Add Playwright E2E tests for the form mint UI

## Files

- `src/components/sheet-contents/auctions/AuctionFormContent.tsx` — add sync effect
- `src/lib/auctionMintSync.ts` (new) — pure `syncMintSelection` function
- `src/lib/__tests__/auctionMintSync.test.ts` (new) — unit tests
- `e2e-new/tests/auction-mint-state.spec.ts` (new) — E2E tests

## Follow-up to

#813

## Design doc

See `docs/plans/trusted-mint-state-ownership.md` in the `fix/auction-trusted-mint-state-ownership` branch for the full implementation plan.
