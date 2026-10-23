# Vanity URL Feature

This feature allows users to register custom vanity URLs for their profile/shop pages.

## Overview

Vanity URLs provide users with memorable, shareable links like `/alice-store` that display their profile page directly. URLs are time-limited subscriptions purchased via Bitcoin Lightning zaps.

## Unified storefront identity

New registrations use the unified storefront identity flow in the storefront
builder: one `storefront-register` zap and one `name` tag grant both
`/{name}` and `{name}@{configured-domain}` for the same pubkey and expiry.
The `vanity-urls` registry and this guide's `vanity-register` flow are legacy
read/compatibility paths only; new invoices under the old label are not
accepted. Existing legacy entries resolve until expiry and prevent a different
pubkey from claiming the same name in the unified registry. Pending legacy
invoices must be recreated through the unified storefront identity flow.

## Architecture

### Backend (`src/server/`)

- **VanityManager.ts** - Reads the legacy vanity URL registry during migration
  - Handles kind `30000` events with `d=vanity-urls` tag
- **StorefrontIdentityManager.ts** - Handles new unified identity purchases
  - One `storefront-register` zap writes a single `name` record
  - The record powers both `/{name}` and `{name}@{domain}`
  - Legacy vanity and NIP-05 registries remain read-only during migration

### Frontend

- **Store** (`src/lib/stores/vanity.ts`) - Client-side state management
- **Queries** (`src/queries/vanity.tsx`) - NDK fetch with live subscription
- **Sync Hook** (`src/hooks/useVanitySync.ts`) - Syncs store with relay data
- **Route** (`src/routes/$vanityName.tsx`) - Mirror route that renders profile directly
- **Dashboard** (`src/routes/_dashboard-layout/dashboard/account/vanity-url.tsx`) - Management UI

## Data Format

### Legacy Vanity Registry Event (Kind 30000)

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

### Unified Identity Zap Request

```json
{
	"kind": 9734,
	"tags": [
		["L", "storefront-register"],
		["name", "alice-store"],
		["tier", "6mo"],
		["count", "2"],
		["p", "<app_pubkey>"],
		["amount", "20000000"]
	]
}
```

## Pricing

| Duration   | Both identities | One matching legacy identity |
| ---------- | --------------- | ---------------------------- |
| Dev (test) | 20 sats         | 10 sats                      |
| 6 Months   | 20,000 sats     | 10,000 sats                  |
| 1 Year     | 36,000 sats     | 18,000 sats                  |

The single invoice price is the sum of the existing vanity and NIP-05 prices.
When the buyer already owns exactly one matching legacy entry, the invoice
covers the missing identity and the unified expiry is extended from the later
legacy expiry.

> Note: Dev tier only available in development mode (`NODE_ENV=development`)

## Reserved Names

The following patterns are reserved and cannot be registered:

- Route conflicts: `admin`, `api`, `dashboard`, `profile`, `checkout`, etc.
- System names: `app`, `static`, `assets`, `public`, etc.
- Common abuse targets: `login`, `register`, `account`, etc.

See full list in `src/server/VanityManager.ts` and `src/lib/stores/vanity.ts`.

## Legacy Registration Flow

The following flow documents old invoices and events. The dashboard redirects
legacy purchase-page bookmarks to the storefront builder, and the server no
longer creates invoices for `vanity-register`; use the unified `storefront-register`
flow described above for new identities.

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

### Zap Receipt Structure

A zap receipt (kind 9735) is published by the Lightning Service Provider (LNSP) after payment. It contains an embedded, **signed zap request** in the `description` tag that proves who initiated the payment.

**Example Zap Receipt (kind 9735):**

```json
{
	"id": "abc123...",
	"pubkey": "lnsp_pubkey...", // LNSP's pubkey (e.g., coinos.io)
	"kind": 9735,
	"created_at": 1705849200,
	"tags": [
		["p", "app_pubkey..."], // Recipient (app)
		["bolt11", "lnbc10u1pj..."], // Lightning invoice
		[
			"description",
			"{\"id\":\"def456...\",\"pubkey\":\"user_pubkey...\",\"kind\":9734,\"created_at\":1705849100,\"tags\":[[\"L\",\"vanity-register\"],[\"vanity\",\"alice-store\"],[\"p\",\"app_pubkey...\"],[\"amount\",\"10000000\"],[\"relays\",\"wss://relay.damus.io\"]],\"content\":\"\",\"sig\":\"user_signature...\"}"
		]
	],
	"content": "",
	"sig": "lnsp_signature..."
}
```

The `description` tag contains the **original zap request (kind 9734)** as a JSON string, signed by the user who initiated the payment.

### Step-by-Step Verification Process

#### Step 1: Parse Embedded Zap Request

```typescript
const zapRequestTag = event.tags.find((t) => t[0] === 'description')
const zapRequest = JSON.parse(zapRequestTag[1])
```

**Extracted zap request:**

```json
{
	"id": "def456...",
	"pubkey": "user_pubkey...", // ← This is who gets the vanity URL
	"kind": 9734,
	"tags": [
		["L", "vanity-register"], // Label identifying this as vanity registration
		["vanity", "alice-store"], // Requested vanity name
		["p", "app_pubkey..."], // Target app pubkey
		["amount", "10000000"] // Amount in millisats (10,000 sats)
	],
	"sig": "user_signature..." // User's cryptographic signature
}
```

#### Step 2: Verify Label Tag

Check for `["L", "vanity-register"]` tag to identify this as a vanity registration zap:

```typescript
const labelTag = zapRequest.tags.find((t) => t[0] === 'L' && t[1] === 'vanity-register')
if (!labelTag) return // Not a vanity registration
```

#### Step 3: Extract Vanity Name

```typescript
const vanityTag = zapRequest.tags.find((t) => t[0] === 'vanity')
const vanityName = vanityTag[1].toLowerCase() // "alice-store"
```

#### Step 4: Identity from Signature

**This is the key security property:** The `pubkey` field in the zap request is cryptographically signed. Only the holder of the corresponding private key could have created this signature. This proves that `user_pubkey...` authorized this registration.

```typescript
const requesterPubkey = zapRequest.pubkey // Verified by signature
```

#### Step 5: Amount Verification

Verify the payment meets minimum requirements:

```typescript
const amountTag = zapRequest.tags.find((t) => t[0] === 'amount')
const amountMsats = parseInt(amountTag[1]) // 10000000
const amountSats = Math.floor(amountMsats / 1000) // 10000

// Must meet tier requirements
if (amountSats >= 18000)
	validityDays = 365 // 1 year
else if (amountSats >= 10000)
	validityDays = 180 // 6 months
else return // Insufficient
```

### Why This Is Secure

1. **Cryptographic Proof of Identity**: The zap request is signed by the user's private key. No one can forge a request claiming to be someone else.

2. **LNSP as Witness**: The Lightning Service Provider only publishes a receipt after confirming actual payment. The receipt inherits the signed zap request.

3. **No Replay**:
   - Event IDs are tracked in `processedZapReceipts` Set
   - Receipts older than 5 minutes are rejected
   - Prevents re-registering from old payments

4. **Name Collision Protection**: Server checks if vanity name is already taken by a different pubkey with active validity.

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
