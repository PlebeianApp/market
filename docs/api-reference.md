# API Endpoint Reference

This document describes every HTTP and WebSocket endpoint exposed by the Plebeian Market
Bun server. The server entry point is [`src/index.tsx`](../src/index.tsx); routes are
declared in a single `Bun.serve({ routes })` object. There is no router framework —
Bun's built-in pattern matching is used.

> **Conventions**
> - Base URL: the origin the server is deployed at (e.g. `http://localhost:3000` in
>   development). All examples use a relative path because the frontend is served from
>   the same origin.
> - JSON request bodies use `Content-Type: application/json`.
> - JSON error responses always have the shape `{ "error": "<message>" }`.

---

## Table of contents

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | `GET`  | [`/api/config`](#1-get-apiconfig) | App configuration for the frontend |
| 2 | `POST` | [`/api/zapPurchase`](#2-post-apizappurchase) | Generate a Lightning invoice for a purchasable (vanity URL, NIP-05, …) |
| 3 | `GET`  | [`/.well-known/nostr.json`](#3-get-well-knownnostrjson) | NIP-05 verification (Lightning address / Nostr identity) |
| 4 | `GET`  | [`/images/:file`](#4-get-imagesfile) | Static images from `public/images/` |
| 5 | `GET`  | [`/manifest.json`](#5-get-manifestjson) | PWA web app manifest |
| 6 | `GET`  | [`/sw.js`](#6-get-swjs) | Service worker |
| 7 | `GET`  | [`/favicon.ico`](#7-get-faviconico) | Favicon |
| 8 | `GET`  | [`/*`](#8-get--spa-catch-all) | SPA catch-all (serves the React app) |
| 9 | `WS`   | [`/` (WebSocket)](#9-websocket--nostr-relay) | Nostr relay — publish signed events |

---

## 1. `GET /api/config`

Returns the configuration the frontend bootstraps from on every page load. This is the
single most-called endpoint: the React app's `useConfigQuery()` (TanStack Query) fetches
it on mount and uses it to wire up NDK, NIP-46, the setup wizard, etc.

**Source:** `src/index.tsx` (route) · consumed by `src/queries/config.tsx` and
`src/frontend.tsx`.

### Authentication

None. This endpoint is intentionally public — the frontend needs it before the user has
a Nostr identity.

### Query parameters

None.

### Response — `200 OK`

```jsonc
{
  "appRelay": "wss://relay.example.com",
  "stage": "production",                       // "production" | "staging" | "development"
  "nip46Relay": "wss://relay.nsec.app",
  "appSettings": { /* AppSettings object, see below — null until setup is complete */ },
  "appPublicKey": "29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15",
  "cvmServerPubkey": "29bd64...c1064f15",
  "needsSetup": false,                          // true when appSettings is null
  "serverReady": true                           // false while the EventHandler is initializing
}
```

| Field | Type | Description |
|-------|------|-------------|
| `appRelay` | `string` | WebSocket URL of the app's Nostr relay (`APP_RELAY_URL` env). |
| `stage` | `"production" \| "staging" \| "development"` | Deployment stage. Derived from `APP_STAGE`, falling back to `NODE_ENV`. |
| `nip46Relay` | `string` | NIP-46 (Nostr Wallet Connect / bunker) relay. Defaults to `wss://relay.nsec.app`. |
| `appSettings` | [`AppSettings`](#appsettings-object) \| `null` | App metadata loaded from the kind-31990 setup event at startup. `null` until first-run setup is complete. |
| `appPublicKey` | `string` | Hex pubkey derived from `APP_PRIVATE_KEY`. `null` until the server initializes. |
| `cvmServerPubkey` | `string` | ContextVM server pubkey, from `CVM_SERVER_PUBKEY`, derived from `CVM_SERVER_KEY`, or a built-in default. |
| `needsSetup` | `boolean` | Convenience flag: `true` exactly when `appSettings` is `null`. Drives the setup wizard in the UI. |
| `serverReady` | `boolean` | Whether the `EventHandler` is ready to accept published events over WebSocket. |

#### `AppSettings` object

Defined by `AppSettingsSchema` in `src/lib/schemas/app.ts`:

```jsonc
{
  "name": "market",                       // required, string
  "displayName": "Plebeian Market",       // required, string
  "picture": "https://…/logo.png",        // required, URL
  "banner": "https://…/banner.jpg",       // required, URL
  "ownerPk": "<hex pubkey>",              // required, the app owner's pubkey
  "allowRegister": true,                  // required, whether new accounts may register
  "defaultCurrency": "EUR",               // required, ISO currency code
  "contactEmail": "hello@example.com",    // optional, string
  "blossom_server": "https://…",          // optional, URL
  "nip96_server": "https://…",            // optional, URL
  "showNostrLink": false                  // optional, defaults to false
}
```

### Example

```bash
curl https://market.example.com/api/config
```

```js
// Frontend usage (src/queries/config.tsx)
const response = await fetch('/api/config')
if (!response.ok) throw new Error(`Failed to fetch config: ${response.status}`)
const config = await response.json()
```

### Notes

- `appSettings` is cached in memory at startup and refreshed whenever a new
  kind-31990 event is published over the WebSocket (see
  [endpoint 9](#9-websocket--nostr-relay)). A page refresh is not required to pick up
  setup changes.
- The frontend re-fetches on window focus when `needsSetup` is true, then caches with
  `staleTime: Infinity` once setup is complete.

---

## 2. `POST /api/zapPurchase`

Generic Lightning invoice endpoint for any "purchasable" — a vanity URL, a NIP-05
username, or a future badge/domain. It auto-resolves the correct purchase manager from
the `L` (label) tag on the supplied zap request, validates the request, and returns a
BOLT11 invoice. When the invoice is paid, the corresponding zap receipt (kind 9735) is
detected by the server and the registry is updated (see
[`docs/zap-purchase-manager.md`](zap-purchase-manager.md) for the full lifecycle).

**Source:** `src/index.tsx` (route) · delegates to
[`ZapPurchaseManager.generateInvoice`](../src/server/ZapPurchaseManager.ts) via
[`EventHandler.getPurchaseManager`](../src/server/EventHandler.ts).

### Authentication

No bearer token. Instead, the request embeds a **signed Nostr zap request**
(kind 9734) whose signature (`zapRequest.sig`) is verified by the purchase manager.
The zap request must target the app's pubkey (`["p", appPublicKey]`).

### Request body

```ts
interface ZapPurchaseInvoiceRequestBody {
  amountSats: number          // price in sats; must be > 0
  registryKey: string         // the thing being bought, e.g. "alice" (lowercased)
  zapRequest: {               // a signed Nostr kind-9734 zap request (raw event)
    pubkey: string
    sig: string               // required — request is rejected if unsigned
    created_at?: number
    kind?: number
    content?: string
    tags: string[][]          // must include ["L", <label>] and ["p", <appPubkey>]
  }
}
```

The `zapRequest.tags` MUST contain:

- `["L", <zapLabel>]` — selects the purchase manager. **Supported labels:**
  - `"vanity-register"` — buys a vanity URL. Registry key tag: `["vanity", "<name>"]`.
  - `"nip05-register"` — buys a NIP-05 username. Registry key tag: `["nip05", "<username>"]`.
- `["p", <appPublicKey>]` — the payment recipient (the app's pubkey, from `/api/config`).
- `["amount", <amountSats * 1000>]` — the amount in **millisatoshis**, matching
  `amountSats`.
- The registry tag (`vanity` / `nip05`) whose value equals `registryKey`.

`registryKey` must match the registry tag extracted from `zapRequest`.

### Validation performed (non-exhaustive)

- Body is valid JSON, else `400 Invalid JSON body`.
- `zapRequest` has an `L` tag, else `400 zapRequest missing L tag`.
- The `L` label maps to a registered manager, else `400 Unknown purchase type: <label>`.
- `amountSats` is a positive number, `registryKey` present, `zapRequest` signed.
- The `L` tag, `p` tag, registry tag, and `amount` tag all match what's declared.
- Domain-specific rules (per manager): valid/reserved name, name not already taken.

### Response — `200 OK`

```json
{
  "pr": "lnbc10000n1pj4...<full BOLT11 invoice string>"
}
```

`pr` is the BOLT11 payment request the client hands to a Lightning wallet.

### Error responses

All errors are JSON: `{ "error": "<message>" }`.

| Status | When |
|--------|------|
| `400` | Malformed JSON, missing `L` tag, unknown purchase type, unsigned zap request, mismatched amount/keys, invalid or taken name, amount outside LNURL min/max. |
| `500` | Unexpected server-side failure (e.g. app pubkey not initialized). |
| `502` | Upstream LNURL-pay provider failure (couldn't fetch pay data or the invoice). |

### Example — vanity URL purchase

This mirrors `src/lib/zapPurchase.ts`. The zap request is built and signed client-side
with NDK before posting.

```js
import NDK from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'

const zapRequest = new NDKEvent(ndk)
zapRequest.kind = 9734
zapRequest.content = ''
zapRequest.tags = [
  ['p', appPublicKey],                       // from /api/config
  ['amount', (10000 * 1000).toString()],     // millisats
  ['L', 'vanity-register'],                  // select the VanityManager
  ['vanity', 'alice'],                       // registry key (what you're buying)
  ['relays', appRelay, 'wss://relay.damus.io', /* …more ZAP_RELAYS */],
]
await zapRequest.sign()                      // creates zapRequest.sig

const res = await fetch('/api/zapPurchase', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amountSats: 10000,
    registryKey: 'alice',
    zapRequest: zapRequest.rawEvent(),
  }),
})

if (!res.ok) {
  const { error } = await res.json()
  throw new Error(error || `Failed to create invoice (${res.status})`)
}

const { pr } = await res.json()              // hand `pr` to a Lightning wallet
```

### Example — raw `curl` (zap request omitted for brevity)

```bash
curl -X POST https://market.example.com/api/zapPurchase \
  -H 'Content-Type: application/json' \
  -d '{
        "amountSats": 10000,
        "registryKey": "alice",
        "zapRequest": { "pubkey": "…", "sig": "…", "kind": 9734,
                        "tags": [["p","<appPubkey>"],["amount","10000000"],
                                  ["L","vanity-register"],["vanity","alice"]] }
      }'
```

### Supported purchase types & pricing

Pricing tiers are defined per manager. In production both vanity URLs and NIP-05
usernames use:

| Tier | Price | Validity |
|------|-------|----------|
| 6 months | 10 000 sats | 180 days |
| 1 year | 18 000 sats | 365 days |

In development an additional 10-sats / 90-second tier is available for testing.
See `src/server/VanityManager.ts` (`VANITY_PRICING`) and
`src/server/Nip05Manager.ts` (`NIP05_PRICING`) for the source of truth.

---

## 3. `GET /.well-known/nostr.json`

NIP-05 verification endpoint. Returns the mapping of usernames → hex pubkeys that Nostr
clients query to verify a `user@domain` Lightning address / Nostr identity. The mapping
is built from active (non-expired) NIP-05 registrations purchased via
[`/api/zapPurchase`](#2-post-apizappurchase).

**Source:** `src/index.tsx` (route) · served by
[`Nip05ManagerImpl.buildNostrJson`](../src/server/Nip05Manager.ts).

### Authentication

None. Per NIP-05 this endpoint must be publicly reachable and CORS-enabled.

### Query parameters

| Name | Required | Description |
|------|----------|-------------|
| `name` | no | A specific username. If omitted, **all** active registrations are returned. |

### Response — `200 OK`

```jsonc
{
  "names": {
    "alice": "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
    "bob":   "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fa79_60"
  }
}
```

Only **active** (non-expired) entries are included. An unknown `name` simply yields an
empty `names` object (still `200`).

### Headers

- `Access-Control-Allow-Origin: *` — required by NIP-05 so any Nostr client can call it.
- `Cache-Control: max-age=300` — 5-minute client cache.

### Examples

```bash
# Specific user
curl 'https://market.example.com/.well-known/nostr.json?name=alice'

# All active users
curl 'https://market.example.com/.well-known/nostr.json'
```

---

## 4. `GET /images/:file`

Serves a static asset from the `public/images/` directory. Used for product pictures,
avatars, and other user-content images stored on disk.

**Source:** `src/index.tsx` → `serveStatic('images/<file>')`.

### Authentication

None.

### Path parameters

| Name | Description |
|------|-------------|
| `file` | Filename within `public/images/`. |

### Response

- `200 OK` — the file with an appropriate `Content-Type`
  (`image/svg+xml`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`, etc.).
- `404 Not Found` — plain text, when the file does not exist.
- `500 Internal Server Error` — plain text, on an unexpected I/O error.

### Example

```bash
curl https://market.example.com/images/product-42.png --output product-42.png
```

---

## 5. `GET /manifest.json`

Serves the PWA web app manifest from `public/manifest.json`.

**Source:** `src/index.tsx`.

### Authentication

None.

### Response

- `200 OK` — `application/json` manifest.
- `404 Not Found` — if `public/manifest.json` is absent.

```bash
curl https://market.example.com/manifest.json
```

---

## 6. `GET /sw.js`

Serves the service worker script from `public/sw.js`.

**Source:** `src/index.tsx`.

### Authentication

None.

### Response

- `200 OK` — `application/javascript`.
- `404 Not Found` — if `public/sw.js` is absent.

---

## 7. `GET /favicon.ico`

Serves the site favicon from `public/favicon.ico`.

**Source:** `src/index.tsx`.

### Authentication

None.

### Response

- `200 OK` — `image/x-icon`.
- `404 Not Found` — if `public/favicon.ico` is absent.

---

## 8. `GET /*` (SPA catch-all)

Serves the compiled React single-page app (`src/index.html`) for any path not matched by
a more specific route. Client-side routing handles deep links.

**Source:** `src/index.tsx` (`'/*': index`).

### Authentication

None.

### Response

`200 OK` with the HTML document. This is what browsers receive for routes like `/`,
`/products/123`, `/profile`, etc.

---

## 9. WebSocket `/` (Nostr relay)

The server upgrades any WebSocket connection at `/` into a lightweight write relay.
Clients send signed Nostr events; the server validates, re-signs them with the app key
if the submitter is an authorized admin/editor, publishes them to the app relay, and
acknowledges with Nostr `OK` messages.

**Source:** `src/index.tsx` (`server.upgrade(req)` + `websocket.message`).

> This is **not** a full NIP-01 relay (no `REQ` subscription support). It is an
> authenticated publish gateway that re-signs events before relaying them.

### Connecting

```js
const ws = new WebSocket('wss://market.example.com/')
ws.onopen = () => {
  ws.send(JSON.stringify(['EVENT', signedEvent]))
}
ws.onmessage = (msg) => {
  const [type, eventId, accepted, message] = JSON.parse(msg.data)
  // type === 'OK'; accepted === true/false
}
```

### Messages — client → server

#### `["EVENT", <Nostr event>]`

Publish a signed event. The event MUST have a valid signature
(`verifyEvent` from `nostr-tools`). The `EventHandler` then checks whether the
submitter is authorized (admin/editor, or bootstrap-mode) and, if so, re-signs it with
the app key and publishes to `APP_RELAY_URL`.

### Messages — server → client

#### `["OK", <eventId>, true, ""]`

The event was accepted, re-signed, and published to the relay.

#### `["OK", <eventId>, false, "error: <reason>"]`

The event was rejected. Common reasons:

| Reason | Cause |
|--------|-------|
| `error: Server initializing, please try again` | The `EventHandler` is not ready yet (retry shortly). |
| `error: Unable to verify event signature` | `verifyEvent` returned false. |
| `error: Handler error: <detail>` | The event handler threw while processing. |
| `Not authorized` | The submitter is not an admin/editor (or bootstrap mode is off). |
| `error: Invalid message format <detail>` | The message could not be parsed as a `["EVENT", …]` frame. |

#### `["NOTICE", "error: Invalid JSON"]`

Sent when the raw message is not valid JSON and no event id could be recovered.

### Special behaviour

When a published event is a **kind 31990** (app settings) event, the server updates its
in-memory `appSettings` cache, so subsequent `GET /api/config` calls reflect the new
settings without a restart. Other special kinds handled internally include admin lists
(`d = admins`), editor lists (`d = editors`), blacklists (kind 10000), and purchase
registries (`vanity-urls`, `nip05-names`).

---

## Environment variables

The endpoints above depend on these environment variables (see `src/index.tsx`):

| Variable | Used by | Description |
|----------|---------|-------------|
| `APP_RELAY_URL` | config, WS, zap | **Required.** The app's Nostr relay. |
| `APP_PRIVATE_KEY` | config, WS, zap | **Required.** Hex private key for the app identity; derives `appPublicKey`. |
| `NIP46_RELAY_URL` | config | NIP-46 relay; defaults to `wss://relay.nsec.app`. |
| `PORT` | server | Listen port; defaults to `3000`. |
| `APP_STAGE` / `NODE_ENV` | config | Determine the `stage` field. |
| `APP_LIGHTNING_ADDRESS` / `APP_LUD16` / `APP_LN_ADDRESS` / `APP_LIGHTNING_IDENTIFIER` | zap | Override the app's Lightning address used for invoice generation. Falls back to the app profile's `lud16`/`lud06`. |
| `CVM_SERVER_PUBKEY` / `CVM_SERVER_KEY` | config | ContextVM server identity; falls back to a built-in default pubkey. |

---

## Related documentation

- [`docs/zap-purchase-manager.md`](zap-purchase-manager.md) — deep dive on the
  `ZapPurchaseManager` base class and the zap-receipt → registry lifecycle.
- [`docs/vanity-urls.md`](vanity-urls.md) — vanity URL feature design.
- [`docs/lightning-payment-flow.md`](lightning-payment-flow.md) — end-to-end payment
  flow including LNURL-pay resolution.
- [`docs/relay-configuration.md`](relay-configuration.md) — relay setup.
