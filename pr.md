## Summary

Fixes a bug where the auction form's trusted mint selection could drift out of sync with the current source of truth (`availableMints`), and adds the ability for users to add custom mint URLs and recover when mints go offline and come back.

**Reviewer feedback addressed:**

- Mints should stay in the selection when they go offline (user chose them, they may come back)
- User should be able to recover from a mint going away and coming back (explicit removals are remembered)
- User should be able to add mints that aren't in the `availableMints` list (e.g. offline mints, custom mints)

## Changes

### `src/lib/auctionMintSync.ts` — pure sync function

Accepts a new `userRemovedMints: Set<string>` parameter. Changed behavior:

| Scenario                                   | Behavior                                               |
| ------------------------------------------ | ------------------------------------------------------ |
| New mint appears in `availableMints`       | Added to selection (unless user explicitly removed it) |
| Mint disappears from `availableMints`      | **Kept** in selection (user chose it, may come back)   |
| Returning mint the user explicitly removed | **Not** re-added                                       |
| Returning mint the user did not remove     | Re-added                                               |
| Custom mint not in `availableMints`        | Preserved in selection                                 |

Previous behavior auto-removed offline mints, which prevented recovery.

### `src/components/sheet-contents/auctions/AuctionFormContent.tsx` — form UI

- Added `userRemovedMintsRef` (a `useRef<Set<string>>`) to track mints the user explicitly removed via the X button
- `removeMint()` adds the mint to the removal set; `addMint()` clears it
- Added a free-text input + button below the suggestion list so users can type any mint URL and add it
- Passed `userRemovedMints` through to `syncMintSelection` in the `useEffect`

### `src/lib/__tests__/auctionMintSync.test.ts` — unit tests

7 existing tests updated for new signature + 4 new tests = **11 total**:

- Adds newly available mints
- Does not auto-remove mints that leave `availableMints`
- Preserves user explicit removals
- Handles add and keep simultaneously
- Empty selection with new available mints
- All mints removed from available but kept in selection
- No change when available is identical reference
- Returning mint is not re-added when user explicitly removed it
- Returning mint IS re-added when user did not remove it
- Custom mint not in `availableMints` is preserved in selection
- Does not duplicate mints already in selection

### `e2e-new/tests/auction-mint-state.spec.ts` — Playwright E2E

2 existing + 3 new = **5 total**:

1. Trusted mints initialize with available mints
2. User can remove a mint and the form stays valid
3. User can add a custom mint URL via text input
4. User can re-add a previously removed mint via text input
5. Empty text input does not add a mint

## Test Results

| Category              | Result                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Unit tests            | 11/11 pass                                                                                |
| Playwright E2E        | 5/5 pass                                                                                  |
| Prettier format check | pass                                                                                      |
| Manual validation     | 7/7 pass (Test 8 — full publish — skipped: requires NIP-60 wallet seed, pre-existing gap) |

## Manual Test Scenarios (for reviewer)

1. Open auction form -> Auction tab -> verify all mints initialized as selected
2. Click X on a mint -> verify it moves to unselected section
3. Remove all but one mint -> verify last X is disabled with tooltip
4. Click + on unselected mint -> verify it moves back to selected
5. Type custom URL in text input -> press Enter -> verify it appears in selected list
6. Leave text input empty -> verify + button is disabled
7. Remove a mint, type same URL in text input, press Enter -> verify it reappears

## Files Changed

| File                                                            | Change                                               |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `src/lib/auctionMintSync.ts`                                    | Pure function: no auto-remove, respect user removals |
| `src/lib/__tests__/auctionMintSync.test.ts`                     | 11 unit tests                                        |
| `src/components/sheet-contents/auctions/AuctionFormContent.tsx` | Free-text input + removal tracking                   |
| `e2e-new/tests/auction-mint-state.spec.ts`                      | 5 E2E tests                                          |
