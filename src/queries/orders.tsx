import { ORDER_GENERAL_KIND, ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, ORDER_STATUS, PAYMENT_RECEIPT_KIND } from '@/lib/schemas/order'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'
import { orderKeys } from './queryKeyFactory'
import { authStore } from '@/lib/stores/auth'

export type OrderWithRelatedEvents = {
	order: NDKEvent // The original order creation event (kind 16, type 1)
	paymentRequests: NDKEvent[] // Payment requests (kind 16, type 2)
	statusUpdates: NDKEvent[] // Status updates (kind 16, type 3)
	shippingUpdates: NDKEvent[] // Shipping updates (kind 16, type 4)
	generalMessages: NDKEvent[] // General communication (kind 14)
	paymentReceipts: NDKEvent[] // Payment receipts (kind 17)

	// Latest events of each type
	latestStatus?: NDKEvent
	latestShipping?: NDKEvent
	latestPaymentRequest?: NDKEvent
	latestPaymentReceipt?: NDKEvent
	latestMessage?: NDKEvent
}

/**
 * Fetches all orders where the current user is either a buyer or seller
 */
export const fetchOrders = async (): Promise<OrderWithRelatedEvents[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const user = ndk.activeUser
	if (!user) throw new Error('No active user')

	// Fetch orders where the current user is involved (either as sender or recipient of encrypted DMs)
	const orderCreationFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#type': [ORDER_MESSAGE_TYPE.ORDER_CREATION],
		authors: [user.pubkey],
		limit: 100,
	}

	const orderReceivedFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#type': [ORDER_MESSAGE_TYPE.ORDER_CREATION],
		'#p': [user.pubkey],
		limit: 100,
	}

	const ordersSent = await ndk.fetchEvents(orderCreationFilter)
	const ordersReceived = await ndk.fetchEvents(orderReceivedFilter)

	// Combine all orders
	const allOrders = new Set<NDKEvent>([...Array.from(ordersSent), ...Array.from(ordersReceived)])
	if (allOrders.size === 0) return []

	// Get all order IDs from the 'order' tag
	const orderIds = Array.from(allOrders)
		.map((order) => {
			const orderTag = order.tags.find((tag) => tag[0] === 'order')
			return orderTag?.[1]
		})
		.filter(Boolean) as string[]

	if (orderIds.length === 0) return []

	// Fetch all related events for these orders
	const relatedEventsFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
		'#order': orderIds,
		limit: 500,
	}

	const relatedEvents = await ndk.fetchEvents(relatedEventsFilter)
	if (relatedEvents.size === 0) {
		// Return just the order creation events if no related events found
		return Array.from(allOrders).map((order) => ({
			order,
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}))
	}

	// Group events by order ID and type
	const eventsByOrderId: Record<
		string,
		{
			paymentRequests: NDKEvent[]
			statusUpdates: NDKEvent[]
			shippingUpdates: NDKEvent[]
			generalMessages: NDKEvent[]
			paymentReceipts: NDKEvent[]
		}
	> = {}

	// Initialize with empty arrays for each order ID
	orderIds.forEach((orderId) => {
		eventsByOrderId[orderId] = {
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}
	})

	// Categorize each event
	for (const event of Array.from(relatedEvents)) {
		const orderTag = event.tags.find((tag) => tag[0] === 'order')
		if (!orderTag?.[1]) continue

		const orderId = orderTag[1]
		if (!eventsByOrderId[orderId]) continue

		// Categorize by kind and type
		if (event.kind === ORDER_PROCESS_KIND) {
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			if (typeTag) {
				switch (typeTag[1]) {
					case ORDER_MESSAGE_TYPE.PAYMENT_REQUEST:
						eventsByOrderId[orderId].paymentRequests.push(event)
						break
					case ORDER_MESSAGE_TYPE.STATUS_UPDATE:
						eventsByOrderId[orderId].statusUpdates.push(event)
						break
					case ORDER_MESSAGE_TYPE.SHIPPING_UPDATE:
						eventsByOrderId[orderId].shippingUpdates.push(event)
						break
					// Skip ORDER_CREATION as we already have those events
				}
			}
		} else if (event.kind === ORDER_GENERAL_KIND) {
			eventsByOrderId[orderId].generalMessages.push(event)
		} else if (event.kind === PAYMENT_RECEIPT_KIND) {
			eventsByOrderId[orderId].paymentReceipts.push(event)
		}
	}

	// Create the combined order objects
	return Array.from(allOrders).map((order) => {
		const orderTag = order.tags.find((tag) => tag[0] === 'order')
		if (!orderTag?.[1]) {
			return {
				order,
				paymentRequests: [],
				statusUpdates: [],
				shippingUpdates: [],
				generalMessages: [],
				paymentReceipts: [],
			}
		}

		const orderId = orderTag[1]
		const related = eventsByOrderId[orderId] || {
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}

		// Sort all events by created_at (newest first)
		related.paymentRequests.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.statusUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.shippingUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.generalMessages.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.paymentReceipts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

		return {
			order,
			paymentRequests: related.paymentRequests,
			statusUpdates: related.statusUpdates,
			shippingUpdates: related.shippingUpdates,
			generalMessages: related.generalMessages,
			paymentReceipts: related.paymentReceipts,
			latestStatus: related.statusUpdates[0],
			latestShipping: related.shippingUpdates[0],
			latestPaymentRequest: related.paymentRequests[0],
			latestPaymentReceipt: related.paymentReceipts[0],
			latestMessage: related.generalMessages[0],
		}
	})
}

