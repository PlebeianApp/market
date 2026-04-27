# Manual E2E Test — Auction Trusted Mint Sync

Happy path verification for the `fix/auction-trusted-mint-state-ownership` branch.

## Prerequisites

- nak relay running on `ws://localhost:10547`
- bun dev server running (see Makefile targets)

## 1. Unit Tests

Run the unit test suite. The 7 `syncMintSelection` tests in `src/lib/__tests__/auctionMintSync.test.ts` must pass alongside all other unit tests.

```bash
make test-unit
```

**Expected:** 89 pass, 0 fail

## 2. E2E Mint State Tests

Run the Playwright tests for auction mint state. These verify mint initialization and removal in the form.

```bash
make test-e2e-mint
```

**Expected:** 2 pass, 0 fail

## 3. Format Check

```bash
make test-format
```

**Expected:** "Checking formatting..." with no errors

## 4. Manual Browser — Mint Initialization

1. Open `http://localhost:3000/auctions`
2. Log in as the dev user (or any authenticated user)
3. Click the **Create Auction** button
4. Click the **Auction** tab
5. Scroll to the **Trusted Mints** section

**Verify:**

- All 5 mints are shown as selected (solid border, with X remove button):
  - `https://mint.minibits.cash/Bitcoin`
  - `https://mint.coinos.io`
  - `https://mint.cubabitcoin.org`
  - `https://testnut.cashu.space`
  - `https://nofees.testnut.cashu.space`

> The last 2 are dev test mints, shown because `NODE_ENV=development` enables wallet dev mode.

## 5. Manual Browser — Mint Removal

Starting from the open form with all 5 mints selected:

1. Click the **X** button on one of the selected mints (e.g. `https://testnut.cashu.space`)

**Verify:**

- The mint moves to the unselected section below (dashed border, with + add button)
- The selected count decreases by 1
- 4 mints remain selected

2. Repeat until only 1 mint remains selected

**Verify:**

- The last mint's remove button is disabled
- Hovering over it shows a tooltip: "At least one mint is required"

3. Click the **+** button on one of the unselected mints

**Verify:**

- The mint moves back to the selected section
- The selected count increases by 1

## 6. Manual Browser — Full Form Submission

Starting from a fresh **Create Auction** form:

### Name tab

1. Enter a title (e.g. "Test Auction")
2. Enter a description (e.g. "Manual E2E test auction")

### Auction tab

1. Enter a **Starting Bid** (e.g. "100")
2. Verify **Bid Increment** is pre-filled with "1"
3. Leave **End Time** on Duration mode with the default 1 day
4. Verify trusted mints are all selected (see step 4)

### Images tab

1. Upload or paste at least 1 image URL

### Submit

1. Click the **Submit** or **Create** button (bottom of the form)

**Verify:**

- The form sheet/drawer closes
- You are navigated to `/auctions`
- The new auction appears in the list
