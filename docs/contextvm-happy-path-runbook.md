# ContextVM BTC pricing happy-path runbook

This runbook starts from a clean local state and walks through the manual end-to-end validation for the ContextVM BTC pricing fallback branch.

## Goal

Verify all of the following on a fresh local run:

1. The relay starts.
2. The ContextVM currency server starts.
3. The BTC pricing tool fetches a fresh result.
4. A second fetch hits the cache.
5. The frontend shows fiat pricing.
6. The frontend falls back to Yadio when the currency server is stopped.

## Files and components involved

- `contextvm/currency-server.ts`
- `contextvm/schemas.ts`
- `contextvm/tools/price-sources.ts`
- `contextvm/tools/rates-cache.ts`
- `src/queries/external.tsx`
- `src/lib/ctxcn-client.ts`
- `src/lib/constants.ts`
- `scripts/fetch-btc-price.ts`
- `.env.local.example`
- `Makefile`

## Clean start checklist

- [ ] Stop any running currency server
- [ ] Stop any running app/dev server
- [ ] Start the relay
- [ ] Clear the currency cache files
- [ ] Create or refresh `.env.local`
- [ ] Start the currency server
- [ ] Run the BTC price fetch twice
- [ ] Start the app
- [ ] Open the product page and verify fiat pricing
- [ ] Stop the currency server and confirm Yadio fallback in the browser network panel

## Step 1: start the relay

In Terminal A:

```bash
bun install
nak serve --hostname 0.0.0.0
```

Expected:

- relay listens on `ws://localhost:10547`
- the currency server and client can connect to it

## Step 2: clear the currency cache

In another terminal, while the currency server is stopped:

```bash
rm -f contextvm/data/rates-cache.sqlite contextvm/data/rates-cache.sqlite-wal contextvm/data/rates-cache.sqlite-shm
```

Expected:

- no currency cache files remain in `contextvm/data/`

## Step 3: create local env config

Use `.env.local.example` as the template.

If you need to regenerate fresh keys, run:

```bash
APP_PRIVATE_KEY="$(nak key generate)"
CVM_SERVER_KEY="$(nak key generate)"
CURRENCY_SERVER_PUBKEY="$(nak key public "$CVM_SERVER_KEY")"
```

Then write them into `.env.local` with:

```bash
cat > .env.local <<EOF
NODE_ENV=development
APP_RELAY_URL=ws://localhost:10547
LOCAL_RELAY_ONLY=true
APP_PRIVATE_KEY=${APP_PRIVATE_KEY}
CVM_SERVER_KEY=${CVM_SERVER_KEY}
CURRENCY_SERVER_PUBKEY=${CURRENCY_SERVER_PUBKEY}
EOF
```

Or just copy the template and fill in values manually.

Expected:

- `.env.local` exists locally
- it is ignored by git
- it contains valid 64-character hex keys or valid `nsec...` values if your setup supports them
- `CURRENCY_SERVER_PUBKEY` matches the public key derived from `CVM_SERVER_KEY`

## Step 4: initialize the app data

In Terminal B:

```bash
export APP_PRIVATE_KEY="$(nak key generate)"
export APP_RELAY_URL=ws://localhost:10547
bun run startup
bun run seed
```

Expected:

- startup connects to the relay
- seed publishes the app fixtures
- warnings about `localStorage` or NDK timestamps may appear, but the commands should finish successfully

If `bun run startup` fails with `Invalid private key provided`, the key is not valid.

## Step 5: start the currency server

In Terminal C:

```bash
NODE_ENV=development APP_RELAY_URL=ws://localhost:10547 bun run dev:currency-server
```

Expected startup output includes:

- `Plebeian Currency ContextVM Server`
- `Cache TTL: 60s`
- `Cache path: ./contextvm/data/rates-cache.sqlite`
- `Server is running and listening for requests on Nostr...`

## Step 6: verify BTC pricing twice

In Terminal D:

```bash
bun run scripts/fetch-btc-price.ts ws://localhost:10547
bun run scripts/fetch-btc-price.ts ws://localhost:10547
```

Expected on a clean start:

- first call: `Cached: false`
- second call: `Cached: true`
- both calls report the same `Fetched at` timestamp if the second call is within the TTL window
- sources should include `yadio`, `coindesk`, `binance`, and `coingecko`

If both calls say `Cached: true`, the cache was already populated earlier.

If the call times out, the currency server is not yet running or not yet fully initialized.

If the server is running but the call still times out, check that `CURRENCY_SERVER_PUBKEY` matches the actual public key printed by the currency server.

## Evidence captured in this session

Commands run:

