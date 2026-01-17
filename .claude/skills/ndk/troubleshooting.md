# NDK Common Patterns & Troubleshooting

Quick reference for common patterns and solutions to frequent NDK issues.

## Common Patterns

### Store-Based NDK Management

```typescript
// Store pattern (recommended for React apps)
import { Store } from '@tanstack/store'

interface NDKState {
	ndk: NDK | null
	isConnected: boolean
	signer?: NDKSigner
}

const ndkStore = new Store<NDKState>({
	ndk: null,
	isConnected: false,
})

export const ndkActions = {
	initialize: () => {
		const ndk = new NDK({ explicitRelayUrls: relays })
		ndkStore.setState({ ndk })
		return ndk
	},

	getNDK: () => ndkStore.state.ndk,

	setSigner: (signer: NDKSigner) => {
		const ndk = ndkStore.state.ndk
		if (ndk) {
			ndk.signer = signer
			ndkStore.setState({ signer })
		}
	},
}
```

### Query + Subscription Pattern

```typescript
// Initial data load + real-time updates (with TDZ protection)
function useOrdersWithRealtime(orderId: string) {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	// Fetch initial data
	const query = useQuery({
		queryKey: ['orders', orderId],
		queryFn: () => fetchOrders(orderId),
	})

	// Subscribe to updates with TDZ protection
	useEffect(() => {
		if (!ndk || !orderId) return

		// Check NDK pool is ready
		if (!ndk.pool) {
			console.warn('NDK pool not ready, skipping subscription')
			return
		}

		let isMounted = true
		let subscription: ReturnType<typeof ndk.subscribe> | null = null

		try {
			subscription = ndk.subscribe({ kinds: [16], '#order': [orderId] }, { closeOnEose: false })

			subscription.on('event', () => {
				if (!isMounted) return
				queryClient.invalidateQueries(['orders', orderId])
			})
		} catch (error) {
			console.warn('Error creating subscription:', error)
			return
		}

		// Cleanup with TDZ protection
		return () => {
			isMounted = false
			if (subscription) {
				setTimeout(() => {
					try {
						subscription?.stop()
					} catch (error) {
						if (error instanceof ReferenceError) {
							console.warn('[NDK] Suppressed TDZ error in cleanup')
						}
					}
				}, 100)
			}
		}
	}, [ndk, orderId, queryClient])

	return query
}
```

### Event Parsing Pattern

```typescript
// Parse event tags into structured data
function parseProductEvent(event: NDKEvent) {
	const getTag = (name: string) => event.tags.find((t) => t[0] === name)?.[1]

	const getAllTags = (name: string) => event.tags.filter((t) => t[0] === name).map((t) => t[1])

	return {
		id: event.id,
		slug: getTag('d'),
		title: getTag('title'),
		price: parseFloat(getTag('price') || '0'),
		currency: event.tags.find((t) => t[0] === 'price')?.[2] || 'USD',
		images: getAllTags('image'),
		shipping: getAllTags('shipping'),
		description: event.content,
		createdAt: event.created_at,
		author: event.pubkey,
	}
}
```

### Relay Pool Pattern

```typescript
// Separate NDK instances for different purposes
const mainNdk = new NDK({
	explicitRelayUrls: ['wss://relay.damus.io', 'wss://nos.lol'],
})

const zapNdk = new NDK({
	explicitRelayUrls: ['wss://relay.damus.io'], // Zap-optimized relays
})

const blossomNdk = new NDK({
	explicitRelayUrls: ['wss://blossom.server.com'], // Media server
})

await Promise.all([mainNdk.connect(), zapNdk.connect(), blossomNdk.connect()])
```

## Troubleshooting

### Problem: Temporal Dead Zone (TDZ) Errors in NDK Subscriptions

**Symptoms:**

- Console errors: `ReferenceError: Cannot access 's' before initialization`
- Console errors: `can't access lexical declaration 's' before initialization`
- Errors mentioning `aiGuardrails`
- Order status not loading on sales/purchases pages
- Subscriptions failing silently during navigation

**Root Cause:**

This is a JavaScript Temporal Dead Zone (TDZ) issue in NDK's bundled code. It occurs when:

1. A component unmounts while an NDK subscription is still active
2. The cleanup function calls `subscription.stop()` during NDK's internal async operations
3. JavaScript's strict mode throws ReferenceError when accessing variables in their TDZ

This is particularly problematic with:

- Rapid navigation between routes
- Component unmounting during async operations
- React's StrictMode (double-mounting/unmounting)

**Recognition - How to Identify TDZ Bugs:**

1. **Error patterns in console:**

   ```
   ReferenceError: Cannot access 's' before initialization
   ReferenceError: can't access lexical declaration 's' before initialization
   ```

