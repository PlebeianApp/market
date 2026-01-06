/**
 * NDK Query and Subscription Patterns
 *
 * Examples from: src/queries/orders.tsx, src/queries/payment.tsx
 */

import NDK, { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk'

// ============================================================
// BASIC FETCH (ONE-TIME QUERY)
// ============================================================

const fetchNotes = async (ndk: NDK, authorPubkey: string, limit: number = 50) => {
	const filter: NDKFilter = {
		kinds: [1], // Text notes
		authors: [authorPubkey],
		limit,
	}

	// Fetch returns a Set
	const events = await ndk.fetchEvents(filter)

	// Convert to array and sort by timestamp
	const eventArray = Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

	return eventArray
}

// ============================================================
// FETCH WITH MULTIPLE FILTERS
// ============================================================

const fetchProductsByMultipleAuthors = async (ndk: NDK, pubkeys: string[]) => {
	const filter: NDKFilter = {
		kinds: [30402], // Product listings
		authors: pubkeys,
		limit: 100,
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events)
}

// ============================================================
// FETCH WITH TAG FILTERS
// ============================================================

const fetchOrderEvents = async (ndk: NDK, orderId: string) => {
	const filter: NDKFilter = {
		kinds: [16, 17], // Order and payment receipt
		'#order': [orderId], // Tag filter (note the # prefix)
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events)
}

// ============================================================
// FETCH WITH TIME RANGE
// ============================================================

const fetchRecentEvents = async (ndk: NDK, kind: number, hoursAgo: number = 24) => {
	const now = Math.floor(Date.now() / 1000)
	const since = now - hoursAgo * 3600

	const filter: NDKFilter = {
		kinds: [kind],
		since,
		until: now,
		limit: 100,
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events)
}

// ============================================================
// FETCH BY EVENT ID
// ============================================================

const fetchEventById = async (ndk: NDK, eventId: string) => {
	const filter: NDKFilter = {
		ids: [eventId],
	}

	const events = await ndk.fetchEvents(filter)

	if (events.size === 0) {
		return null
	}

	return Array.from(events)[0]
}

// ============================================================
// BASIC SUBSCRIPTION (REAL-TIME)
// ============================================================

const subscribeToNotes = (ndk: NDK, authorPubkey: string, onEvent: (event: NDKEvent) => void): NDKSubscription => {
	const filter: NDKFilter = {
		kinds: [1],
		authors: [authorPubkey],
	}

	const subscription = ndk.subscribe(filter, {
		closeOnEose: false, // Keep open for real-time updates
	})

	// Event handler
	subscription.on('event', (event: NDKEvent) => {
		onEvent(event)
	})

	// EOSE (End of Stored Events) handler
	subscription.on('eose', () => {
		console.log('✅ Received all stored events')
	})

	return subscription
}

// ============================================================
// SUBSCRIPTION WITH CLEANUP
// ============================================================

const createManagedSubscription = (
	ndk: NDK,
	filter: NDKFilter,
	handlers: {
		onEvent: (event: NDKEvent) => void
		onEose?: () => void
		onClose?: () => void
	},
) => {
	const subscription = ndk.subscribe(filter, { closeOnEose: false })

	subscription.on('event', handlers.onEvent)

	if (handlers.onEose) {
		subscription.on('eose', handlers.onEose)
	}

	if (handlers.onClose) {
		subscription.on('close', handlers.onClose)
	}

	// Return cleanup function
	return () => {
		subscription.stop()
		console.log('✅ Subscription stopped')
	}
}

// ============================================================
// MONITORING SPECIFIC EVENT
// ============================================================

const monitorPaymentReceipt = (
	ndk: NDK,
	orderId: string,
	invoiceId: string,
	onPaymentReceived: (preimage: string) => void,
): NDKSubscription => {
	const sessionStart = Math.floor(Date.now() / 1000)

	const filter: NDKFilter = {
		kinds: [17], // Payment receipt
		'#order': [orderId],
		'#payment-request': [invoiceId],
		since: sessionStart - 30, // 30 second buffer for clock skew
	}

	const subscription = ndk.subscribe(filter, { closeOnEose: false })

	subscription.on('event', (event: NDKEvent) => {
		// Verify event is recent
		if (event.created_at && event.created_at < sessionStart - 30) {
			console.log('⏰ Ignoring old receipt')
			return
		}

		// Verify it's the correct invoice
		const paymentRequestTag = event.tags.find((tag) => tag[0] === 'payment-request')
		if (paymentRequestTag?.[1] !== invoiceId) {
			return
		}

		// Extract preimage
		const paymentTag = event.tags.find((tag) => tag[0] === 'payment')
		const preimage = paymentTag?.[3] || 'external-payment'

		console.log('✅ Payment received!')
		subscription.stop()
		onPaymentReceived(preimage)
	})

	return subscription
}

// ============================================================
// REACT INTEGRATION PATTERN
// ============================================================

import { useEffect, useState } from 'react'

function useOrderSubscription(ndk: NDK | null, orderId: string) {
	const [events, setEvents] = useState<NDKEvent[]>([])
	const [eosed, setEosed] = useState(false)

	useEffect(() => {
		if (!ndk || !orderId) return

		const filter: NDKFilter = {
			kinds: [16, 17],
			'#order': [orderId],
		}

		const subscription = ndk.subscribe(filter, { closeOnEose: false })

		subscription.on('event', (event: NDKEvent) => {
			setEvents((prev) => {
				// Avoid duplicates
				if (prev.some((e) => e.id === event.id)) {
					return prev
				}
				return [...prev, event].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
			})
		})

		subscription.on('eose', () => {
			setEosed(true)
		})

		// Cleanup on unmount
		return () => {
			subscription.stop()
		}
	}, [ndk, orderId])

	return { events, eosed }
}

// ============================================================
// REACT QUERY INTEGRATION
// ============================================================

import { useQuery, useQueryClient } from '@tanstack/react-query'

// Query function
const fetchProducts = async (ndk: NDK, pubkey: string) => {
	if (!ndk) throw new Error('NDK not initialized')

	const filter: NDKFilter = {
		kinds: [30402],
		authors: [pubkey],
	}

	const events = await ndk.fetchEvents(filter)
	return Array.from(events)
}

// Hook with subscription for real-time updates
function useProductsWithSubscription(ndk: NDK | null, pubkey: string) {
	const queryClient = useQueryClient()

	// Initial query
	const query = useQuery({
		queryKey: ['products', pubkey],
		queryFn: () => fetchProducts(ndk!, pubkey),
		enabled: !!ndk && !!pubkey,
		staleTime: 30000,
	})

	// Real-time subscription
	useEffect(() => {
		if (!ndk || !pubkey) return

		const filter: NDKFilter = {
			kinds: [30402],
			authors: [pubkey],
		}

		const subscription = ndk.subscribe(filter, { closeOnEose: false })

		subscription.on('event', () => {
			// Invalidate query to trigger refetch
			queryClient.invalidateQueries({ queryKey: ['products', pubkey] })
		})

		return () => {
			subscription.stop()
		}
	}, [ndk, pubkey, queryClient])

	return query
}

// ============================================================
// ADVANCED: WAITING FOR SPECIFIC EVENT
// ============================================================

const waitForEvent = (
	ndk: NDK,
	filter: NDKFilter,
	condition: (event: NDKEvent) => boolean,
	timeoutMs: number = 30000,
): Promise<NDKEvent | null> => {
	return new Promise((resolve) => {
		const subscription = ndk.subscribe(filter, { closeOnEose: false })

		// Timeout
		const timeout = setTimeout(() => {
			subscription.stop()
			resolve(null)
		}, timeoutMs)

		// Event handler
		subscription.on('event', (event: NDKEvent) => {
			if (condition(event)) {
				clearTimeout(timeout)
				subscription.stop()
				resolve(event)
			}
		})
	})
}

// Usage example
async function waitForPayment(ndk: NDK, orderId: string, invoiceId: string) {
	const paymentEvent = await waitForEvent(
		ndk,
		{
			kinds: [17],
			'#order': [orderId],
			since: Math.floor(Date.now() / 1000),
		},
		(event) => {
			const tag = event.tags.find((t) => t[0] === 'payment-request')
			return tag?.[1] === invoiceId
		},
		60000, // 60 second timeout
	)

	if (paymentEvent) {
		console.log('✅ Payment confirmed!')
		return paymentEvent
	} else {
		console.log('⏰ Payment timeout')
		return null
	}
}

// ============================================================
// USAGE EXAMPLES
// ============================================================

async function queryExample(ndk: NDK) {
	// Fetch notes
	const notes = await fetchNotes(ndk, 'pubkey123', 50)
	console.log(`Found ${notes.length} notes`)

	// Subscribe to new notes
	const cleanup = subscribeToNotes(ndk, 'pubkey123', (event) => {
		console.log('New note:', event.content)
	})

	// Clean up after 60 seconds
	setTimeout(cleanup, 60000)

	// Monitor payment
	monitorPaymentReceipt(ndk, 'order-123', 'invoice-456', (preimage) => {
		console.log('Payment received:', preimage)
	})
}

export {
	fetchNotes,
	fetchProductsByMultipleAuthors,
	fetchOrderEvents,
	fetchRecentEvents,
	fetchEventById,
	subscribeToNotes,
	createManagedSubscription,
	monitorPaymentReceipt,
	useOrderSubscription,
	useProductsWithSubscription,
	waitForEvent,
}
