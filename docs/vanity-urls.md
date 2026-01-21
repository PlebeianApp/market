# Vanity URL Feature

This feature allows users to register custom vanity URLs for their profile/shop pages.

## Overview

Vanity URLs provide users with memorable, shareable links like `/alice-store` that display their profile page directly. URLs are time-limited subscriptions purchased via Bitcoin Lightning zaps.

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
- **Route** (`src/routes/$vanityName.tsx`) - Mirror route that renders profile directly
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

| Duration   | Amount      | Validity   |
| ---------- | ----------- | ---------- |
| Dev (test) | 10 sats     | 90 seconds |
| 6 Months   | 10,000 sats | 180 days   |
| 1 Year     | 18,000 sats | 365 days   |

> Note: Dev tier only available in development mode (`NODE_ENV=development`)

## Reserved Names

The following patterns are reserved and cannot be registered:

- Route conflicts: `admin`, `api`, `dashboard`, `profile`, `checkout`, etc.
- System names: `app`, `static`, `assets`, `public`, etc.
- Common abuse targets: `login`, `register`, `account`, etc.

See full list in `src/server/VanityManager.ts` and `src/lib/stores/vanity.ts`.

## Registration Flow

1. User chooses vanity name in dashboard
2. User clicks on a pricing tier
3. Dashboard creates zap request with `["L", "vanity-register"]` label and `["vanity", "name"]` tag
4. Dashboard calls `/api/vanity/invoice` endpoint to generate Lightning invoice
5. User pays invoice via Lightning
6. LNSP publishes zap receipt (kind 9735) to ZAP_RELAYS
7. Server processes zap receipt, validates, calculates validity
8. Server publishes updated vanity registry (kind 30000)
9. Frontend syncs and vanity URL becomes active

## Resolution Flow

1. User navigates to `/{vanityName}`
2. `$vanityName.tsx` route resolves via `vanityActions.resolveVanity()`
3. If found and valid → renders profile page directly (mirror route)
4. If not found/expired → shows 404 page with option to return home

## Security

### Zap Receipt Verification

The backend validates zap receipts to ensure authenticity:

1. **Zap Request Parsing** - Extracts embedded zap request from `description` tag
2. **Label Verification** - Confirms `["L", "vanity-register"]` tag is present
3. **Vanity Name Match** - Validates `["vanity", "<name>"]` tag matches request
4. **Target Verification** - Confirms zap is sent to the app's pubkey via `["p", "<app_pubkey>"]`
5. **Amount Validation** - Verifies zap amount meets minimum pricing tier requirements
6. **Requester Identity** - Only the pubkey that created the zap request is registered

### Duplicate Receipt Prevention

Multiple layers prevent zap receipts from being processed more than once:

1. **In-Memory Deduplication** - `processedZapReceipts` Set tracks event IDs already handled
2. **Age Filter** - Receipts older than 5 minutes are rejected (prevents replay on server restart)
3. **Event Handler Deduplication** - EventHandler maintains `handledZapReceiptIds` Set

### Relay Security

- Backend subscribes to both app relay and dedicated ZAP_RELAYS
- ZAP_RELAYS subscription includes common Lightning Service Provider relays (coinos.io, primal.net, etc.)
- Connection timeout (15s) ensures partial failures don't block startup

## API Endpoints

### POST `/api/vanity/invoice`

Generates a Lightning invoice for vanity URL registration. Used by the dashboard to avoid browser CORS issues with LNURL resolution.

**Request:**
```json
{
	"zapRequest": "<signed kind 9734 event JSON>",
	"amountSats": 10000
}
```

**Response:**
```json
{
	"pr": "lnbc..."
}
```