2. **Stack traces mentioning:**
   - `nostr-dev-kit/ndk/dist/index.mjs`
   - `fetchEvent`
   - `aiGuardrails`

3. **Behavioral symptoms:**
   - Status updates not loading after navigation
   - Subscriptions that work initially but fail after route changes
   - Data that appears stale or doesn't update

**Solution - Protected Subscription Pattern:**

Always use this pattern when creating NDK subscriptions in React components:

```typescript
useEffect(() => {
	const ndk = ndkActions.getNDK()
	if (!ndk || !requiredParam) return

	// 1. Verify NDK pool is ready before creating subscription
	if (!ndk.pool) {
		console.warn('Component: NDK pool not ready, skipping subscription')
		return
	}

	// 2. Track mount state to prevent updates after unmount
	let isMounted = true
	let subscription: ReturnType<typeof ndk.subscribe> | null = null

	// 3. Wrap subscription creation in try/catch
	try {
		subscription = ndk.subscribe(filter, { closeOnEose: false })

		subscription.on('event', (event: NDKEvent) => {
			// 4. Guard against unmount in event handler
			if (!isMounted) return
			// ... handle event
		})
	} catch (error) {
		console.warn('Component: Error creating subscription:', error)
		return
	}

	// 5. Cleanup with TDZ protection
	return () => {
		isMounted = false

		if (subscription) {
			// 6. Use delayed cleanup (100ms) to let NDK finish internal operations
			setTimeout(() => {
				try {
					if (subscription && typeof subscription.stop === 'function') {
						subscription.stop()
					}
				} catch (error) {
					// 7. Suppress TDZ-specific errors
					if (error instanceof ReferenceError && error.message.includes("Cannot access 's' before initialization")) {
						console.warn('[NDK] Suppressed subscription cleanup race condition')
						return
					}
					if (error instanceof ReferenceError && error.message.includes('aiGuardrails')) {
						console.warn('[NDK] Suppressed aiGuardrails race condition')
						return
					}
					console.warn('Component: Error stopping subscription:', error)
				}
			}, 100)
		}
	}
}, [dependencies])
```

**Key Protection Elements:**

| Element                    | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `!ndk.pool` check          | Ensure NDK is fully initialized before use     |
| `isMounted` flag           | Prevent state updates after component unmounts |
| `try/catch` wrapper        | Catch errors during subscription creation      |
| `setTimeout(..., 100)`     | Give NDK time to complete internal cleanup     |
| ReferenceError suppression | Gracefully handle TDZ errors in cleanup        |

**Common Mistakes That Cause Regressions:**

1. **Missing TDZ protection in cleanup:**

   ```typescript
   // ❌ WRONG - No TDZ protection
   return () => {
   	sub.stop()
   }

   // ✅ CORRECT - With TDZ protection
   return () => {
   	setTimeout(() => {
   		try {
   			sub.stop()
   		} catch (error) {
   			// ... suppress TDZ errors
   		}
   	}, 100)
   }
   ```

2. **Missing isMounted guard:**

   ```typescript
   // ❌ WRONG - May update state after unmount
   subscription.on('event', (event) => {
   	setData(event)
   })

   // ✅ CORRECT - Guarded
   subscription.on('event', (event) => {
   	if (!isMounted) return
   	setData(event)
   })
   ```

3. **Missing pool readiness check:**

   ```typescript
   // ❌ WRONG - May fail if pool not ready
   const sub = ndk.subscribe(filter)

   // ✅ CORRECT - Check first
   if (!ndk.pool) {
   	console.warn('NDK pool not ready')
   	return
   }
   const sub = ndk.subscribe(filter)
   ```

**Global Error Handler (Defense in Depth):**

The app also has global error handlers in `src/frontend.tsx` that suppress TDZ errors at the window level. This provides a safety net but should not be relied upon as the primary fix.

**Files That Need TDZ Protection:**

When modifying subscription code in these files, always use the protected pattern:

- `src/queries/orders.tsx` - Order subscriptions
- `src/components/orders/OrderDetailComponent.tsx` - Payment receipt subscriptions
- `src/queries/payment.tsx` - Payment receipt subscriptions
- Any component using `ndk.subscribe()`

**Related Documentation:**

- `docs/NDK_TEMPORAL_DEAD_ZONE_FIX.md` - Detailed fix documentation
- `docs/NDK_VERSION_DOWNGRADE.md` - NDK version compatibility notes

---

### Problem: Events Not Received

**Symptoms:** Subscription doesn't receive events, fetchEvents returns empty Set

**Solutions:**

1. Check relay connection:

```typescript
const status = ndk.pool?.connectedRelays()
console.log('Connected relays:', status?.length)
if (status?.length === 0) {
	await ndk.connect()
}
```

