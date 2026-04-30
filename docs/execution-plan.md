# Execution Plan — Playwright Tests + Manual Happy Path

Branch: `fix/auction-trusted-mint-state-ownership`
Target: `feature/auctions-better-auction-submission-form`

## Overview

1. Run Playwright E2E tests on isolated ports (34568/10548)
2. After tests pass, spin up a persistent instance on those same ports for manual happy path validation

## Ports

| Service | Port | Notes |
|---|---|---|
| App (Playwright + manual) | **34568** | Avoids conflict with 34567 (shipping-ref-dedupe) |
| Relay (Playwright + manual) | **10548** | Avoids conflict with 10547 (shipping-ref-dedupe) |

## Step 1: Create `/root/.ports.conf`

Shared port registry so concurrent LLM sessions don't collide.

## Step 2: Modify `e2e-new/test-config.ts`

Add env var overrides for `RELAY_URL` and `TEST_PORT`:

```ts
export const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:10547'
export const TEST_PORT = parseInt(process.env.TEST_PORT || '34567', 10)
```

Backward compatible — defaults match current hardcoded values.

## Step 3: Modify `e2e-new/playwright.config.ts`

Derive relay port from `RELAY_URL` and use it in nak command and port check:

```ts
const RELAY_PORT = parseInt(RELAY_URL.split(':').pop()!, 10)
```

Use in webServer config:

```ts
{
  command: `nak serve --hostname 0.0.0.0 --port ${RELAY_PORT}`,
  port: RELAY_PORT,
  ...
}
```

## Step 4: Run Playwright tests

```bash
export PATH=$PATH:/root/go/bin
cd /root/fix-auction-trusted-mint-state-ownership/market

RELAY_URL=ws://localhost:10548 TEST_PORT=34568 \
  NODE_OPTIONS='--dns-result-order=ipv4first' \
  npx playwright test --config=e2e-new/playwright.config.ts \
  e2e-new/tests/auction-mint-state.spec.ts
```

**Expected:** 5 tests pass (mint init, remove, custom add, re-add removed, empty input).

## Step 5: Start manual testing instance

After Playwright finishes, start persistent relay + dev server on 34568/10548:

```bash
# Relay
/root/go/bin/nak serve --hostname 0.0.0.0 --port 10548 &
echo $! > /tmp/mint-test-relay.pid

# Seed
RELAY_URL=ws://localhost:10548 bun e2e-new/seed-relay.ts

# Dev server
RELAY_URL=ws://localhost:10548 PORT=34568 \
  NODE_ENV=test APP_RELAY_URL=ws://localhost:10548 \
  APP_PRIVATE_KEY=e2e0000000000000000000000000000000000000000000000000000000000001 \
  LOCAL_RELAY_ONLY=true NIP46_RELAY_URL=ws://localhost:10548 \
  bun --hot src/index.tsx --host 0.0.0.0 &
echo $! > /tmp/mint-test-dev.pid
```

## Step 6: Manual validation

Follow `docs/manual-happy-path-validation.md` — 8 test scenarios covering:
1. Mint initialization
2. Remove a mint
3. Cannot remove last mint
4. Re-add via suggestion
5. Add custom mint via text input
6. Empty input doesn't add
7. Re-add removed mint via text input
8. Full form submission

Login: `nsec18cmyxjcca6y8s3yhegt7nmrcxw9pn4ugnqe68jfc8km3sr2c5d2srsltll`

## Cleanup

```bash
kill $(cat /tmp/mint-test-dev.pid 2>/dev/null) 2>/dev/null
kill $(cat /tmp/mint-test-relay.pid 2>/dev/null) 2>/dev/null
rm -f /tmp/mint-test-dev.pid /tmp/mint-test-relay.pid /tmp/mint-test-dev.log
```
