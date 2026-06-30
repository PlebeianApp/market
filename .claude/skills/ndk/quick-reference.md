# NDK Quick Reference

Fast lookup guide for common NDK tasks.

## Quick Start

```typescript
import NDK from '@nostr-dev-kit/ndk'

const ndk = new NDK({ explicitRelayUrls: ['wss://relay.damus.io'] })
await ndk.connect()
```

## Authentication

### Browser Extension (NIP-07)

```typescript
import { NDKNip07Signer } from '@nostr-dev-kit/ndk'
const signer = new NDKNip07Signer()
await signer.blockUntilReady()
ndk.signer = signer
```

### Private Key

```typescript
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
const signer = new NDKPrivateKeySigner(privateKeyHex)
await signer.blockUntilReady()
ndk.signer = signer
```

### Remote Signer (NIP-46)

```typescript
import { NDKNip46Signer, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
const localSigner = new NDKPrivateKeySigner()
const remoteSigner = new NDKNip46Signer(ndk, bunkerUrl, localSigner)
await remoteSigner.blockUntilReady()
ndk.signer = remoteSigner
```

## Publish Event

```typescript
import { NDKEvent } from '@nostr-dev-kit/ndk'

const event = new NDKEvent(ndk)
event.kind = 1
event.content = 'Hello Nostr!'
event.tags = [['t', 'nostr']]

await event.sign()
await event.publish()
```

## Query Events (One-time)

```typescript
const events = await ndk.fetchEvents({
	kinds: [1],
	authors: [pubkey],
	limit: 50,
})

// Convert Set to Array
const eventArray = Array.from(events)
```

## Subscribe (Real-time)

```typescript
const sub = ndk.subscribe({ kinds: [1], authors: [pubkey] }, { closeOnEose: false })

sub.on('event', (event) => {
	console.log('New event:', event.content)
})

// Cleanup
sub.stop()
```

## Get User Profile

```typescript
// By npub
const user = ndk.getUser({ npub })
const profile = await user.fetchProfile()

// By hex pubkey
const user = ndk.getUser({ hexpubkey: pubkey })
const profile = await user.fetchProfile()

// By NIP-05
const user = await ndk.getUserFromNip05('user@domain.com')
const profile = await user?.fetchProfile()
```

## Common Filters

```typescript
// By author
{ kinds: [1], authors: [pubkey] }

// By tag
{ kinds: [1], '#p': [pubkey] }
{ kinds: [30402], '#d': [productSlug] }

// By time
{
  kinds: [1],
  since: Math.floor(Date.now() / 1000) - 86400,  // Last 24h
  until: Math.floor(Date.now() / 1000)
}

// By event ID
{ ids: [eventId] }

// Multiple conditions
{
  kinds: [16, 17],
  '#order': [orderId],
  since: timestamp,
  limit: 100
}
```

## Tag Helpers

```typescript
// Get first tag value
const orderId = event.tagValue('order')

// Find specific tag
const tag = event.tags.find((t) => t[0] === 'payment')
const value = tag?.[1]

// Get all of one type
const pTags = event.tags.filter((t) => t[0] === 'p')[
	// Common tag formats
	('p', pubkey)
][('e', eventId)][('t', 'nostr')][('d', identifier)][('a', '30402:pubkey:d-tag')] // Mention // Event reference // Hashtag // Replaceable ID // Addressable reference
```

## Error Handling Pattern

```typescript
const ndk = ndkActions.getNDK()
if (!ndk) throw new Error('NDK not initialized')

const signer = ndk.signer
if (!signer) throw new Error('No active signer')

try {
	await event.publish()
} catch (error) {
	console.error('Publish failed:', error)
	throw error
}
```

## React Integration

```typescript
// Query function
export const fetchProducts = async (pubkey: string) => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const events = await ndk.fetchEvents({
		kinds: [30402],
		authors: [pubkey],
	})

	return Array.from(events)
}

// React Query hook
export const useProducts = (pubkey: string) => {
	return useQuery({
		queryKey: ['products', pubkey],
		queryFn: () => fetchProducts(pubkey),
		enabled: !!pubkey,
	})
}

// Subscription in useEffect
useEffect(() => {
	if (!ndk || !orderId) return

	const sub = ndk.subscribe({ kinds: [16], '#order': [orderId] }, { closeOnEose: false })

	sub.on('event', () => {
		queryClient.invalidateQueries(['order', orderId])
	})

	return () => sub.stop()
}, [ndk, orderId, queryClient])
```

## Common Event Kinds

```typescript
0 // Metadata (profile)
1 // Text note
4 // Encrypted DM (NIP-04)
7 // Reaction
9735 // Zap receipt
10000 // Mute list
10002 // Relay list
30402 // Product listing (Marketplace)
31990 // App handler (NIP-89)
```

## Relay Management

```typescript
// Check connection
const connected = ndk.pool?.connectedRelays().length > 0

// Get connected relays
const relays = Array.from(ndk.pool?.relays.values() || []).filter((r) => r.status === 1)

// Add relay
ndk.addExplicitRelay('wss://relay.example.com')
```

## Connection with Timeout

```typescript
const connectWithTimeout = async (timeoutMs = 10000) => {
	const connectPromise = ndk.connect()
	const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))

	await Promise.race([connectPromise, timeoutPromise])
}
```

## Current User

```typescript
// Active user
const user = ndk.activeUser

// From signer
const user = await ndk.signer?.user()

// User info
const pubkey = user.pubkey // hex
const npub = user.npub // NIP-19
```

## Parameterized Replaceable Events

```typescript
// Create
const event = new NDKEvent(ndk)
event.kind = 30402
event.content = JSON.stringify(data)
event.tags = [
	['d', uniqueIdentifier], // Required for replaceable
	['title', 'Product Name'],
]

await event.sign()
await event.publish()

// Query (returns latest only)
const events = await ndk.fetchEvents({
	kinds: [30402],
	authors: [pubkey],
	'#d': [identifier],
})
```

## Validation Checks

```typescript
// Event age check
const now = Math.floor(Date.now() / 1000)
const age = now - (event.created_at || 0)
if (age > 86400) console.log('Event older than 24h')

// Required fields
if (!event.pubkey || !event.created_at || !event.sig) {
	throw new Error('Invalid event')
}

// Tag existence
const orderId = event.tagValue('order')
if (!orderId) throw new Error('Missing order tag')
```

## Performance Tips

```typescript
// Batch queries
const [products, orders] = await Promise.all([ndk.fetchEvents(productFilter), ndk.fetchEvents(orderFilter)])

// Limit results
const filter = {
	kinds: [1],
	limit: 50,
	since: recentTimestamp,
}

// Cache with React Query
const { data } = useQuery({
	queryKey: ['profile', npub],
	queryFn: () => fetchProfile(npub),
	staleTime: 5 * 60 * 1000, // 5 min
})
```

## Debugging

```typescript
// Check NDK state
console.log('Connected:', ndk.pool?.connectedRelays())
console.log('Signer:', ndk.signer)
console.log('Active user:', ndk.activeUser)

// Event inspection
console.log('Event ID:', event.id)
console.log('Tags:', event.tags)
console.log('Content:', event.content)
console.log('Author:', event.pubkey)

// Subscription events
sub.on('event', (e) => console.log('Event:', e))
sub.on('eose', () => console.log('End of stored events'))
```

---

For detailed explanations and advanced patterns, see `ndk-skill.md`.