2. Verify filter syntax (especially tags):

```typescript
// ❌ Wrong
{ kinds: [16], 'order': [orderId] }

// ✅ Correct (note the # prefix for tags)
{ kinds: [16], '#order': [orderId] }
```

3. Check timestamps:

```typescript
// Events might be too old/new
const now = Math.floor(Date.now() / 1000)
const filter = {
	kinds: [1],
	since: now - 86400, // Last 24 hours
	until: now,
}
```

4. Ensure closeOnEose is correct:

```typescript
// For real-time updates
ndk.subscribe(filter, { closeOnEose: false })

// For one-time historical fetch
ndk.subscribe(filter, { closeOnEose: true })
```

### Problem: "NDK not initialized"

**Symptoms:** `ndk` is null/undefined

**Solutions:**

1. Initialize before use:

```typescript
// In app entry point
const ndk = new NDK({ explicitRelayUrls: relays })
await ndk.connect()
```

2. Add null checks:

```typescript
const ndk = ndkActions.getNDK()
if (!ndk) throw new Error('NDK not initialized')
```

3. Use initialization guard:

```typescript
const ensureNDK = () => {
	let ndk = ndkActions.getNDK()
	if (!ndk) {
		ndk = ndkActions.initialize()
	}
	return ndk
}
```

### Problem: "No active signer" / Cannot Sign Events

**Symptoms:** Event signing fails, publishing throws error

**Solutions:**

1. Check signer is set:

```typescript
if (!ndk.signer) {
	throw new Error('Please login first')
}
```

2. Ensure blockUntilReady called:

```typescript
const signer = new NDKNip07Signer()
await signer.blockUntilReady() // ← Critical!
ndk.signer = signer
```

3. Handle NIP-07 unavailable:

```typescript
try {
	const signer = new NDKNip07Signer()
	await signer.blockUntilReady()
	ndk.signer = signer
} catch (error) {
	console.error('Browser extension not available')
	// Fallback to other auth method
}
```

### Problem: Duplicate Events in Subscriptions

**Symptoms:** Same event received multiple times

**Solutions:**

1. Track processed event IDs:

```typescript
const processedIds = new Set<string>()

sub.on('event', (event) => {
	if (processedIds.has(event.id)) return
	processedIds.add(event.id)
	handleEvent(event)
})
```

2. Use Map for event storage:

```typescript
const [events, setEvents] = useState<Map<string, NDKEvent>>(new Map())

sub.on('event', (event) => {
	setEvents((prev) => new Map(prev).set(event.id, event))
})
```

### Problem: Connection Timeout

**Symptoms:** connect() hangs, never resolves

**Solutions:**

1. Use timeout wrapper:

```typescript
const connectWithTimeout = async (ndk: NDK, ms = 10000) => {
	await Promise.race([ndk.connect(), new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))])
}
```

2. Try fewer relays:

```typescript
// Start with reliable relays only
const reliableRelays = ['wss://relay.damus.io']
const ndk = new NDK({ explicitRelayUrls: reliableRelays })
```

3. Add connection retry:

```typescript
const connectWithRetry = async (ndk: NDK, maxRetries = 3) => {
	for (let i = 0; i < maxRetries; i++) {
		try {
			await connectWithTimeout(ndk, 10000)
			return
		} catch (error) {
			console.log(`Retry ${i + 1}/${maxRetries}`)
			if (i === maxRetries - 1) throw error
		}
	}
}
```

### Problem: Subscription Memory Leak

**Symptoms:** App gets slower, memory usage increases

**Solutions:**

1. Always stop subscriptions (with TDZ protection):

```typescript
useEffect(() => {
	if (!ndk?.pool) return

	let isMounted = true
	const sub = ndk.subscribe(filter, { closeOnEose: false })

	sub.on('event', (event) => {
		if (!isMounted) return
		// handle event
	})

	// ← CRITICAL: cleanup with TDZ protection
	return () => {
		isMounted = false
		setTimeout(() => {
			try {
				sub.stop()
			} catch (error) {
				if (error instanceof ReferenceError) {
					console.warn('[NDK] Suppressed TDZ error')
				}
			}
		}, 100)
	}
}, [dependencies])
```

2. Track active subscriptions:

```typescript
const activeSubscriptions = new Set<NDKSubscription>()

const createSub = (filter: NDKFilter) => {
	const sub = ndk.subscribe(filter, { closeOnEose: false })
	activeSubscriptions.add(sub)
	return sub
}

const stopAllSubs = () => {
	activeSubscriptions.forEach((sub) => sub.stop())
	activeSubscriptions.clear()
}
```

### Problem: Profile Not Found

**Symptoms:** fetchProfile() returns null/undefined

**Solutions:**

1. Check different relays:

