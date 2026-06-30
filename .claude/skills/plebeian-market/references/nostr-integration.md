# Nostr Integration Guide

## Overview

Plebeian Market uses the Nostr protocol for all data storage and communication. All products, orders, profiles, and marketplace data are stored as Nostr events on relays.

## NDK (Nostr Dev Kit)

### Core Library

**Package:** `@nostr-dev-kit/ndk` v2.15.2

NDK is the primary interface for Nostr operations:

- Connecting to relays
- Fetching events
- Publishing events
- Managing subscriptions
- User authentication

### NDK Store

Located at `lib/stores/ndk.ts`:

```typescript
import NDK from '@nostr-dev-kit/ndk'

// Store holds the NDK instance
export const ndkStore = new Store<{
	ndk: NDK | null
	isConnected: boolean
}>({
	ndk: null,
	isConnected: false,
})

// Actions to interact with NDK
export const ndkActions = {
	getNDK: (): NDK => {
		const state = ndkStore.state
		if (!state.ndk) {
			throw new Error('NDK not initialized')
		}
		return state.ndk
	},

	getUser: async () => {
		const ndk = ndkActions.getNDK()
		return ndk.activeUser
	},
}
```

### NDK Cache (Dexie)

**Package:** `@nostr-dev-kit/ndk-cache-dexie` v2.6.33

IndexedDB caching layer for NDK events:

- Reduces relay queries
- Offline support
- Faster data access

## Nostr Event Kinds

### Product Listings (Kind 30402)

Parameterized replaceable events for products:

```typescript
{
  kind: 30402,
  tags: [
    ['d', 'unique-product-id'],        // Identifier
    ['title', 'Product Name'],
    ['summary', 'Short description'],
    ['price', '50000', 'sats'],        // Price in satoshis
    ['image', 'https://...'],          // Multiple allowed
    ['t', 'tag1'],                     // Product tags
    ['t', 'tag2'],
    ['location', 'City, Country'],
    ['shipping', 'worldwide'],
  ],
  content: 'Long product description...',
}
```

### Orders (Custom Kinds)

Orders use custom event kinds for the marketplace.

### Profiles (Kind 0)

Standard Nostr profile events:

```typescript
{
  kind: 0,
  content: JSON.stringify({
    name: 'User Name',
    display_name: 'Display Name',
    about: 'Bio text',
    picture: 'https://...',
    banner: 'https://...',
    nip05: 'user@domain.com',
    lud16: 'user@getalby.com',  // Lightning address
  })
}
```

## Data Fetching Patterns

### Basic Event Fetching

```typescript
import { NDKFilter } from '@nostr-dev-kit/ndk'

export const fetchProducts = async (limit: number = 500, tag?: string) => {
	const ndk = ndkActions.getNDK()

	const filter: NDKFilter = {
		kinds: [30402],
		limit,
	}

	// Optional tag filtering
	if (tag) {
		filter['#t'] = [tag]
	}

	const events = await ndk.fetchEvents(filter)

	// Convert Set to Array and sort by creation time
	return Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}
```

### Fetching Single Event

```typescript
export const fetchProduct = async (id: string): Promise<NDKEvent | null> => {
	const ndk = ndkActions.getNDK()

	const filter: NDKFilter = {
		kinds: [30402],
		'#d': [id],
		limit: 1,
	}

	const events = await ndk.fetchEvents(filter)
	return events.size > 0 ? Array.from(events)[0] : null
}
```

### Fetching User's Products

```typescript
export const fetchProductsByPubkey = async (pubkey: string) => {
	const ndk = ndkActions.getNDK()

	const filter: NDKFilter = {
		kinds: [30402],
		authors: [pubkey],
		limit: 500,
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events)
}
```

### Profile Fetching

```typescript
export const fetchProfile = async (pubkey: string) => {
	const ndk = ndkActions.getNDK()

	const user = ndk.getUser({ pubkey })
	await user.fetchProfile()

	return user.profile
}
```

## Publishing Events

### Creating and Publishing Product

```typescript
import { NDKEvent } from '@nostr-dev-kit/ndk'

export const publishProduct = async (productData: {
	id: string
	title: string
	summary: string
	price: number
	images: string[]
	tags: string[]
	description: string
}) => {
	const ndk = ndkActions.getNDK()

	const event = new NDKEvent(ndk)
	event.kind = 30402
	event.tags = [
		['d', productData.id],
		['title', productData.title],
		['summary', productData.summary],
		['price', productData.price.toString(), 'sats'],
		...productData.images.map((img) => ['image', img]),
		...productData.tags.map((tag) => ['t', tag]),
	]
	event.content = productData.description

	await event.publish()
	return event
}
```

### Updating Product (Replaceable)

Since kind 30402 is parameterized replaceable, publishing a new event with the same `d` tag replaces the old one:

```typescript
// Simply publish with same 'd' tag identifier
await publishProduct({ id: 'same-id', ...updatedData })
```

### Deleting Product

Publish a deletion event (kind 5):

```typescript
export const deleteProduct = async (productEventId: string) => {
	const ndk = ndkActions.getNDK()

	const deleteEvent = new NDKEvent(ndk)
	deleteEvent.kind = 5
	deleteEvent.tags = [['e', productEventId]]

	await deleteEvent.publish()
}
```

