# Pull Request Draft

## Summary

This branch implements a BTC pricing fallback architecture based on a dedicated ContextVM currency server, with aggregation and caching to reduce dependency on a single external API.

### Relevant changes to include

- Added a new **ContextVM currency server** that exposes:
  - `get_btc_price`
  - `get_btc_price_single`
    (`contextvm/currency-server.ts`, `contextvm/schemas.ts`)
- Implemented **multi-source BTC rate aggregation** with median calculation across Yadio, CoinDesk, Binance, and CoinGecko (`contextvm/tools/price-sources.ts`).
- Added a **SQLite-backed cache** with TTL for server-side rate reuse (`contextvm/tools/rates-cache.ts`).
- Updated frontend currency fetching to:
  - try ContextVM first
  - fall back to Yadio if ContextVM fails/times out
    (`src/queries/external.tsx`)
- Added a **browser-safe ContextVM client** using `nostr-tools` directly (replacing browser-problematic SDK usage in client code) (`src/lib/contextvm-client.ts`).
- Added currency server relay/pubkey constants and env-aware relay selection (`src/lib/constants.ts`).
- Added supporting scripts/deps:
  - `dev:currency-server`, unit/integration test scripts
  - `@contextvm/sdk`, `@modelcontextprotocol/sdk`
    (`package.json`, `bun.lock`)
- Added broad test coverage for:
  - aggregation/caching/schemas/server behavior
  - frontend query fallback behavior
  - ContextVM client behavior
  - E2E BTC price/UI flows
    (`contextvm/**/__tests__`, `src/**/__tests__`, `e2e-new/tests/*.spec.ts`)

## Scope Notes

- Previously identified unrelated/deployment-only changes were removed from this branch before preparing the PR.
- `.env.example` (`CURRENCY_SERVER_KEY`) and `.gitignore` (`contextvm/data/`) remain included as intentional feature support changes.

## Manual Happy-Path Test Plan (Local)

### Objective

Validate the new BTC price ContextVM path works end-to-end with cache behavior and UI integration.

### Environment

- Local relay: `ws://localhost:10547`
- App: `http://localhost:3000`
- Currency server: `contextvm/currency-server.ts`

### Commands Used

```bash
# Terminal A - local relay
bun install
nak serve --hostname 0.0.0.0

# Terminal B - app data initialization (needed in this shell so APP_PRIVATE_KEY is valid)
export APP_PRIVATE_KEY="$(nak key generate)"
bun run startup
bun run seed

# Terminal C - currency server
NODE_ENV=development APP_RELAY_URL=ws://localhost:10547 bun run dev:currency-server

# Terminal B (or D) - quick server verification
bun run scripts/fetch-btc-price.ts ws://localhost:10547
bun run scripts/fetch-btc-price.ts ws://localhost:10547

# Terminal D - frontend app (generate/export APP_PRIVATE_KEY in this same terminal before running dev)
export APP_PRIVATE_KEY="$(nak key generate)"
bun run startup
bun run dev
```

### Manual Execution Notes (Observed)

- Use `nak serve --hostname 0.0.0.0` (the incorrect form `nak --serve ...` fails because `serve` is a subcommand, not a global flag).
- `bun run startup` can print `localStorage is not defined` warnings from `src/queries/products.tsx` and `src/queries/shipping.tsx` when run in Bun/Node context.
- `bun run seed` can print NDK `AI_GUARDRAILS` warnings about old timestamps for replaceable NIP-15 events.
- These warnings are from upstream behavior already present on `master` (not introduced by this ContextVM BTC pricing PR).
- `bun run dev` requires a valid `APP_PRIVATE_KEY`; generate/export it in the same terminal session that launches dev.
- Despite those warnings, `startup` completed successfully in manual execution and the ContextVM happy-path test can continue.

### Manual Browser Steps

1. Open `http://localhost:3000/products`.
2. Wait for product cards to load.
3. Confirm cards show sats and fiat pricing.
4. Click the currency dropdown.
5. Select `EUR`.
6. Confirm the dropdown displays `EUR`.
7. Confirm product fiat price updates to `EUR`.
8. Click the first product card.
9. Confirm product detail page still shows sats and fiat pricing.

### Expected Results

- Currency server starts and accepts `get_btc_price` calls.
- First CLI fetch reports non-cached data; second fetch reports cached data (within TTL window).
- Product list and product detail pages render fiat prices correctly.
- Currency switch updates displayed fiat denomination to EUR.

### Manual Validation Results (Observed)

- Verified that fiat conversion values are numerically correct in the UI (including a test product priced at `21 USD`).
- Verified ContextVM/MCP path vs fallback behavior using browser Network inspection:
  - With currency server running, pricing worked through the ContextVM path.
  - With currency server stopped, requests to `https://api.yadio.io/exrates/BTC` appeared, confirming fallback activation.
- This confirms intended behavior:
  - Primary pricing feed: ContextVM currency server (multi-source aggregation + cache)
  - Fallback pricing feed: Yadio when ContextVM is unavailable

### Relevant Test Commands (Pre-PR)

Run these before opening the PR:

```bash
# Core unit tests for pricing sources + cache + server
bun test contextvm/tools/__tests__/price-sources.test.ts
bun test contextvm/__tests__/currency-server.test.ts

# Broader ContextVM/unit suite
bun run test:unit

# ContextVM client integration test
bun run test:integration
```

### Manual Runtime Verification Commands

```bash
# Verify ContextVM pricing response and cache behavior (TTL = 60s)
bun run scripts/fetch-btc-price.ts ws://localhost:10547
bun run scripts/fetch-btc-price.ts ws://localhost:10547
```

Expected:

- First call: `Cached: false`
- Second call (within 60s): `Cached: true`
- `Sources succeeded` includes `yadio, coindesk, binance, coingecko`
- `Sources failed: none`

### Test Results (Latest Run)

- `bun test contextvm/tools/__tests__/price-sources.test.ts` passed (`29 pass, 0 fail`).
- `bun test contextvm/tools/__tests__/rates-cache.test.ts` passed (`8 pass, 0 fail`).
- `bun test contextvm/__tests__/currency-server.test.ts` passed (`7 pass, 0 fail`).
- `bun run test:unit` passed (`86 pass, 0 fail`).
- `bun run test:integration` passed (`5 pass, 0 fail`).
