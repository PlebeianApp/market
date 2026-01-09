# NDK (Nostr Development Kit) - Claude Skill Reference

## Overview

NDK is the primary Nostr development kit with outbox-model support, designed for building Nostr applications with TypeScript/JavaScript. This reference is based on analyzing production usage in the Plebeian Market codebase.

## Core Concepts

### 1. NDK Initialization

**Basic Pattern:**

```typescript
import NDK from '@nostr-dev-kit/ndk'

// Simple initialization
const ndk = new NDK({
	explicitRelayUrls: ['wss://relay.damus.io', 'wss://relay.nostr.band'],
})

await ndk.connect()
```

**Store-based Pattern (Production):**

```typescript
// From src/lib/stores/ndk.ts
const ndk = new NDK({
	explicitRelayUrls: relays || defaultRelaysUrls,
})

// Separate NDK for zaps on specialized relays
const zapNdk = new NDK({
	explicitRelayUrls: ZAP_RELAYS,
})

// Connect with timeout protection
const connectPromise = ndk.connect()
const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeoutMs))
await Promise.race([connectPromise, timeoutPromise])
```

### 2. Authentication & Signers

NDK supports multiple signer types for different authentication methods:

#### NIP-07 (Browser Extension)

```typescript
import { NDKNip07Signer } from '@nostr-dev-kit/ndk'

const signer = new NDKNip07Signer()
await signer.blockUntilReady()
ndk.signer = signer

const user = await signer.user()
```

#### Private Key Signer

```typescript
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'

const signer = new NDKPrivateKeySigner(privateKeyHex)
await signer.blockUntilReady()
ndk.signer = signer

const user = await signer.user()
```

#### NIP-46 (Remote Signer / Bunker)

```typescript
import { NDKNip46Signer } from '@nostr-dev-kit/ndk'

const localSigner = new NDKPrivateKeySigner(localPrivateKey)
const remoteSigner = new NDKNip46Signer(ndk, bunkerUrl, localSigner)
await remoteSigner.blockUntilReady()
ndk.signer = remoteSigner

const user = await remoteSigner.user()
```

**Key Points:**

- Always call `blockUntilReady()` before using a signer
- Store signer reference in your state management
- Set `ndk.signer` to enable signing operations
- Use `await signer.user()` to get the authenticated user

### 3. Event Creation & Publishing

#### Basic Event Pattern

```typescript
import { NDKEvent } from '@nostr-dev-kit/ndk'

// Create event
const event = new NDKEvent(ndk)
event.kind = 1 // Kind 1 = text note
event.content = 'Hello Nostr!'
event.tags = [
	['t', 'nostr'],
	['p', recipientPubkey],
]

// Sign and publish
await event.sign() // Uses ndk.signer automatically
await event.publish()

// Get event ID after signing
console.log(event.id)
```

#### Production Pattern with Error Handling

```typescript
// From src/publish/orders.tsx
const event = new NDKEvent(ndk)
event.kind = ORDER_PROCESS_KIND
event.content = orderNotes || ''
event.tags = [
	['p', sellerPubkey],
	['subject', `Order for ${productName}`],
	['type', 'order-creation'],
	['order', orderId],
	['amount', totalAmount],
	['item', productRef, quantity.toString()],
]

// Optional tags
if (shippingRef) {
	event.tags.push(['shipping', shippingRef])
}

try {
	await event.sign(signer) // Can pass explicit signer
	await event.publish()
	return event.id
} catch (error) {
	console.error('Failed to publish event:', error)
	throw error
}
```

**Key Points:**

- Create event with `new NDKEvent(ndk)`
- Set `kind`, `content`, and `tags` properties
- Optional: Set `created_at` timestamp (defaults to now)
- Call `await event.sign()` before publishing
- Call `await event.publish()` to broadcast to relays
- Access `event.id` after signing for the event hash

### 4. Querying Events with Filters

#### fetchEvents() - One-time Fetch

```typescript
import { NDKFilter } from '@nostr-dev-kit/ndk'

// Simple filter
const filter: NDKFilter = {
	kinds: [30402], // Product listings
	authors: [merchantPubkey],
	limit: 50,
}

const events = await ndk.fetchEvents(filter)
// Returns Set<NDKEvent>

// Convert to array and process
const eventArray = Array.from(events)
const sortedEvents = eventArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
```

#### Advanced Filters

