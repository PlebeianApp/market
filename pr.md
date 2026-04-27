## Summary

Fixes a bug where the auction form's trusted mint selection could drift out of sync with the current source of truth (`availableMints`). The form previously initialized `trustedMints` only once in a `useState` lazy initializer, so if `availableMints` changed after mount (e.g. dev mode toggle, stage change, async config load), the form would silently hold stale mint selections — potentially publishing auctions with mints from the wrong environment.

## Changes

- **Extracted `syncMintSelection`** into a pure function in `src/lib/auctionMintSync.ts` — adds newly-available mints, removes disappeared ones, and preserves the user's explicit removals
- **Added a `useEffect` + `useRef`** in `AuctionFormContent.tsx` that calls `syncMintSelection` whenever `availableMints` changes, keeping form state in sync
- **Added 7 unit tests** for `syncMintSelection` covering add, remove, simultaneous add/remove, empty states, and reference-equality short-circuit (89 total pass)
- **Added 2 Playwright E2E tests** for mint initialization and removal in the auction form
- **Upgraded bun 1.3.4 → 1.3.13** — fixes subpath import resolution that prevented the E2E dev server from rendering the auction page; unskipped 91 pre-existing E2E test failures (98 now pass)

## Sync Strategy

| Scenario                                                             | Behavior               |
| -------------------------------------------------------------------- | ---------------------- |
| New mint appears in `availableMints`                                 | Added to selection     |
| Mint disappears from `availableMints`                                | Removed from selection |
| Mint was available before and after the change, user had it selected | Kept                   |
| Mint was available before and after the change, user had removed it  | Kept removed           |

## Files

- `src/lib/auctionMintSync.ts` — new pure sync function
- `src/lib/__tests__/auctionMintSync.test.ts` — new unit tests
- `src/components/sheet-contents/auctions/AuctionFormContent.tsx` — sync effect
- `e2e-new/tests/auction-mint-state.spec.ts` — new E2E tests
- `docs/plans/trusted-mint-state-ownership.md` — design doc
- `package.json` / `bun.lock` — bun 1.3.13

## Test Results

- **Unit:** 89 pass (7 new)
- **E2E:** 98 pass, 8 skipped, 0 regressions
