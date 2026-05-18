# Workflow: Registration, Verification, Validation, and Purchase

The ZapPurchaseManager manages the whole workflow of buying Lightning-powered(zaps) "purchasables"(nip05 addresses, badges and vanity url) on Plebeian market.

It handled verification of tiers for the various "purchasables", checking their validity, creating their payment receipts, verifying the paid receipts and registering/publishing records for the "purchasable items".

The typical purchase for a zap purchase looks like this:

flowchart TD
A[User purchase action calls purchase helper] --> B[Builds & signs zap request (kind 9734)]
B --> C[POST to /api/zapPurchase]
C --> D[Server resolves the Manager]
D --> E[Server validates zap request]
E --> F[Server generates Lightning invoice]
F --> G[Invoice returned to client]
G --> H[Client pays invoice]
H --> I[Zap receipt (kind 9735) sent to relays]
I --> J[Server receives & deduplicates receipt]
J --> K[Server parses & validates zap receipt]
K --> L[Registry entry created/extended]
L --> M[Registry published to Nostr relays]
M --> N[Client can use purchased resource]

### 1. Registration (Invoice Request for the Purchasable item)

- The client initiates a purchase by calling a helper (e.g., `purchaseVanityForPubkey`).
- This builds and signs a Nostr zap request (kind 9734) with the correct tags and sends it to the server’s `/api/zapPurchase` endpoint.
- The server resolves the correct ZapPurchaseManager subclass by the zap label (L tag) i.e vanity-register for vanityurls, nip05 for nip05 addresses.

### 2. Verification (Invoice Generation)

- The server’s `generateInvoice()` method validates the zap request:
  - Checks the zap label, registry key, and amount.
  - Ensures the zap request is properly signed and targets the correct app pubkey.
  - Runs domain-specific validation (e.g., name not reserved, not already taken).
- If valid, the server proxies to the LNURL-pay endpoint to generate a BOLT11 Lightning invoice.
- The invoice is returned to the client.

### 3. Payment (Purchase)

- The client pays the Lightning invoice.
- The Lightning payment triggers a zap receipt (Nostr event kind 9735) sent to the server’s relays.

### 4. Validation (Zap Receipt Handling)

- The server receives the zap receipt and calls `handleZapReceipt()`:
  - Deduplicates and checks the receipt is recent.
  - Parses and verifies the zap request from the receipt’s description tag.
  - Checks the zap label, registry key, and amount match the original request.
  - Runs domain-specific validation again (e.g., name still available).
  - If valid, creates or extends the registry entry for the buyer’s pubkey.

### 5. Registry Update and Publication

- The updated registry is published as a signed Nostr event to relays.
- The client can now query or use the purchased resource (e.g., vanity URL, badge, NIP-05 name).

---

This workflow ensures that every purchase is cryptographically signed, validated, and published in a decentralized, auditable way using Nostr and Lightning.

# ZapPurchaseManager Documentation

## Overview

`ZapPurchaseManager` is an abstract base class for managing Lightning-powered purchases ("zap purchases") in the Plebeian Market backend. It handles payment validation, registry management, and publishing registry events to Nostr relays. Each purchase type (e.g., vanity URLs, NIP-05, badges) implements a domain-specific subclass.

An example implementation would be:

```typescript
// Abstract base for all zap purchases:
// - Subscribtion -> Payment Validation  -> Publishing the parameterized Nostr events

// Subclasses implement domain-specific logic:
// extract the registry and specific validation rules and serialization Nostr event tags

@example
// Create a supporter badge purchase manager
class BadgePurchaseManager extends ZapPurchaseManager<BadgeEntry> {
	constructor(eventSigner: EventSigner) {
		super(
			{
				zapLabel: 'badge-purchase',
				registryEventKind: 30000,
				registryDTag: 'supporter-badges',
				pricing: BADGE_PRICING,
			},
			eventSigner,
		)
	}

	protected extractRegistryKey(zapRequest: NostrEvent): string | null {
		return zapRequest.pubkey // Badge is keyed by pubkey
	}

	protected validateRegistration(key: string, pubkey: string): string | null {
		return null // No special validation needed
	}

	// ... other implementable abstract methods
}
```

## Key Concepts

- **Zap Purchase**: A purchase made via a Lightning Network payment (zap), tracked and validated using Nostr events.
- **Registry**: A mapping of purchased items (e.g., vanity names, badge tiers) to pubkeys and expiration times, published as a Nostr event.
- **Pricing Tiers**: Configurable price levels (in sats) and durations for each purchase type.

## Main Interfaces

- `PricingTier`: Defines a price and duration for a purchase option.
- `ZapPurchaseEntry`: Represents a single registry entry (pubkey + expiration).
- `ZapPurchaseConfig`: Configuration for a purchase manager (label, event kind, d-tag, pricing, etc).

```typescript
 // Configuration for a zap purchase manager instance.


 // Vanity URL purchase config
    {
        /** L tag to identifying this purchase type (like: "vanity-register") */
        zapLabel: 'vanity-register',
        /** Nostr event kind for the registry (e.g. 30000) */
        registryEventKind: 30000,
        /** d-tag value for the registry event (e.g. "vanity-urls") */
        registryDTag: 'vanity-urls',
        /** Available pricing tiers */
        pricing: {
            '6mo': { sats: 10000, days: 180, label: '6 Months' },
            '1yr': { sats: 18000, days: 365, label: '1 Year' },
        },
        /** Max age in seconds for processing zap receipts (default: 300) */
        maxReceiptAge?: number
    }
 */

```