```bash
bun install
nak serve --hostname 0.0.0.0
bun run startup
bun run seed
NODE_ENV=development APP_RELAY_URL=ws://localhost:10547 bun run dev:currency-server
bun run scripts/fetch-btc-price.ts ws://localhost:10547
bun run scripts/fetch-btc-price.ts ws://localhost:10547
bun run dev
curl http://localhost:3000/
curl http://localhost:3000/products
```

Observed key outputs:

- relay: `> relay running at ws://0.0.0.0:10547`
- currency server: `Public key: a05dbd1d81b2f7d1acf6b484fd99a63da09995d6dc4db2f05d9497ecd17b5f09`
- currency server: `Server is running and listening for requests on Nostr...`
- startup: `Initialization complete!`
- seed: `Seeding complete!`
- dev server: `🚀 Server running at http://localhost:3000/`
- `curl /`: `HTTP/1.1 200 OK`
- `curl /products`: `HTTP/1.1 200 OK`
- browser console: `ContextVM BTC fetch starting (timeout 10000ms)`
- browser console: `ContextVM response subscription active`
- browser console: `ContextVM request queued`
- browser console: `ContextVM request published`
- browser console: `ContextVM candidate response event`
- browser console: `ContextVM response received`
- browser console: `ContextVM BTC fetch succeeded in 1677ms`
- fallback verification: `Falling back to Yadio BTC rates` when the currency server is stopped
- first fetch: `Cached:            false`
- first fetch: `Fetched at:        2026-04-11T23:16:33.665Z`
- second fetch: `Cached:            true`
- second fetch: `Fetched at:        2026-04-11T23:16:33.665Z`
- both fetches: `Sources succeeded: yadio, coindesk, binance, coingecko`
- both fetches: `Sources failed:    none`

## Step 7: start the frontend

In a terminal with `APP_PRIVATE_KEY` exported:

```bash
export APP_PRIVATE_KEY="$(nak key generate)"
export APP_RELAY_URL=ws://localhost:10547
bun run startup
bun run dev
```

Expected:

- the dev app starts successfully
- you can open `http://localhost:3000`

## Step 8: manual browser verification

Open:

```text
http://localhost:3000/products
```

Then verify:

1. Product cards load.
2. Each card shows sats and fiat pricing.
3. Open the currency dropdown.
4. Select `EUR`.
5. Confirm the dropdown shows `EUR`.
6. Confirm fiat prices update to `EUR`.
7. Open the first product.
8. Confirm the detail page still shows sats and fiat pricing.

## Step 9: verify fallback behavior

With the app still running:

1. Stop the currency server.
2. Refresh the browser on the product page.
3. Open DevTools Network.
4. Confirm the app requests `https://api.yadio.io/exrates/BTC` when ContextVM is unavailable.

Expected:

- ContextVM is used first when available
- Yadio is used as the fallback when the server is stopped or times out
- console shows `Falling back to Yadio BTC rates` when the currency server is stopped

## Known harmless warnings

These warnings were observed during manual runs and are not necessarily failures:

- `localStorage is not defined` from some query modules when `bun run startup` runs in Bun/Node context
- NDK warnings about old timestamps for replaceable events during `bun run seed`

## Success criteria

This run is successful if all of the following are true:

- the relay starts
- the currency server starts
- the first `fetch-btc-price` call is uncached
- the second `fetch-btc-price` call is cached
- the product page shows fiat pricing
- EUR switching works
- the browser falls back to Yadio when the currency server is stopped

## Troubleshooting

### `Invalid private key provided`

The private key is missing or invalid.

Fix:

- regenerate with `nak key generate`
- ensure the value is exactly 64 hex characters or the supported `nsec...` format

### `Request timed out`

The currency server is not running yet, it has not finished initializing, or the client is pointed at the wrong server pubkey.

Fix:

- confirm `bun run dev:currency-server` is still running
- wait until it prints `Server is running and listening for requests on Nostr...`
- confirm `CURRENCY_SERVER_PUBKEY` matches the public key printed by the server

### First fetch is already cached

That means the cache was already populated before the test.

Fix:

```bash
rm -f contextvm/data/rates-cache.sqlite contextvm/data/rates-cache.sqlite-wal contextvm/data/rates-cache.sqlite-shm
```

Then retry the fetch sequence.

### Client times out even though the server is up

The fetch script or browser bundle is probably pointed at the wrong server pubkey.

Fix:

- use the pubkey printed by the server
- or set `CURRENCY_SERVER_PUBKEY` in `.env.local` to the derived public key for `CVM_SERVER_KEY`
- hard refresh the browser so the updated config is loaded

## Notes

- `.env.local` is ignored by git and should stay local.
- Keep test selection outside reusable Playwright scripts when possible; use the Makefile or CLI filters for narrower runs.
- This runbook is for manual local validation only; CI may exercise a different path.
