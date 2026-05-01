# Manual Happy Path Validation — Auction Trusted Mint State Ownership

Branch: `fix/auction-trusted-mint-state-ownership`
Target: `feature/auctions-better-auction-submission-form`

## Overview

Run a local relay + dev server on the VPS, then manually verify the auction form's trusted mint UI behaves correctly: initialization, removal, custom mint addition, and re-addition of previously-removed mints.

## Ports

- App: **34568** (avoids conflict with the 34567 deployment from `fix/auction-shipping-ref-dedupe`)
- Relay: **10548** (avoids conflict with the 10547 relay from `fix/auction-shipping-ref-dedupe`)

---

## Current Deployment

**VPS IP:** `23.182.128.51`
**Date deployed:** 2026-04-30

| Service | PID | Port | Command |
|---|---|---|---|
| Nostr relay (nak) | 557721 | 10548 | `nak serve --hostname 0.0.0.0 --port 10548` |
| Plebeian Market dev server | 557816 | 34568 | `bun --hot src/index.tsx --host 0.0.0.0` |

### Login

| Field | Value |
|---|---|
| URL | `http://23.182.128.51:34568` |
| nsec (browser login) | `nsec18cmyxjcca6y8s3yhegt7nmrcxw9pn4ugnqe68jfc8km3sr2c5d2srsltll` |
| hex PK | `86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0` |

---

## Prerequisites

```bash
# 1. bun (if not installed)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# 2. nak (if not installed)
go install github.com/nostrtools/nak@latest
export PATH=$PATH:$(go env GOPATH)/bin

# 3. npm dependencies
cd /root/fix-auction-trusted-mint-state-ownership/market
bun install
```

---

## Setup

### Step 1: Start the relay

```bash
nak serve --hostname 0.0.0.0 --port 10548 &
echo $! > /tmp/mint-test-relay.pid
```

**Verify:** `ss -tlnp | grep 10548` shows nak listening.

### Step 2: Start the dev server

```bash
cd /root/fix-auction-trusted-mint-state-ownership/market

nohup bash -c 'NODE_ENV=test PORT=34568 \
  APP_RELAY_URL=ws://localhost:10548 \
  APP_PRIVATE_KEY=e2e0000000000000000000000000000000000000000000000000000000000001 \
  LOCAL_RELAY_ONLY=true \
  NIP46_RELAY_URL=ws://localhost:10548 \
  bun --hot src/index.tsx --host 0.0.0.0' > /tmp/mint-test-dev.log 2>&1 &
echo $! > /tmp/mint-test-dev.pid
```

**Verify:** `ss -tlnp | grep 34568` shows bun listening.

### Step 3: Seed relay data

```bash
cd /root/fix-auction-trusted-mint-state-ownership/market
RELAY_URL=ws://localhost:10548 bun e2e-new/seed-relay.ts
```

**Verify:** Console shows "Published profile: TestMerchant", "Published admin list", etc.

### Step 4: Log in as TestMerchant

1. Open `http://<VPS_IP>:34568` in browser
2. Click **Login** -> **Private Key** tab
3. Paste: `nsec18cmyxjcca6y8s3yhegt7nmrcxw9pn4ugnqe68jfc8km3sr2c5d2srsltll`
4. Click **Login**

**Verify:** "TestMerchant" profile avatar/name in header.

---

## Validation Checklist

### Test 1: Mint initialization

1. Navigate to `/auctions`
2. Click **Create Auction**
3. Click the **Auction** tab
4. Scroll to **Trusted Mints**

**Pass criteria:**

- All production mints shown as selected (solid border, X button):
  - `https://mint.minibits.cash/Bitcoin`
  - `https://mint.coinos.io`
  - `https://mint.cubabitcoin.org`
- Dev test mints also shown (because `NODE_ENV=test`):
  - `https://testnut.cashu.space`
  - `https://nofees.testnut.cashu.space`

### Test 2: Remove a mint

1. Click the **X** button on `https://testnut.cashu.space`

**Pass criteria:**

- The mint disappears from the selected list
- It appears in the "Add a mint" section below (dashed border, + button)
- Remaining selected mints are unchanged

### Test 3: Cannot remove last mint

1. Remove mints until only 1 remains

**Pass criteria:**

- The last mint's X button is disabled (grayed out, no hover cursor)
- Tooltip on hover says: "At least one mint is required"

### Test 4: Re-add a mint via suggestion button

1. Click the **+** button on one of the unselected mints

**Pass criteria:**

- The mint moves back to the selected list
- The "Add a mint" section no longer shows that mint

### Test 5: Add a custom mint via text input

1. In the text input below the "Add a mint" section, type: `https://my-custom-mint.example.com`
2. Press **Enter** (or click the + button)

**Pass criteria:**

- The custom mint URL appears in the selected list
- The text input is cleared after adding
- The selected count increased by 1

### Test 6: Empty input doesn't add

1. Ensure the text input is empty
2. Observe the **+** button next to the input

**Pass criteria:**

- The + button is **disabled** when input is empty
- Clicking it (if somehow possible) does nothing

### Test 7: Re-add a removed mint via text input

1. Remove a mint (e.g. `https://testnut.cashu.space`) using the X button
2. Type the exact same URL into the text input
3. Press **Enter**

**Pass criteria:**

- The mint reappears in the selected list
- It is identical to how it looked before removal

### Test 8: Full form submission (publish auction)

1. Start a fresh **Create Auction** form

**Name tab:**

- Title: "Mint State Test Auction"
- Description: "Manual validation of trusted mint state ownership"

**Auction tab:**

- Starting Bid: 100
- Bid Increment: 10 (default)
- End Time: leave as Duration / 1 day
- Verify all trusted mints are selected

**Category tab:**

- Main Category: pick any (e.g. "Bitcoin")

**Images tab:**

- Upload or paste an image URL

**Submit:**

- Click **Publish Auction**

**Pass criteria:**

- Form sheet/drawer closes
- Navigated to `/auctions`
- New auction appears in the list

### General checks

- No console errors in browser DevTools
- No layout issues (overflow, overlapping text, clipped mint URLs)
- Mint URLs with long paths are truncated with `title` tooltip on hover

---

## Cleanup

```bash
kill $(cat /tmp/mint-test-dev.pid 2>/dev/null) 2>/dev/null
kill $(cat /tmp/mint-test-relay.pid 2>/dev/null) 2>/dev/null
rm -f /tmp/mint-test-dev.pid /tmp/mint-test-relay.pid /tmp/mint-test-dev.log
```

---

## Automated test commands

```bash
# Unit tests (11 syncMintSelection tests)
cd /root/fix-auction-trusted-mint-state-ownership/market
make test-unit

# E2E mint state tests (5 Playwright tests)
make test-e2e-mint

# Format check
make test-format

# All
make test-all
```