- `ZapPurchaseInvoiceRequestBody`: Request body for generating a Lightning invoice.
- `ZapInvoiceResult`: Result of invoice generation (BOLT11 invoice string).

## Core Methods

- `handleRegistryEvent(event)`: Rebuilds the registry from a Nostr event.
- `handleZapReceipt(event)`: Validates and registers a zap purchase from a Lightning payment receipt (kind 9735 event).
- `generateInvoice(request, appPubkey, lightningIdentifier, toLnurlpEndpoint)`: Validates a zap request and generates a Lightning invoice via LNURL-pay.
- `publishRegistry()`: Publishes the current registry as a signed Nostr event to relays.
- `getAllEntries()`, `getEntry(key)`, `getEntryForPubkey(pubkey)`: Query registry state.

## Extending ZapPurchaseManager

To implement a new purchase type, extend `ZapPurchaseManager` and implement:

- `extractRegistryKey(zapRequest)`: Extracts the registry key from the zap request.
- `validateRegistration(key, pubkey)`: Domain-specific validation logic.
- `extractEntriesFromEvent(event)`: Parses registry entries from a Nostr event.
- `buildRegistryTags(entries)`: Serializes registry entries to Nostr event tags.
- `createEntry(key, pubkey, validUntil)`: Constructs a new registry entry.

Optional hooks:

- `onEntryRegistered(key, entry)`: Called after a new entry is registered.
- `onRegistryRebuilt()`: Called after the registry is rebuilt from an event.

## Invoice Generation Flow

1. Client requests an invoice via `/api/zapPurchase` with a signed zap request.
2. The server resolves the correct `ZapPurchaseManager` by label.
3. `generateInvoice()` validates the request and proxies to the LNURL-pay endpoint.

/\*\*
_ Validate a zap request and generate a Lightning invoice via LNURL-pay.
_
_ This runs server-side to avoid CORS issues when the browser needs to resolve
_ a Lightning address and obtain a BOLT11 invoice. It validates the zap request
_ against this manager's config (correct label, amount, registry key) and runs
_ domain-specific validation before proxying the LNURL-pay flow. \*
_ @param request - The invoice request containing amount, registry key, and signed zap request
_ @param appPubkey - The app's public key (zap request must target this)
_ @param lightningIdentifier - The app's Lightning address (lud16) or LNURL (lud06)
_ @param toLnurlpEndpoint - Resolves a Lightning identifier to an LNURL-pay endpoint URL
\*/

4. The client pays the invoice; the resulting zap receipt is processed by `handleZapReceipt()`.
5. On success, the registry is updated and published to relays.

## Error Handling

- Throws `ZapInvoiceError` with HTTP status for validation and LNURL errors.

## Example: Vanity URL Purchase

### 1. Subclass Implementation (Server)

```ts
import { ZapPurchaseManager, type ZapPurchaseEntry, type PricingTier } from './ZapPurchaseManager'

export interface VanityEntry extends ZapPurchaseEntry {
	vanityName: string
}

export const VANITY_PRICING: Record<string, PricingTier> = {
	'6mo': { sats: 10000, days: 180, label: '6 Months' },
	'1yr': { sats: 18000, days: 365, label: '1 Year' },
}

export class VanityManagerImpl extends ZapPurchaseManager<VanityEntry> {
	constructor(eventSigner: EventSigner) {
		super(
			{
				zapLabel: 'vanity-register',
				registryEventKind: 30000,
				registryDTag: 'vanity-urls',
				pricing: VANITY_PRICING,
			},
			eventSigner,
		)
	}

	protected extractRegistryKey(zapRequest: NostrEvent): string | null {
		const tag = zapRequest.tags.find((t) => t[0] === 'vanity')
		return tag?.[1]?.toLowerCase() ?? null
	}

	protected validateRegistration(key: string, pubkey: string): string | null {
		// Custom validation logic (e.g., reserved names, uniqueness)
		return null
	}

	protected extractEntriesFromEvent(event: NostrEvent) {
		// Parse vanity entries from event tags
		return []
	}

	protected buildRegistryTags(entries: Map<string, VanityEntry>): string[][] {
		// Serialize entries to tags
		return []
	}

	protected createEntry(key: string, pubkey: string, validUntil: number): VanityEntry {
		return { vanityName: key, pubkey, validUntil }
	}
}
```

### 2. Client Usage Example

```ts
import { purchaseVanityForPubkey } from '@/lib/zapPurchase'

const invoice = await purchaseVanityForPubkey({ ndk, appPubkey, appRelay }, { name: 'my-shop', amountSats: 10000 })
// invoice.pr is the BOLT11 Lightning invoice string
```

### 3. End-to-End Flow

1. **Client** calls `purchaseVanityForPubkey()` to request an invoice for a vanity name.
2. **Server** receives the zap request, resolves the correct manager (`VanityManagerImpl`), and calls `generateInvoice()`.
3. **Client** pays the Lightning invoice.
4. **Server** receives the zap receipt (kind 9735), validates it, and registers the purchase in the vanity registry.
5. **Server** publishes the updated registry as a Nostr event.

---

See the source code in `src/server/ZapPurchaseManager.ts` and `src/server/VanityManager.ts` for full details.