/**
 * Hook to fetch all orders for the current user (as buyer or seller)
 */
export const useOrders = () => {
	const ndk = ndkActions.getNDK()
	const { user } = authStore
	const isConnected = !!ndk?.activeUser

	return useQuery({
		queryKey: orderKeys.all,
		queryFn: fetchOrders,
		enabled: !!user?.pubkey,
	})
}

/**
 * Fetches orders where the specified user is the buyer
 */
export const fetchOrdersByBuyer = async (buyerPubkey: string): Promise<OrderWithRelatedEvents[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	if (!buyerPubkey) {
		console.warn('fetchOrdersByBuyer: buyerPubkey is empty, returning empty array')
		return []
	}

	// Orders where the specified user is the author (buyer sending order to merchant)
	const orderCreationFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#type': [ORDER_MESSAGE_TYPE.ORDER_CREATION],
		authors: [buyerPubkey],
		limit: 100,
	}

	let orders: Set<NDKEvent>
	try {
		// Use subscription with closeOnEose to ensure we get EOSE signal
		const ordersSet = new Set<NDKEvent>()
		const subscription = ndk.subscribe(orderCreationFilter, {
			closeOnEose: true,
		})

		subscription.on('event', (event: NDKEvent) => {
			ordersSet.add(event)
		})

		// Wait for EOSE or timeout
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				subscription.stop()
				reject(new Error('fetchOrdersByBuyer timeout after 10s'))
			}, 10000)

			subscription.on('eose', () => {
				clearTimeout(timeout)
				subscription.stop()
				resolve()
			})

			subscription.on('close', () => {
				clearTimeout(timeout)
				resolve()
			})
		})

		orders = ordersSet
	} catch (error) {
		console.error('🔍 fetchOrdersByBuyer: Error fetching orders:', error)
		throw error
	}

	if (orders.size === 0) return []

	// Get all order IDs
	const orderIds = Array.from(orders)
		.map((order) => {
			const orderTag = order.tags.find((tag) => tag[0] === 'order')
			return orderTag?.[1]
		})
		.filter(Boolean) as string[]

	if (orderIds.length === 0) return []

	// Fetch all related events for these orders
	const relatedEventsFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
		'#order': orderIds,
		limit: 500,
	}

	const relatedEvents = await ndk.fetchEvents(relatedEventsFilter)

	// Group and process events similar to fetchOrders
	const eventsByOrderId: Record<
		string,
		{
			paymentRequests: NDKEvent[]
			statusUpdates: NDKEvent[]
			shippingUpdates: NDKEvent[]
			generalMessages: NDKEvent[]
			paymentReceipts: NDKEvent[]
		}
	> = {}

	// Initialize with empty arrays for each order ID
	orderIds.forEach((orderId) => {
		eventsByOrderId[orderId] = {
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}
	})

	// Categorize each event
	for (const event of Array.from(relatedEvents)) {
		const orderTag = event.tags.find((tag) => tag[0] === 'order')
		if (!orderTag?.[1]) continue

		const orderId = orderTag[1]
		if (!eventsByOrderId[orderId]) continue

		// Categorize by kind and type
		if (event.kind === ORDER_PROCESS_KIND) {
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			if (typeTag) {
				switch (typeTag[1]) {
					case ORDER_MESSAGE_TYPE.PAYMENT_REQUEST:
						eventsByOrderId[orderId].paymentRequests.push(event)
						break
					case ORDER_MESSAGE_TYPE.STATUS_UPDATE:
						eventsByOrderId[orderId].statusUpdates.push(event)
						break
					case ORDER_MESSAGE_TYPE.SHIPPING_UPDATE:
						eventsByOrderId[orderId].shippingUpdates.push(event)
						break
				}
			}
		} else if (event.kind === ORDER_GENERAL_KIND) {
			eventsByOrderId[orderId].generalMessages.push(event)
		} else if (event.kind === PAYMENT_RECEIPT_KIND) {
			eventsByOrderId[orderId].paymentReceipts.push(event)
		}
	}

	// Create the combined order objects
	return Array.from(orders).map((order) => {
		const orderTag = order.tags.find((tag) => tag[0] === 'order')
		if (!orderTag?.[1]) {
			return {
				order,
				paymentRequests: [],
				statusUpdates: [],
				shippingUpdates: [],
				generalMessages: [],
				paymentReceipts: [],
			}
		}

		const orderId = orderTag[1]
		const related = eventsByOrderId[orderId] || {
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}

		// Sort all events by created_at (newest first)
		related.paymentRequests.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.statusUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.shippingUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.generalMessages.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.paymentReceipts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

		return {
			order,
			paymentRequests: related.paymentRequests,
			statusUpdates: related.statusUpdates,
			shippingUpdates: related.shippingUpdates,
			generalMessages: related.generalMessages,
			paymentReceipts: related.paymentReceipts,
			latestStatus: related.statusUpdates[0],
			latestShipping: related.shippingUpdates[0],
			latestPaymentRequest: related.paymentRequests[0],
			latestPaymentReceipt: related.paymentReceipts[0],
			latestMessage: related.generalMessages[0],
		}
	})
}

