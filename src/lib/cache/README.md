# Browser Relay — In-Browser Nostr Relay Cache

Implements issue [#1081](https://github.com/PlebeianApp/market/issues/1081):
**Every Plebeian instance runs its own relay.**

## What This Is

A real nostr relay (SQLite-backed) running inside a Web Worker in the user's
browser tab. Uses `@snort/worker-relay` for the relay implementation and
applesauce's native caching APIs for integration.

## Status: EXPERIMENTAL — NOT YET WIRED

This module is self-contained and ready for wiring, but **not yet connected**
to the app. It depends on the applesauce migration:

- **Wave 0 (#1075)** — strangler-fig I/O seam
- **Wave A1b (#1068)** — relay reads through applesauce adapter

Once those merge and the app has a real applesauce `EventStore`, wire in
the browser cache by calling `setupBrowserCache()` from `setup.ts`.

## Files

| File | Purpose |
|---|---|
| `browser-cache.ts` | Worker relay init, cache request/persist factories |
| `sync-manager.ts` | Background NIP-77 negentropy sync from upstream relays |
| `persist.ts` | Storage persistence (prevent browser eviction) |
| `setup.ts` | **Entry point** — wires everything into applesauce EventStore |
| `__tests__/browser-cache.test.ts` | Unit tests |

## How It Works

```
┌─────────────────────────────────────────────────────┐
│ Browser Tab                                         │
│                                                     │
│  applesauce           cacheRequest     ┌─────────┐  │
│  EventStore  ──────────────────────────▶│ Worker  │  │
│      │                                   │ Relay   │  │
│      │  persistEventsToCache             │ (SQLite)│  │
│      └──────────────────────────────────▶│ WASM    │  │
│                                          └────┬────┘  │
│                                               │       │
│  NegentropySyncManager                        │       │
│      │  relay.negentropy()                    │       │
│      ▼                                        ▼       │
│  Upstream Relays (market-agg, plebeian)               │
└─────────────────────────────────────────────────────┘
```

1. **Reads:** Applesauce loaders check the browser relay cache FIRST,
   before hitting network relays → instant reads.
2. **Writes:** Every event entering the EventStore is auto-persisted to
   the browser relay via `persistEventsToCache()`.
3. **Sync:** Background negentropy sync pulls marketplace events from
   the aggregator relay, keeping the cache fresh.

## Wiring (when ready)

```typescript
import { setupBrowserCache } from '@/lib/cache/setup'

// After creating applesauce EventStore + RelayPool:
await setupBrowserCache(eventStore, pool)
```
