# Trusted Mint State Ownership

## Objective

The auction form (`src/components/sheet-contents/auctions/AuctionFormContent.tsx`) initializes `trustedMints` from `availableMints` only once — in the `useState` lazy initializer. If `availableMints` changes after mount (e.g. because dev mode is toggled, the app stage changes from staging to production, or config is loaded asynchronously), the form's `trustedMints` selection drifts from the current source of truth.

This PR ties the form's trusted mint state to the current source of truth by syncing `formData.trustedMints` whenever `availableMints` changes.

## Branch

`fix/auction-trusted-mint-state-ownership`
Base: `feature/auctions-better-auction-submission-form` (tip: `84b397b7`)
Target PR: `feature/auctions-better-auction-submission-form`

## Files to Modify

### 1. `src/components/sheet-contents/auctions/AuctionFormContent.tsx`

**Current state (lines 903-909):**

```tsx
const availableMints = useMemo(
    () => Array.from(new Set([...DEFAULT_TRUSTED_MINTS, ...(walletDevMode ? NIP60_DEV_TEST_MINTS : [])])),
    [walletDevMode],
)

const [formData, setFormData] = useState<AuctionFormData>(() => ({ ...INITIAL_FORM, trustedMints: [...availableMints] }))
```

The `useState` lazy initializer runs once on mount. If `walletDevMode` later changes (causing `availableMints` to change), `formData.trustedMints` is not updated.

**Required changes:**

#### Step 1: Add `useRef` and `useEffect` to the React import

Line 20 currently imports:
```tsx
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
```

Change to:
```tsx
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
```

#### Step 2: Add sync effect after the `availableMints` memo and `formData` state (after line 909)

```tsx
const prevAvailableMintsRef = useRef(availableMints)

useEffect(() => {
    const prev = prevAvailableMintsRef.current
    if (prev === availableMints) return

    const removedMints = prev.filter((m) => !availableMints.includes(m))
    const addedMints = availableMints.filter((m) => !prev.includes(m))

    setFormData((prevForm) => ({
        ...prevForm,
        trustedMints: [
            ...prevForm.trustedMints.filter((m) => !removedMints.includes(m)),
            ...addedMints,
        ],
    }))

    prevAvailableMintsRef.current = availableMints
}, [availableMints])
```

**Sync strategy:**