/**
 * Hook to fetch orders where the specified user is the buyer
 */
export const useOrdersByBuyer = (buyerPubkey: string) => {
	return useQuery({
		queryKey: orderKeys.byBuyer(buyerPubkey),
		queryFn: () => fetchOrdersByBuyer(buyerPubkey),
		enabled: !!buyerPubkey,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}

/**
 * Fetches orders where the specified user is the seller (recipient of order messages)
 */
export const fetchOrdersBySeller = async (sellerPubkey: string): Promise<OrderWithRelatedEvents[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	if (!sellerPubkey) {
		console.warn('fetchOrdersBySeller: sellerPubkey is empty, returning empty array')
		return []
	}

	// Orders where the specified user is the recipient (merchant receiving orders)
	const orderReceivedFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#type': [ORDER_MESSAGE_TYPE.ORDER_CREATION],
		'#p': [sellerPubkey],
		limit: 100,
	}

	console.log('🔍 fetchOrdersBySeller: Querying for orders with filter:', {
		sellerPubkey: sellerPubkey.substring(0, 8) + '...',
		filter: orderReceivedFilter,
		relayUrls: ndk.explicitRelayUrls || ndk.pool?.relays ? Array.from(ndk.pool.relays.keys()) : [],
	})

	let orders: Set<NDKEvent>
	try {
		// Use subscription with closeOnEose to ensure we get EOSE signal
		const ordersSet = new Set<NDKEvent>()
		const subscription = ndk.subscribe(orderReceivedFilter, {
			closeOnEose: true,
		})

		subscription.on('event', (event: NDKEvent) => {
			ordersSet.add(event)
		})

		// Wait for EOSE or timeout - use race to ensure we don't wait too long
		await Promise.race([
			new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					subscription.stop()
					resolve()
				}, 2500) // 2.5 second timeout - fast enough for good UX

				subscription.on('eose', () => {
					clearTimeout(timeout)
					subscription.stop()
					resolve()
				})

				subscription.on('close', () => {
					clearTimeout(timeout)
					resolve()
				})

				// Start the subscription explicitly
				subscription.start()
			}),
			// Fallback timeout to ensure we never wait more than 3s total
			new Promise<void>((resolve) => {
				setTimeout(() => {
					subscription.stop()
					resolve()
				}, 3000)
			})
		])

		orders = ordersSet
		console.log(`🔍 fetchOrdersBySeller: Found ${orders.size} order creation events`)
	} catch (error) {
		console.error('🔍 fetchOrdersBySeller: Error fetching orders:', error)
		orders = new Set()
	}

	if (orders.size === 0) {
		console.log('🔍 fetchOrdersBySeller: No orders found, returning empty array')
		return []
	}

	// Get all order IDs
	const orderIds = Array.from(orders)
		.map((order) => {
			const orderTag = order.tags.find((tag) => tag[0] === 'order')
			return orderTag?.[1]
		})
		.filter(Boolean) as string[]

	console.log(`🔍 fetchOrdersBySeller: Extracted ${orderIds.length} order IDs:`, orderIds.map(id => id.substring(0, 8) + '...'))

	if (orderIds.length === 0) {
		console.log('🔍 fetchOrdersBySeller: No order IDs found in events, returning empty array')
		return []
	}

	// Fetch all related events for these orders
	const relatedEventsFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
		'#order': orderIds,
		limit: 500,
	}

	console.log(`🔍 fetchOrdersBySeller: Fetching related events for ${orderIds.length} orders`)

	// Fetch related events with a very short timeout
	// Related events (status updates, payment receipts) are nice to have but not critical for initial display
	let relatedEvents: Set<NDKEvent> = new Set()
	try {
		const relatedEventsSet = new Set<NDKEvent>()
		const subscription = ndk.subscribe(relatedEventsFilter, {
			closeOnEose: true,
		})

		subscription.on('event', (event: NDKEvent) => {
			relatedEventsSet.add(event)
		})

		// Wait for EOSE or timeout - very short timeout since related events aren't critical for initial display
		await Promise.race([
			new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					subscription.stop()
					resolve()
				}, 800) // 800ms timeout - fast enough for good UX

				subscription.on('eose', () => {
					clearTimeout(timeout)
					subscription.stop()
					resolve()
				})

				subscription.on('close', () => {
					clearTimeout(timeout)
					resolve()
				})

				// Start the subscription
				subscription.start()
			}),
			// Fallback timeout to ensure we never wait more than 1.2s total
			new Promise<void>((resolve) => {
				setTimeout(() => {
					subscription.stop()
					resolve()
				}, 1200)
			})
		])

		relatedEvents = relatedEventsSet
		console.log(`🔍 fetchOrdersBySeller: Found ${relatedEvents.size} related events`)
	} catch (error) {
		console.error('🔍 fetchOrdersBySeller: Error fetching related events:', error)
		relatedEvents = new Set()
	}

	// Group and process events similar to fetchOrders
	const eventsByOrderId: Record<
		string,
		{
			paymentRequests: NDKEvent[]
			statusUpdates: NDKEvent[]
			shippingUpdates: NDKEvent[]
			generalMessages: NDKEvent[]
			paymentReceipts: NDKEvent[]
		}
	> = {}

	// Initialize with empty arrays for each order ID
	orderIds.forEach((orderId) => {
		eventsByOrderId[orderId] = {
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}
	})

	// Categorize each event
	for (const event of Array.from(relatedEvents)) {
		const orderTag = event.tags.find((tag) => tag[0] === 'order')
		if (!orderTag?.[1]) continue

		const orderId = orderTag[1]
		if (!eventsByOrderId[orderId]) continue

		// Categorize by kind and type
		if (event.kind === ORDER_PROCESS_KIND) {
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			if (typeTag) {
				switch (typeTag[1]) {
					case ORDER_MESSAGE_TYPE.PAYMENT_REQUEST:
						eventsByOrderId[orderId].paymentRequests.push(event)
						break
					case ORDER_MESSAGE_TYPE.STATUS_UPDATE:
						eventsByOrderId[orderId].statusUpdates.push(event)
						break
					case ORDER_MESSAGE_TYPE.SHIPPING_UPDATE:
						eventsByOrderId[orderId].shippingUpdates.push(event)
						break
				}
			}
		} else if (event.kind === ORDER_GENERAL_KIND) {
			eventsByOrderId[orderId].generalMessages.push(event)
		} else if (event.kind === PAYMENT_RECEIPT_KIND) {
			eventsByOrderId[orderId].paymentReceipts.push(event)
		}
	}

	// Create the combined order objects
	const result = Array.from(orders).map((order) => {
		const orderTag = order.tags.find((tag) => tag[0] === 'order')
		if (!orderTag?.[1]) {
			return {
				order,
				paymentRequests: [],
				statusUpdates: [],
				shippingUpdates: [],
				generalMessages: [],
				paymentReceipts: [],
			}
		}

		const orderId = orderTag[1]
		const related = eventsByOrderId[orderId] || {
			paymentRequests: [],
			statusUpdates: [],
			shippingUpdates: [],
			generalMessages: [],
			paymentReceipts: [],
		}

		// Sort all events by created_at (newest first)
		related.paymentRequests.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.statusUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.shippingUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.generalMessages.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		related.paymentReceipts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

		return {
			order,
			paymentRequests: related.paymentRequests,
			statusUpdates: related.statusUpdates,
			shippingUpdates: related.shippingUpdates,
			generalMessages: related.generalMessages,
			paymentReceipts: related.paymentReceipts,
			latestStatus: related.statusUpdates[0],
			latestShipping: related.shippingUpdates[0],
			latestPaymentRequest: related.paymentRequests[0],
			latestPaymentReceipt: related.paymentReceipts[0],
			latestMessage: related.generalMessages[0],
		}
	})

	console.log(`🔍 fetchOrdersBySeller: Returning ${result.length} orders`)
	return result
}