```typescript
// Multiple kinds
const filter: NDKFilter = {
	kinds: [16, 17], // Orders and payment receipts
	'#order': [orderId], // Tag filter (# prefix)
	since: Math.floor(Date.now() / 1000) - 86400, // Last 24 hours
	limit: 100,
}

// Event ID lookup
const filter: NDKFilter = {
	ids: [eventIdHex],
}

// Tag filtering
const filter: NDKFilter = {
	kinds: [1],
	'#p': [pubkey], // Events mentioning pubkey
	'#t': ['nostr'], // Events with hashtag 'nostr'
}
```

### 5. Subscriptions (Real-time)

#### Basic Subscription

```typescript
// From src/queries/blacklist.tsx
const filter = {
	kinds: [10000],
	authors: [appPubkey],
}

const subscription = ndk.subscribe(filter, {
	closeOnEose: false, // Keep open for real-time updates
})

subscription.on('event', (event: NDKEvent) => {
	console.log('New event received:', event)
	// Process event
})

subscription.on('eose', () => {
	console.log('End of stored events')
})

// Cleanup
subscription.stop()
```

#### Production Pattern with React Query

```typescript
// From src/queries/orders.tsx
useEffect(() => {
	if (!orderId || !ndk) return

	const filter = {
		kinds: [ORDER_PROCESS_KIND, PAYMENT_RECEIPT_KIND],
		'#order': [orderId],
	}

	const subscription = ndk.subscribe(filter, {
		closeOnEose: false,
	})

	subscription.on('event', (newEvent) => {
		// Invalidate React Query cache to trigger refetch
		queryClient.invalidateQueries({
			queryKey: orderKeys.details(orderId),
		})
	})

	// Cleanup on unmount
	return () => {
		subscription.stop()
	}
}, [orderId, ndk, queryClient])
```

#### Monitoring Specific Events

```typescript
// From src/queries/payment.tsx - Payment receipt monitoring
const receiptFilter = {
	kinds: [17], // Payment receipts
	'#order': [orderId],
	'#payment-request': [invoiceId],
	since: sessionStartTime - 30, // Clock skew buffer
}

const subscription = ndk.subscribe(receiptFilter, {
	closeOnEose: false,
})

subscription.on('event', (receiptEvent: NDKEvent) => {
	// Verify this is the correct invoice
	const paymentRequestTag = receiptEvent.tags.find((tag) => tag[0] === 'payment-request')

	if (paymentRequestTag?.[1] === invoiceId) {
		const paymentTag = receiptEvent.tags.find((tag) => tag[0] === 'payment')
		const preimage = paymentTag?.[3] || 'external-payment'

		// Stop subscription after finding payment
		subscription.stop()
		handlePaymentReceived(preimage)
	}
})
```

**Key Subscription Patterns:**

- Use `closeOnEose: false` for real-time monitoring
- Use `closeOnEose: true` for one-time historical fetch
- Always call `subscription.stop()` in cleanup
- Listen to both `'event'` and `'eose'` events
- Filter events in the handler for specific conditions
- Integrate with React Query for reactive UI updates

### 6. User & Profile Handling

#### Fetching User Profiles

```typescript
// From src/queries/profiles.tsx

// By npub
const user = ndk.getUser({ npub })
const profile = await user.fetchProfile()
// Returns NDKUserProfile with name, picture, about, etc.

// By hex pubkey
const user = ndk.getUser({ hexpubkey: pubkey })
const profile = await user.fetchProfile()

// By NIP-05 identifier
const user = await ndk.getUserFromNip05('user@domain.com')
if (user) {
	const profile = await user.fetchProfile()
}

// Profile fields
const name = profile?.name || profile?.displayName
const avatar = profile?.picture || profile?.image
const bio = profile?.about
const nip05 = profile?.nip05
const lud16 = profile?.lud16 // Lightning address
```

#### Getting Current User

```typescript
// Active user (authenticated)
const user = ndk.activeUser

// From signer
const user = await ndk.signer?.user()

// User properties
const pubkey = user.pubkey // Hex format
const npub = user.npub // NIP-19 encoded
```

### 7. NDK Event Object

#### Essential Properties

```typescript
interface NDKEvent {
	id: string // Event hash (after signing)
	kind: number // Event kind
	content: string // Event content
	tags: NDKTag[] // Array of tag arrays
	created_at?: number // Unix timestamp
	pubkey?: string // Author pubkey (after signing)
	sig?: string // Signature (after signing)

	// Methods
	sign(signer?: NDKSigner): Promise<void>
	publish(): Promise<void>
	tagValue(tagName: string): string | undefined
}

type NDKTag = string[] // e.g., ['p', pubkey, relay, petname]
```

#### Tag Helpers