| Scenario | Behavior |
|---|---|
| Mint appears in new `availableMints` that wasn't in old | Added to selection (new default-on) |
| Mint disappears from `availableMints` that was in old | Removed from selection (no longer valid) |
| Mint exists in both old and new, and user had it selected | Kept (user wants it) |
| Mint exists in both old and new, and user had removed it | Kept removed (user's choice preserved) |

This is the minimal-correctness approach: the form stays in sync with available mints without silently overriding the user's explicit removals.

### 2. No other files need modification

The `AuctionTabContent` component (which renders the mint add/remove UI), the `canSubmit` validation, and the `handleSubmit` function all operate on `formData.trustedMints` and will work correctly once the sync is in place.

## Unit Tests

### File: `src/lib/__tests__/auctionMintSync.test.ts` (new file)

Create a new test file. Use `bun:test` (not vitest, not jest).

```ts
import { describe, expect, test } from 'bun:test'
```

#### Test cases:

1. **`syncMintSelection — adds newly available mints`**
   - Previous available: `['mint-a', 'mint-b']`
   - Current available: `['mint-a', 'mint-b', 'mint-c']`
   - Current selection: `['mint-a', 'mint-b']`
   - Expected result: `['mint-a', 'mint-b', 'mint-c']` (mint-c added)

2. **`syncMintSelection — removes mints that are no longer available`**
   - Previous available: `['mint-a', 'mint-b', 'mint-c']`
   - Current available: `['mint-a', 'mint-c']`
   - Current selection: `['mint-a', 'mint-b', 'mint-c']`
   - Expected result: `['mint-a', 'mint-c']` (mint-b removed)

3. **`syncMintSelection — preserves user's explicit removals`**
   - Previous available: `['mint-a', 'mint-b', 'mint-c']`
   - Current available: `['mint-a', 'mint-b', 'mint-c']` (no change)
   - Current selection: `['mint-a']` (user removed mint-b and mint-c)
   - Expected result: `['mint-a']` (removals preserved — no-op since available didn't change)

4. **`syncMintSelection — handles add and remove simultaneously`**
   - Previous available: `['mint-a', 'mint-b']`
   - Current available: `['mint-a', 'mint-c', 'mint-d']`
   - Current selection: `['mint-a', 'mint-b']`
   - Expected result: `['mint-a', 'mint-c', 'mint-d']` (mint-b removed, mint-c and mint-d added)

5. **`syncMintSelection — empty selection with new available mints`**
   - Previous available: `[]`
   - Current available: `['mint-a', 'mint-b']`
   - Current selection: `[]`
   - Expected result: `['mint-a', 'mint-b']` (all new mints added)

6. **`syncMintSelection — all mints removed from available`**
   - Previous available: `['mint-a', 'mint-b']`
   - Current available: `[]`
   - Current selection: `['mint-a']`
   - Expected result: `[]` (everything removed)

7. **`syncMintSelection — no change when available is identical reference`**
   - Same array reference for previous and current
   - Current selection: `['mint-a']`
   - Expected result: `['mint-a']` (no-op)

**Important:** The sync logic should be extracted into a pure function (e.g. `syncMintSelection(prevAvailable, currentAvailable, currentSelection)`) so it can be unit-tested independently of React hooks. Place it in `src/lib/auctionMintSync.ts` (new file) and import it in both the component and the test.

## Integration Tests

Not applicable — the sync depends on React state and store subscriptions which require a running app. The unit tests above cover the pure logic. The Playwright E2E tests below cover the full integration.

## Playwright E2E Tests

### File: `e2e-new/tests/auction-mint-state.spec.ts` (new file)

Use the existing test infrastructure:

```ts
import { test, expect } from '../fixtures'
```

#### Test cases:

1. **`auction form — trusted mints initialize with available mints`**
   - Navigate to the auction creation form (open the auction creation sheet).
   - Assert that all available mints are shown as selected in the "Trusted Mints" section.
   - In dev/staging mode, this should include both production and dev test mints.

2. **`auction form — user can remove a mint and the form stays valid`**
   - Navigate to the auction creation form.
   - Remove one of the default mints (click the X button).
   - Assert that the mint is no longer in the selected list.
   - Assert that at least one mint remains (the remove button on the last mint should be disabled).

**Important E2E notes:**

- Use `test.setTimeout(60_000)` for each test.
- Use the `merchantPage` fixture with `scenario: 'merchant'`.
- The auction creation form is likely opened via a button or navigation. Check the existing E2E tests and the app routes to find the correct way to open the form. Look at `src/routes/` for auction-related routes and check for "Create Auction" buttons or navigation.
- The Playwright config is at `e2e-new/playwright.config.ts` and tests run with: `NODE_OPTIONS='--dns-result-order=ipv4first' npx playwright test --config=e2e-new/playwright.config.ts`

## Verification Commands

Run these commands after completing all changes. ALL must pass before considering the work done.

```bash
# Format check (must pass — no uncommitted formatting issues)
bun run format:check

# If format check fails, run:
bun run format

# Unit tests
bun test:unit

# E2E tests (only the new mint state test file)
NODE_OPTIONS='--dns-result-order=ipv4first' npx playwright test --config=e2e-new/playwright.config.ts tests/auction-mint-state.spec.ts

# Full E2E suite (run this too, to check for regressions)
NODE_OPTIONS='--dns-result-order=ipv4first' npx playwright test --config=e2e-new/playwright.config.ts
```

## Code Style

- No semicolons
- Tabs for indentation
- Single quotes
- 140 character print width
- No comments unless absolutely necessary

## Done Criteria

1. `formData.trustedMints` stays in sync with `availableMints` when the source of truth changes
2. User's explicit mint removals are preserved across syncs
3. The sync logic is extracted into a pure, unit-testable function
4. Unit tests pass for the pure function (7 test cases)
5. E2E tests pass for the form mint UI
6. `bun run format:check` passes
7. `bun test:unit` passes
8. Playwright E2E tests pass with no regressions
