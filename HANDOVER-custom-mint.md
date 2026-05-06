# Handover: Custom Mint URL Support for Auctions

## Status: IMPLEMENTED

This branch (`feat/auction-custom-mint-support`) has the custom mint feature **fully implemented** with hard-block validation. The mint URL is verified against the Cashu `/v1/info` endpoint before it can be added.

## What Was Done

### New files

| File                                                    | Purpose                                                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/validateMintUrl.ts`                            | Async validation: normalizes URL, checks https, calls `CashuMint.getInfo()` with 5s timeout. Returns `{ valid: true }` or `{ valid: false, error: string }` |
| `src/lib/__tests__/validateMintUrl.test.ts`             | 7 unit tests (all mocked): valid mint, empty, whitespace, non-https, network error, timeout, trailing slash normalization                                   |
| `src/lib/__tests__/validateMintUrl.integration.test.ts` | 2 integration tests (real HTTP): known good mint (`testnut.cashu.space`), non-existent domain                                                               |

### Modified files

| File                         | Changes                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `AuctionFormContent.tsx`     | Added `mintValidation` state, `addCustomMint()` now async with validation gate, UI shows "Checking..." spinner + red error message |
| `auctionMintSync.test.ts`    | Restored custom-mint-preserved test (11 total)                                                                                     |
| `auction-mint-state.spec.ts` | 6 Playwright E2E tests including invalid-URL validation test                                                                       |

### Test coverage

| Level                                               | Tests   | Status                                                                                                        |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| Unit (`validateMintUrl.test.ts`)                    | 7 pass  | Mocked CashuMint                                                                                              |
| Unit (`auctionMintSync.test.ts`)                    | 11 pass | Pure function                                                                                                 |
| Integration (`validateMintUrl.integration.test.ts`) | 2 pass  | Real HTTP to testnut.cashu.space                                                                              |
| E2E (`auction-mint-state.spec.ts`)                  | 6 tests | Playwright (pre-existing env issue — app crashes with `Cannot read properties of undefined (reading 'atom')`) |

### How validation works (hard block)

1. User types a mint URL and presses Enter or clicks +
2. UI shows "Checking..." spinner, input and button are disabled
3. `validateMintUrl()` is called: normalizes URL, checks `https://`, calls `CashuMint.getInfo()` with 5s timeout
4. If valid → mint is added to selection, input cleared
5. If invalid → red error message appears below input (e.g. "Could not verify mint: network failure"), mint is NOT added
6. User can edit the URL to try again — typing clears the error

### Known mint for testing

The test mint `https://testnut.cashu.space` is used in integration and E2E tests. It's already in `NIP60_DEV_TEST_MINTS` in the codebase.

## Remaining Work Before Merge

1. **Buyer-facing warning UI** — Add a note near the custom mint input explaining that custom mints are not vetted by the platform and buyers should verify trust
2. **Target branch** — Per Franchovy on PR #840, retarget PR to `origin/auctions/cashu-p2pk-path-oracle-v1`
3. **E2E environment fix** — The Playwright E2E test suite has a pre-existing crash (`Cannot read properties of undefined (reading 'atom')`) that prevents any E2E test from running. This affects ALL tests, not just ours. Needs investigation.

## Key Commit References

| Hash       | Description                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------- |
| `de9a646f` | Removal commit on `fix/auction-trusted-mint-state-ownership` (custom mints removed for scope) |
| `16e71e12` | Initial restore of custom mint code on this branch                                            |
| HEAD       | This commit — adds validation, tests, UI feedback                                             |
