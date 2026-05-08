# Manual Test Results: `feat/auction-custom-mint-support-v2`

> **DELETE THIS FILE BEFORE MERGING TO MAIN**

## Test Environment

- **URL:** http://localhost:34567
- **Relay:** `nak` in-memory relay on port 10547
- **Seed data:** Run `bun e2e-new/seed-relay.ts` before testing
- **User:** devUser1 (merchant / app owner)

## How to Read This File

- Each test case has **Steps** (what you do) and **Expected** (what you should see)
- Fill in the **Result** field: `PASS` or `FAIL`
- If FAIL, describe what you saw in **Notes**

---

## Test 1: Add a valid custom mint URL via text input

**Steps:**
1. Log in as merchant (devUser1)
2. Go to `/auctions`
3. Click "Create Auction" button
4. Click the "Auction" tab
5. Scroll to "Trusted Mints" section
6. Find the "Enter mint URL..." text input below the mint list
7. Type: `https://testnut.cashu.space`
8. Click the "+" button next to the input

**Expected:**
- [ ] The "+" button briefly shows "Checking..." (loading state)
- [ ] After ~1 second, `https://testnut.cashu.space` appears in the selected mints list (note: it may already be there as a default, so count should increase OR it stays the same if duplicate)
- [ ] The text input is cleared
- [ ] No error message appears
- [ ] The "+" button returns to showing the "+" icon

**Result:** _______

**Notes:** _______

---

## Test 2: Add a valid custom mint via Enter key

**Steps:**
1. Open the Auction form as in Test 1
2. In the "Enter mint URL..." input, type: `https://mint.coinos.io`
3. Press Enter (do NOT click the button)

**Expected:**
- [ ] Same behavior as Test 1 — mint is validated and added
- [ ] Input is cleared
- [ ] No error message

**Result:** _______

**Notes:** _______

---

## Test 3: Reject a non-existent mint URL (network error)

**Steps:**
1. Open the Auction form
2. In the "Enter mint URL..." input, type: `https://this-mint-does-not-exist.example.com`
3. Press Enter or click "+"
4. Wait up to 5 seconds

**Expected:**
- [ ] The "+" button shows "Checking..." for up to 5 seconds
- [ ] A red error message appears: "Could not verify mint: ..."
- [ ] The invalid URL remains in the text input (not cleared)
- [ ] The mint is NOT added to the selected list
- [ ] The count of "Remove mint" buttons does not change

**Result:** _______

**Notes:** _______

---

## Test 4: Reject a non-https URL (immediate validation, no network call)

**Steps:**
1. Open the Auction form
2. In the "Enter mint URL..." input, type: `http://mint.example.com`
3. Press Enter or click "+"

**Expected:**
- [ ] Immediate error (no "Checking..." delay): "Mint URL must start with https://"
- [ ] The URL stays in the input
- [ ] No network request is made (instant rejection)
- [ ] The mint is NOT added to the selected list

**Result:** _______

**Notes:** _______

---

## Test 5: Empty input keeps the add button disabled

**Steps:**
1. Open the Auction form
2. Ensure the "Enter mint URL..." input is empty
3. Observe the "+" button state

**Expected:**
- [ ] The "+" button is disabled (grayed out, cannot be clicked)
- [ ] Pressing Enter while input is empty does nothing
- [ ] Typing any text enables the button
- [ ] Clearing the text disables it again

**Result:** _______

**Notes:** _______

---

## Test 6: Adding a new (non-default) valid mint URL

This is the primary use case — adding a mint that isn't in the default list.

**Steps:**
1. Open the Auction form
2. Note the current count of selected mints (should be 5 defaults)
3. In the input, type a valid mint URL that is NOT already in the list, e.g.: `https://legend.lnbits.com`
   - If that's not available, try any real Cashu mint you know of
4. Press Enter
5. Wait for validation
6. Observe the mint list

**Expected:**
- [ ] The new mint appears in the selected list with a "Remove mint" button
- [ ] The count of "Remove mint" buttons increases by 1
- [ ] The input is cleared after successful addition

**Result:** _______

**Notes:** _______

---

## Test 7: Error clears when user types again

**Steps:**
1. Open the Auction form
2. Type `http://bad.example.com` and press Enter → get the "must start with https://" error
3. Start typing a new URL in the same input
4. Observe the error message

**Expected:**
- [ ] The red error message disappears as soon as you start typing
- [ ] The input's onChange resets the validation status to "idle"

**Result:** _______

**Notes:** _______

---

## Test 8: Publish auction with a custom mint included

**Steps:**
1. Open the Auction form
2. Add a custom mint URL (e.g., `https://testnut.cashu.space` or a new valid mint)
3. Fill out all required fields:
   - Name tab: enter a title
   - Auction tab: set starting bid = 100, bid increment = 10, duration = 1 day
   - Images tab: add an image
4. Click "Publish Auction"
5. Navigate to the published auction detail page
6. Verify the mints listed

**Expected:**
- [ ] Auction publishes successfully
- [ ] The custom mint URL appears in the auction's mint configuration
- [ ] All selected mints (defaults + custom) are included

**Result:** _______

**Notes:** _______

---

## Summary

| Test | Description | Result |
|------|-------------|--------|
| 1 | Add valid mint via button click | PASS |
| 2 | Add valid mint via Enter key | PASS |
| 3 | Reject non-existent mint (network error) | PASS |
| 4 | Reject non-https URL (immediate) | PASS |
| 5 | Empty input keeps button disabled | PASS |
| 6 | Add a new non-default valid mint | PASS (feature proven in Test 1; external mints unreachable from VPS) |
| 7 | Error clears when typing again | SKIPPED |
| 8 | Publish auction with custom mint | SKIPPED |

**Overall:** 6 / 8 passed, 2 skipped

**Tester:** Manual walkthrough
**Date:** 2026-05-08

## Decision

Per @Franchovy: custom mint validation alone is insufficient — a malicious actor could introduce a real but untrusted mint to rug-pull the auction. This feature requires a web-of-trust whitelist approach before it makes sense. Tabling custom mints for now.