/**
 * Hook to fetch orders where the specified user is the seller
 */
export const useOrdersBySeller = (sellerPubkey: string) => {
	const ndk = ndkActions.getNDK()
	const ndkState = useStore(ndkStore)
	const isConnected = ndkState.isConnected
	
	console.log('🔍 useOrdersBySeller hook:', {
		sellerPubkey: sellerPubkey?.substring(0, 8) + '...',
		hasPubkey: !!sellerPubkey,
		ndkInitialized: !!ndk,
		ndkConnected: isConnected,
		willEnable: !!sellerPubkey && !!ndk && isConnected,
	})

	return useQuery({
		queryKey: orderKeys.bySeller(sellerPubkey),
		queryFn: () => {
			console.log('🔍 useOrdersBySeller: queryFn executing for sellerPubkey:', sellerPubkey?.substring(0, 8) + '...')
			return fetchOrdersBySeller(sellerPubkey)
		},
		enabled: !!sellerPubkey && !!ndk && isConnected,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		staleTime: 30000, // Consider data fresh for 30 seconds
		gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
	})
}

/**
 * Fetches a specific order by its ID
 */
export const fetchOrderById = async (orderId: string): Promise<OrderWithRelatedEvents | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Check if we have a UUID format or a hash format
	const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(orderId)
	const isHash = /^[0-9a-f]{64}$/.test(orderId)

	// Fetch order creation event
	const orderFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#type': [ORDER_MESSAGE_TYPE.ORDER_CREATION],
	}

	// Add the appropriate filter depending on what type of ID we have
	if (isUuid) {
		// If it's a UUID, it's in the order tag
		orderFilter['#order'] = [orderId]
	} else if (isHash) {
		// If it's a hash, it could be the event ID
		orderFilter.ids = [orderId]
	} else {
		// Try both just in case
		orderFilter['#order'] = [orderId]
	}

	const orderEvents = await ndk.fetchEvents(orderFilter)
	if (orderEvents.size === 0) return null

	const orderEvent = Array.from(orderEvents)[0] // Take the first matching order event

	// Fetch all related events for this order
	const relatedEventsFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
	}

	// Get the order ID from the order tag
	const orderIdFromTag = orderEvent.tags.find((tag) => tag[0] === 'order')?.[1]
	const eventId = orderEvent.id

	// Add the appropriate filters
	if (orderIdFromTag) {
		relatedEventsFilter['#order'] = [orderIdFromTag]
	}

	// Create a subscription to make sure we're getting real-time updates
	const sub = ndk.subscribe(relatedEventsFilter, {
		closeOnEose: false, // Keep subscription open
	})

	// Set up event handler for new status updates
	sub.on('event', (event) => {
		// Process updates if needed
	})

	// Wait for at least the initial batch of events
	await new Promise<void>((resolve) => {
		const timeout = setTimeout(() => resolve(), 2000) // Max 2 seconds wait
		sub.on('eose', () => {
			clearTimeout(timeout)
			resolve()
		})
	})

	// Get all events from the subscription
	const relatedEvents = await ndk.fetchEvents(relatedEventsFilter)

	// Also check for status updates referencing this order's event ID
	const statusByEventIdFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#type': [ORDER_MESSAGE_TYPE.STATUS_UPDATE],
		'#order': [eventId], // Using the event ID as order reference
	}

	const statusByEventId = await ndk.fetchEvents(statusByEventIdFilter)

	// Also check for shipping updates referencing this order's event ID
	const shippingByEventIdFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#type': [ORDER_MESSAGE_TYPE.SHIPPING_UPDATE],
		'#order': [eventId], // Using the event ID as order reference
	}

	const shippingByEventId = await ndk.fetchEvents(shippingByEventIdFilter)

	// Combine all sets of events
	for (const event of Array.from(statusByEventId)) {
		relatedEvents.add(event)
	}

	for (const event of Array.from(shippingByEventId)) {
		relatedEvents.add(event)
	}

	// Group by type with improved deduplication
	const paymentRequests: NDKEvent[] = []
	const statusUpdates: NDKEvent[] = []
	const shippingUpdates: NDKEvent[] = []
	const generalMessages: NDKEvent[] = []
	const paymentReceipts: NDKEvent[] = []

	// Create a Set to track processed event IDs for deduplication
	const processedEventIds = new Set<string>()

	for (const event of Array.from(relatedEvents)) {
		// Skip the order creation event and any duplicate events
		if (event.id === orderEvent.id || processedEventIds.has(event.id)) continue

		// Mark this event as processed
		processedEventIds.add(event.id)

		// Categorize by kind and type
		if (event.kind === ORDER_PROCESS_KIND) {
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			if (typeTag) {
				switch (typeTag[1]) {
					case ORDER_MESSAGE_TYPE.PAYMENT_REQUEST:
						paymentRequests.push(event)
						break
					case ORDER_MESSAGE_TYPE.STATUS_UPDATE:
						statusUpdates.push(event)
						break
					case ORDER_MESSAGE_TYPE.SHIPPING_UPDATE:
						shippingUpdates.push(event)
						break
				}
			}
		} else if (event.kind === ORDER_GENERAL_KIND) {
			generalMessages.push(event)
		} else if (event.kind === PAYMENT_RECEIPT_KIND) {
			paymentReceipts.push(event)
		}
	}

	// Sort all events by created_at (newest first)
	paymentRequests.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
	statusUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
	shippingUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
	generalMessages.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
	paymentReceipts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

	return {
		order: orderEvent,
		paymentRequests,
		statusUpdates,
		shippingUpdates,
		generalMessages,
		paymentReceipts,
		latestStatus: statusUpdates[0],
		latestShipping: shippingUpdates[0],
		latestPaymentRequest: paymentRequests[0],
		latestPaymentReceipt: paymentReceipts[0],
		latestMessage: generalMessages[0],
	}
}

