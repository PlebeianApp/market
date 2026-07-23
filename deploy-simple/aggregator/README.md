# Market Aggregator Relay

A caching aggregator relay that mirrors market-relevant events from upstream
Nostr relays into a single fast relay, eliminating the multi-second dead-relay
fan-out problem (#1046).

## Architecture

Two components:

1. **Khatru relay** (`khatru/`) — a single Go binary that serves a market-kind-gated
   relay with an integrated scraper goroutine. Uses native Go `RejectEvent` hooks
   for the write gate (no Python subprocess dependency). Built on
   [Khatru](https://github.com/fiatjaf/khatru) with SQLite storage and NIP-77
   negentropy sync support.

2. **Python scraper daemon** (`scraper.py`) — standalone scraper that actively
   pulls market events from the relay graph into the aggregator relay. Useful
   for operators who want a separate scraper process or are running a different
   relay backend.

### Why this design

Per @Franchovy's review on #1066: fold aggregation into the existing relay
infrastructure rather than deploying a separate strfry instance. The Khatru
approach runs on the existing `relay.plebeian.market` host — no new
infrastructure, no doubled relay load.

## App-side wiring

The market app reads from the aggregator relay first in production:

```typescript
// src/lib/constants.ts
export const MARKET_AGGREGATOR_RELAY = process.env.NEXT_PUBLIC_MARKET_AGG_RELAY ?? ''

// src/lib/stores/ndk.ts — prepended in production only
const primaryAgg = stage === 'production' && MARKET_AGGREGATOR_RELAY ? [MARKET_AGGREGATOR_RELAY] : []
const relays = mainRelay ? [...primaryAgg, mainRelay, ...DEFAULT_PUBLIC_RELAYS] : [...primaryAgg, ...DEFAULT_PUBLIC_RELAYS]
```

Dev/staging paths are unchanged.

## Deployment

### Khatru binary

```bash
cd deploy-simple/aggregator/khatru
make build  # produces market-agg-relay binary
SEED_NPUB=<root_npub> DB_PATH=./store.db LISTEN_ADDR=:3334 ./market-agg-relay
```

### Python scraper (optional, standalone)

```bash
cd deploy-simple/aggregator
pip install websocket-client
SEED_NPUB=<root_npub> RELAY_URL=ws://localhost:3334 python3 scraper.py
```

### Environment variable

Set `NEXT_PUBLIC_MARKET_AGG_RELAY` on the market app deployment:

```
NEXT_PUBLIC_MARKET_AGG_RELAY=wss://relay.plebeian.market
```

## Consolidated from

This PR consolidates three prior PRs into one:

- #1066 — app-side wiring (constants.ts + ndk.ts)
- #1091 — Khatru relay Go implementation (Option A, approved by @Franchovy)
- #1092 — Python scraper daemon + write-policy + tests (108 tests)

Refs #1046.