```typescript
// Add more relay URLs
const ndk = new NDK({
	explicitRelayUrls: ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol'],
})
```

2. Verify pubkey format:

```typescript
// Ensure correct format
if (pubkey.startsWith('npub')) {
	const user = ndk.getUser({ npub: pubkey })
} else if (/^[0-9a-f]{64}$/.test(pubkey)) {
	const user = ndk.getUser({ hexpubkey: pubkey })
}
```

3. Handle missing profiles gracefully:

```typescript
const profile = await user.fetchProfile()
const displayName = profile?.name || profile?.displayName || 'Anonymous'
const avatar = profile?.picture || '/default-avatar.png'
```

### Problem: Events Published But Not Visible

**Symptoms:** publish() succeeds but event not found in queries

**Solutions:**

1. Verify event was signed:

```typescript
await event.sign()
console.log('Event ID:', event.id) // Should be set
console.log('Signature:', event.sig) // Should exist
```

2. Check relay acceptance:

```typescript
const relays = await event.publish()
console.log('Published to relays:', relays)
```

3. Query immediately after publish:

```typescript
await event.publish()

// Wait a moment for relay propagation
await new Promise((resolve) => setTimeout(resolve, 1000))

const found = await ndk.fetchEvents({ ids: [event.id] })
console.log('Event found:', found.size > 0)
```

### Problem: NIP-46 Connection Fails

**Symptoms:** Remote signer connection times out or fails

**Solutions:**

1. Verify bunker URL format:

```typescript
// Correct format: bunker://<remote-pubkey>?relay=wss://...
const isValidBunkerUrl = (url: string) => {
	return url.startsWith('bunker://') && url.includes('?relay=')
}
```

2. Ensure local signer is ready:

```typescript
const localSigner = new NDKPrivateKeySigner(privateKey)
await localSigner.blockUntilReady()

const remoteSigner = new NDKNip46Signer(ndk, bunkerUrl, localSigner)
await remoteSigner.blockUntilReady()
```

3. Store credentials for reconnection:

```typescript
// Save for future sessions
localStorage.setItem('local-signer-key', localSigner.privateKey)
localStorage.setItem('bunker-url', bunkerUrl)
```

## Performance Tips

### Optimize Queries

```typescript
// ❌ Slow: Multiple sequential queries
const products = await ndk.fetchEvents({ kinds: [30402], authors: [pk1] })
const orders = await ndk.fetchEvents({ kinds: [16], authors: [pk1] })
const profiles = await ndk.fetchEvents({ kinds: [0], authors: [pk1] })

// ✅ Fast: Parallel queries
const [products, orders, profiles] = await Promise.all([
	ndk.fetchEvents({ kinds: [30402], authors: [pk1] }),
	ndk.fetchEvents({ kinds: [16], authors: [pk1] }),
	ndk.fetchEvents({ kinds: [0], authors: [pk1] }),
])
```

### Cache Profile Lookups

```typescript
const profileCache = new Map<string, NDKUserProfile>()

const getCachedProfile = async (ndk: NDK, pubkey: string) => {
	if (profileCache.has(pubkey)) {
		return profileCache.get(pubkey)!
	}

	const user = ndk.getUser({ hexpubkey: pubkey })
	const profile = await user.fetchProfile()
	if (profile) {
		profileCache.set(pubkey, profile)
	}

	return profile
}
```

### Limit Result Sets

```typescript
// Always use limit to prevent over-fetching
const filter: NDKFilter = {
	kinds: [1],
	authors: [pubkey],
	limit: 50, // ← Important!
}
```

### Debounce Subscription Updates

```typescript
import { debounce } from 'lodash'

const debouncedUpdate = debounce((event: NDKEvent) => {
	handleEvent(event)
}, 300)

sub.on('event', debouncedUpdate)
```

## Testing Tips

### Mock NDK in Tests

```typescript
const mockNDK = {
	fetchEvents: vi.fn().mockResolvedValue(new Set()),
	subscribe: vi.fn().mockReturnValue({
		on: vi.fn(),
		stop: vi.fn(),
	}),
	signer: {
		user: vi.fn().mockResolvedValue({ pubkey: 'test-pubkey' }),
	},
} as unknown as NDK
```

### Test Event Creation

```typescript
const createTestEvent = (overrides?: Partial<NDKEvent>): NDKEvent => {
	return {
		id: 'test-id',
		kind: 1,
		content: 'test content',
		tags: [],
		created_at: Math.floor(Date.now() / 1000),
		pubkey: 'test-pubkey',
		sig: 'test-sig',
		...overrides,
	} as NDKEvent
}
```

---

For more detailed information, see:

- `ndk-skill.md` - Complete reference
- `quick-reference.md` - Quick lookup
- `examples/` - Code examples
