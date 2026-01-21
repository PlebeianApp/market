# Vanity URL Feature

This feature allows users to register custom vanity URLs for their profile/shop pages.

## Overview

Vanity URLs provide users with memorable, shareable links like `/alice-store` that redirect to their profile page. URLs are time-limited subscriptions purchased via Bitcoin Lightning zaps.

## Architecture

### Backend (`src/server/`)

- **VanityManager.ts** - Manages the vanity URL registry
  - Handles kind `30000` events with `d=vanity-urls` tag
  - Processes zap receipts (kind `9735`) with `["L", "vanity-register"]` label
  - Validates reserved names and name format
  - Calculates validity period based on zap amount

### Frontend

- **Store** (`src/lib/stores/vanity.ts`) - Client-side state management
- **Queries** (`src/queries/vanity.tsx`) - NDK fetch with live subscription
- **Sync Hook** (`src/hooks/useVanitySync.ts`) - Syncs store with relay data
- **Route** (`src/routes/$vanityName.tsx`) - Root-level dynamic route
- **Dashboard** (`src/routes/_dashboard-layout/dashboard/account/vanity-url.tsx`) - Management UI

## Data Format

### Vanity Registry Event (Kind 30000)

```json
{
  "kind": 30000,
  "tags": [
    ["d", "vanity-urls"],
    ["vanity", "alice-store", "<pubkey>", "<validUntil>"]
  ],
  "content": ""
}
```

### Zap Request for Registration

```json
{
  "kind": 9734,
  "tags": [
    ["L", "vanity-register"],
    ["vanity", "alice-store"],
    ["p", "<app_pubkey>"],
    ["amount", "10000000"]
  ]
}
```

## Pricing

| Duration | Amount | Validity |
|----------|--------|----------|
| 6 Months | 10,000 sats | 180 days |
| 1 Year | 18,000 sats | 365 days |

## Reserved Names

The following patterns are reserved and cannot be registered:
- Route conflicts: `admin`, `api`, `dashboard`, `profile`, `checkout`, etc.
- System names: `app`, `static`, `assets`, `public`, etc.
- Common abuse targets: `login`, `register`, `account`, etc.

See full list in `src/server/VanityManager.ts` and `src/lib/stores/vanity.ts`.

## Registration Flow

1. User chooses vanity name in dashboard
2. User creates zap request with `["L", "vanity-register"]` label and `["vanity", "name"]` tag
3. User fetches invoice from app's Lightning address
4. User pays invoice
5. LNSP publishes zap receipt (kind 9735)
6. Server processes zap, validates, calculates validity
7. Server publishes updated vanity registry
8. Frontend syncs and vanity URL becomes active

## Resolution Flow

1. User navigates to `/{vanityName}`
2. `$vanityName.tsx` route checks `vanityStore.resolveVanity()`
3. If found and valid → redirect to `/profile/{pubkey}`
4. If not found/expired → show 404 page