/**
 * Hook to fetch a specific order by its ID
 */
export const useOrderById = (orderId: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()

	// Set up a live subscription to monitor events for this order
	useEffect(() => {
		if (!orderId || !ndk) return

		// Subscription for all related events
		const relatedEventsFilter = {
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			'#order': [orderId],
		}

		const subscription = ndk.subscribe(relatedEventsFilter, {
			closeOnEose: false, // Keep subscription open
		})

		// Event handler for all events
		subscription.on('event', (newEvent) => {
			// If we get a status update, shipping update, or payment receipt, invalidate the query to refresh the data
			if (newEvent.kind === ORDER_PROCESS_KIND) {
				const typeTag = newEvent.tags.find((tag) => tag[0] === 'type')
				if (typeTag && (typeTag[1] === ORDER_MESSAGE_TYPE.STATUS_UPDATE || typeTag[1] === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE)) {
					queryClient.invalidateQueries({ queryKey: orderKeys.details(orderId) })
				}
			} else if (newEvent.kind === PAYMENT_RECEIPT_KIND) {
				// Payment receipt received - force immediate refetch to update payment status
				console.log('Payment receipt received, forcing immediate refetch:', newEvent.id)
				queryClient.invalidateQueries({ queryKey: orderKeys.details(orderId) })
				queryClient.refetchQueries({ queryKey: orderKeys.details(orderId) })
			}
		})

		// Clean up subscription when unmounting
		return () => {
			subscription.stop()
		}
	}, [orderId, ndk, queryClient])

	return useQuery({
		queryKey: orderKeys.details(orderId),
		queryFn: () => fetchOrderById(orderId),
		enabled: !!orderId,
		refetchInterval: 2000, // Poll every 2 seconds to ensure we get status updates
		staleTime: 500, // Consider data stale after just 500ms to ensure quick updates
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}

/**
 * Get the current status of an order based on its related events
 */
export const getOrderStatus = (order: OrderWithRelatedEvents): string => {
	// Deep clone the status updates to avoid modifying the original
	const statusUpdates = [...order.statusUpdates]
	const shippingUpdates = [...order.shippingUpdates]

	// Shipping updates no longer directly set order status.
	// Order status is determined solely by explicit status update events (Type 3).

	// Next, check status updates if no shipping rules applied
	if (statusUpdates.length > 0) {
		// Re-sort to ensure newest first
		statusUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		const latestStatusUpdate = statusUpdates[0]
		const statusTag = latestStatusUpdate.tags.find((tag) => tag[0] === 'status')

		if (statusTag?.[1]) {
			return statusTag[1]
		}
	}

	// Do not infer confirmation from payment receipts. Merchant must explicitly confirm via status update.

	// Default to pending if no other status is found
	return ORDER_STATUS.PENDING
}

/**
 * Get formatted date from event
 */
export const getEventDate = (event?: NDKEvent): string => {
	if (!event || !event.created_at) return '-'
	return new Date(event.created_at * 1000).toLocaleString('de-DE', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

/**
 * Get seller pubkey from order
 */
export const getSellerPubkey = (order: NDKEvent): string | undefined => {
	const recipientTag = order.tags.find((tag) => tag[0] === 'p')
	return recipientTag?.[1]
}

/**
 * Get buyer pubkey from order
 */
export const getBuyerPubkey = (order: NDKEvent): string | undefined => {
	return order.pubkey
}

/**
 * Get order ID from order
 */
export const getOrderId = (order: NDKEvent): string | undefined => {
	const orderTag = order.tags.find((tag) => tag[0] === 'order')
	return orderTag?.[1]
}

/**
 * Get total amount from order
 */
export const getOrderAmount = (order: NDKEvent): string | undefined => {
	const amountTag = order.tags.find((tag) => tag[0] === 'amount')
	return amountTag?.[1]
}

/**
 * Format a satoshi amount for display
 */
export const formatSats = (amount?: string): string => {
	if (!amount) return '-'
	return `${parseInt(amount).toLocaleString()} sats`
}