```typescript
// Get first value of a tag
const orderId = event.tagValue('order')
const recipientPubkey = event.tagValue('p')

// Find specific tag
const paymentTag = event.tags.find((tag) => tag[0] === 'payment')
const preimage = paymentTag?.[3]

// Get all tags of a type
const pTags = event.tags.filter((tag) => tag[0] === 'p')
const allPubkeys = pTags.map((tag) => tag[1])

// Common tag patterns
event.tags.push(['p', pubkey]) // Mention
event.tags.push(['e', eventId]) // Reference event
event.tags.push(['t', 'nostr']) // Hashtag
event.tags.push(['d', identifier]) // Replaceable event ID
event.tags.push(['a', '30402:pubkey:d-tag']) // Addressable event reference
```

### 8. Parameterized Replaceable Events (NIP-33)

Used for products, collections, profiles that need updates:

```typescript
// Product listing (kind 30402)
const event = new NDKEvent(ndk)
event.kind = 30402
event.content = JSON.stringify(productDetails)
event.tags = [
	['d', productSlug], // Unique identifier
	['title', productName],
	['price', price, currency],
	['image', imageUrl],
	['shipping', shippingRef],
]

await event.sign()
await event.publish()

// Querying replaceable events
const filter = {
	kinds: [30402],
	authors: [merchantPubkey],
	'#d': [productSlug], // Specific product
}

const events = await ndk.fetchEvents(filter)
// Returns only the latest version due to replaceable nature
```

### 9. Relay Management

#### Getting Relay Status

```typescript
// From src/lib/stores/ndk.ts
const connectedRelays = Array.from(ndk.pool?.relays.values() || [])
	.filter((relay) => relay.status === 1) // 1 = connected
	.map((relay) => relay.url)

const outboxRelays = Array.from(ndk.outboxPool?.relays.values() || [])
```

#### Adding Relays

```typescript
// Add explicit relays
ndk.addExplicitRelay('wss://relay.example.com')

// Multiple relays
const relays = ['wss://relay1.com', 'wss://relay2.com']
relays.forEach((url) => ndk.addExplicitRelay(url))
```

### 10. Common Patterns & Best Practices

#### Null Safety

```typescript
// Always check NDK initialization
const ndk = ndkActions.getNDK()
if (!ndk) throw new Error('NDK not initialized')

// Check signer before operations requiring auth
const signer = ndk.signer
if (!signer) throw new Error('No active signer')

// Check user authentication
const user = ndk.activeUser
if (!user) throw new Error('Not authenticated')
```

#### Error Handling

```typescript
try {
	const events = await ndk.fetchEvents(filter)
	if (events.size === 0) {
		return null // No results found
	}
	return Array.from(events)
} catch (error) {
	console.error('Failed to fetch events:', error)
	throw new Error('Could not fetch data from relays')
}
```

#### Connection Lifecycle

```typescript
// Initialize once at app startup
const ndk = new NDK({ explicitRelayUrls: relays })

// Connect with timeout
await Promise.race([ndk.connect(), new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))])

// Check connection status
const isConnected = ndk.pool?.connectedRelays().length > 0

// Reconnect if needed
if (!isConnected) {
	await ndk.connect()
}
```

#### Subscription Cleanup

```typescript
// In React components
useEffect(() => {
	if (!ndk) return

	const sub = ndk.subscribe(filter, { closeOnEose: false })

	sub.on('event', handleEvent)
	sub.on('eose', handleEose)

	// Critical: cleanup on unmount
	return () => {
		sub.stop()
	}
}, [dependencies])
```

#### Event Validation

```typescript
// Check required fields before processing
if (!event.pubkey) {
	console.error('Event missing pubkey')
	return
}

if (!event.created_at) {
	console.error('Event missing timestamp')
	return
}

// Verify event age
const now = Math.floor(Date.now() / 1000)
const eventAge = now - (event.created_at || 0)
if (eventAge > 86400) {
	// Older than 24 hours
	console.log('Event is old, skipping')
	return
}

// Validate specific tags exist
const orderId = event.tagValue('order')
if (!orderId) {
	console.error('Order event missing order ID')
	return
}
```

### 11. Common Event Kinds