## Data Transformation Utilities

Extract data from Nostr events using utility functions:

```typescript
// lib/utils/nostr.ts

export const getProductTitle = (product: NDKEvent): string => product.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled'

export const getProductPrice = (product: NDKEvent): number => {
	const priceTag = product.tags.find((t) => t[0] === 'price')
	return priceTag ? parseInt(priceTag[1]) : 0
}

export const getProductImages = (product: NDKEvent): string[] => product.tags.filter((t) => t[0] === 'image').map((t) => t[1])

export const getProductTags = (product: NDKEvent): string[] => product.tags.filter((t) => t[0] === 't').map((t) => t[1])

export const getProductSummary = (product: NDKEvent): string => product.tags.find((t) => t[0] === 'summary')?.[1] || ''

export const getProductDescription = (product: NDKEvent): string => product.content || ''

export const getProductId = (product: NDKEvent): string => product.tags.find((t) => t[0] === 'd')?.[1] || product.id
```

## Authentication Patterns

### Login with Extension (NIP-07)

```typescript
// lib/stores/auth.ts
export const authActions = {
	loginWithExtension: async () => {
		if (!window.nostr) {
			throw new Error('No Nostr extension found')
		}

		const pubkey = await window.nostr.getPublicKey()
		const ndk = ndkActions.getNDK()

		// Set active user
		ndk.activeUser = ndk.getUser({ pubkey })

		authStore.setState({
			user: ndk.activeUser,
			isAuthenticated: true,
		})
	},

	logout: () => {
		const ndk = ndkActions.getNDK()
		ndk.activeUser = undefined

		authStore.setState({
			user: null,
			isAuthenticated: false,
		})
	},
}
```

### Signing Events

When using browser extension (NIP-07):

```typescript
// Event signing is handled automatically by NDK
// when activeUser is set
const event = new NDKEvent(ndk)
event.kind = 30402
// ... configure event
await event.publish() // Automatically uses extension for signing
```

## Relay Configuration

Located at `lib/relays.ts`:

```typescript
export const DEFAULT_RELAYS = [
	'wss://relay.nostr.band',
	'wss://relay.damus.io',
	'wss://nostr.wine',
	'wss://relay.snort.social',
	// ... more relays
]

// NDK initialization with relays
const ndk = new NDK({
	explicitRelayUrls: DEFAULT_RELAYS,
})

await ndk.connect()
```

## Subscriptions

For real-time updates:

```typescript
export const subscribeToProducts = (onEvent: (event: NDKEvent) => void, tag?: string) => {
	const ndk = ndkActions.getNDK()

	const filter: NDKFilter = {
		kinds: [30402],
		since: Math.floor(Date.now() / 1000), // Only new events
	}

	if (tag) {
		filter['#t'] = [tag]
	}

	const sub = ndk.subscribe(filter)

	sub.on('event', onEvent)

	// Return cleanup function
	return () => sub.stop()
}

// Usage in component
useEffect(() => {
	const unsubscribe = subscribeToProducts((event) => {
		// Handle new product
		queryClient.invalidateQueries({ queryKey: productKeys.all })
	})

	return unsubscribe
}, [])
```

## WebSocket Server Integration

The backend server (src/index.tsx) handles WebSocket messages:

```typescript
export const server = serve({
	websocket: {
		async message(ws, message) {
			const data = JSON.parse(message)

			// Handle Nostr REQ/EVENT messages
			if (data[0] === 'EVENT') {
				const event = data[1]

				// Verify event signature
				const isValid = await verifySignature(event)

				if (isValid) {
					// Re-sign with app key and publish to relay
					await publishToRelay(event)
				}
			}
		},
	},
})
```

## Error Handling

### Temporal Dead Zone Errors

During NDK initialization, some errors are expected:

```typescript
// frontend.tsx
try {
	// NDK operations
} catch (error) {
	if (error.message.includes('temporal dead zone')) {
		return // Expected during initialization
	}
	throw error
}
```

### Relay Connection Errors

Handle relay failures gracefully:

```typescript
try {
	const events = await ndk.fetchEvents(filter)
} catch (error) {
	console.error('Failed to fetch from relays:', error)
	// Fall back to cached data if available
	return getCachedEvents()
}
```

## Best Practices

1. **Use query key factory** - Organize cache invalidation
2. **Cache profiles** - Store in localStorage to reduce queries
3. **Batch operations** - Fetch multiple events in single query when possible
4. **Handle stale data** - Set appropriate `staleTime` in React Query
5. **Graceful degradation** - Fall back to cache on relay failures
6. **Verify signatures** - Always verify event signatures on critical operations
7. **Proper event kinds** - Use standard NIPs when available
8. **Relay selection** - Use multiple reliable relays for redundancy
9. **Connection pooling** - Reuse NDK instance across app
10. **Error boundaries** - Wrap Nostr operations in try-catch

## NIP Support

The application supports:

- **NIP-01:** Basic protocol flow
- **NIP-07:** Browser extension signing
- **NIP-19:** bech32 encoding (npub, note, etc.)
- **NIP-33:** Parameterized replaceable events (products)
- **NIP-57:** Lightning Zaps
- **NIP-65:** Relay list metadata

Refer to [NIPs repository](https://github.com/nostr-protocol/nips) for specifications.