```typescript
// NIP-01: Basic Events
const KIND_METADATA = 0 // User profile
const KIND_TEXT_NOTE = 1 // Short text note
const KIND_RECOMMEND_RELAY = 2 // Relay recommendation

// NIP-04: Encrypted Direct Messages
const KIND_ENCRYPTED_DM = 4

// NIP-25: Reactions
const KIND_REACTION = 7

// NIP-51: Lists
const KIND_MUTE_LIST = 10000
const KIND_PIN_LIST = 10001
const KIND_RELAY_LIST = 10002

// NIP-57: Lightning Zaps
const KIND_ZAP_REQUEST = 9734
const KIND_ZAP_RECEIPT = 9735

// Marketplace (Plebeian/Gamma spec)
const ORDER_PROCESS_KIND = 16 // Order processing
const PAYMENT_RECEIPT_KIND = 17 // Payment receipts
const DIRECT_MESSAGE_KIND = 14 // Direct messages
const ORDER_GENERAL_KIND = 27 // General order events
const SHIPPING_KIND = 30405 // Shipping options
const PRODUCT_KIND = 30402 // Product listings
const COLLECTION_KIND = 30401 // Product collections
const REVIEW_KIND = 30407 // Product reviews

// Application Handlers
const APP_HANDLER_KIND = 31990 // NIP-89 app handlers
```

## Integration with TanStack Query

NDK works excellently with TanStack Query for reactive data fetching:

### Query Functions

```typescript
// From src/queries/products.tsx
export const fetchProductsByPubkey = async (pubkey: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30402],
		authors: [pubkey],
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events).map(parseProductEvent)
}

export const useProductsByPubkey = (pubkey: string) => {
	return useQuery({
		queryKey: productKeys.byAuthor(pubkey),
		queryFn: () => fetchProductsByPubkey(pubkey),
		enabled: !!pubkey,
		staleTime: 30000,
	})
}
```

### Combining Queries with Subscriptions

```typescript
// Query for initial data
const { data: order, refetch } = useQuery({
	queryKey: orderKeys.details(orderId),
	queryFn: () => fetchOrderById(orderId),
	enabled: !!orderId,
})

// Subscription for real-time updates
useEffect(() => {
	if (!orderId || !ndk) return

	const sub = ndk.subscribe({ kinds: [16, 17], '#order': [orderId] }, { closeOnEose: false })

	sub.on('event', () => {
		// Invalidate query to trigger refetch
		queryClient.invalidateQueries({
			queryKey: orderKeys.details(orderId),
		})
	})

	return () => sub.stop()
}, [orderId, ndk, queryClient])
```

## Troubleshooting

### Events Not Received

- Check relay connections: `ndk.pool?.connectedRelays()`
- Verify filter syntax (especially tag filters with `#` prefix)
- Check event timestamps match filter's `since`/`until`
- Ensure `closeOnEose: false` for real-time subscriptions

### Signing Errors

- Verify signer is initialized: `await signer.blockUntilReady()`
- Check signer is set: `ndk.signer !== undefined`
- For NIP-07, ensure browser extension is installed and enabled
- For NIP-46, verify bunker URL and local signer are correct

### Connection Timeouts

- Implement connection timeout pattern shown above
- Try connecting to fewer, more reliable relays initially
- Use fallback relays in production

### Duplicate Events

- NDK deduplicates by event ID automatically
- For subscriptions, track processed event IDs if needed
- Use replaceable events (kinds 10000-19999, 30000-39999) when appropriate

## Performance Optimization

### Batching Queries

```typescript
// Instead of multiple fetchEvents calls
const [products, orders, profiles] = await Promise.all([
	ndk.fetchEvents(productFilter),
	ndk.fetchEvents(orderFilter),
	ndk.fetchEvents(profileFilter),
])
```

### Limiting Results

```typescript
const filter = {
	kinds: [1],
	authors: [pubkey],
	limit: 50, // Limit results
	since: recentTimestamp, // Only recent events
}
```

### Caching with React Query

```typescript
export const useProfile = (npub: string) => {
	return useQuery({
		queryKey: profileKeys.byNpub(npub),
		queryFn: () => fetchProfileByNpub(npub),
		staleTime: 5 * 60 * 1000, // 5 minutes
		cacheTime: 30 * 60 * 1000, // 30 minutes
		enabled: !!npub,
	})
}
```

## References

- **NDK GitHub**: https://github.com/nostr-dev-kit/ndk
- **NDK Documentation**: https://ndk.fyi
- **Nostr NIPs**: https://github.com/nostr-protocol/nips
- **Production Example**: Plebeian Market codebase

## Key Files in This Codebase

- `src/lib/stores/ndk.ts` - NDK store and initialization
- `src/lib/stores/auth.ts` - Authentication with NDK signers
- `src/queries/*.tsx` - Query patterns with NDK
- `src/publish/*.tsx` - Event publishing patterns
- `scripts/gen_*.ts` - Event creation examples

---

_This reference is based on NDK version used in production and real-world patterns from the Plebeian Market application._
