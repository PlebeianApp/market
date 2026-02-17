import { ORDER_GENERAL_KIND, ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, ORDER_STATUS, PAYMENT_RECEIPT_KIND } from '@/lib/schemas/order'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { orderKeys } from './queryKeyFactory'

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
		authors: [user.pubkey],
		limit: 100,
	}

	const orderReceivedFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#p': [user.pubkey],
		limit: 100,
	}

	const ordersSent = await ndk.fetchEvents(orderCreationFilter)
	const ordersReceived = await ndk.fetchEvents(orderReceivedFilter)

	// Filter for ORDER_CREATION type programmatically (since relays reject multi-character tags)
	const filterByType = (events: Set<NDKEvent>, messageType: string) => {
		return Array.from(events).filter((event) => {
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			return typeTag?.[1] === messageType
		})
	}

	const filteredOrdersSent = filterByType(ordersSent, ORDER_MESSAGE_TYPE.ORDER_CREATION)
	const filteredOrdersReceived = filterByType(ordersReceived, ORDER_MESSAGE_TYPE.ORDER_CREATION)

	// Combine all orders
	const allOrders = new Set<NDKEvent>([...filteredOrdersSent, ...filteredOrdersReceived])
	if (allOrders.size === 0) return []

	// Get all order IDs from the 'order' tag
	const orderIds = Array.from(allOrders)
		.map((order) => {
			const orderTag = order.tags.find((tag) => tag[0] === 'order')
			return orderTag?.[1]
		})
		.filter(Boolean) as string[]

	if (orderIds.length === 0) return []

	// Collect all unique authors (buyers and sellers) from orders
	const authorsSet = new Set<string>()
	Array.from(allOrders).forEach((order) => {
		authorsSet.add(order.pubkey) // buyer
		const sellerTag = order.tags.find((tag) => tag[0] === 'p')
		if (sellerTag?.[1]) authorsSet.add(sellerTag[1]) // seller
	})
	const authors = Array.from(authorsSet)

	// Fetch related events authored by or referencing these users
	// This is much more efficient than fetching all events
	const relatedEventsFilters: NDKFilter[] = [
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			authors: authors, // Events created by buyers/sellers
			limit: 500,
		},
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			'#p': authors, // Events mentioning buyers/sellers
			limit: 500,
		},
	]

	// Fetch events from both filters in parallel
	const [eventsByAuthors, eventsByMentions] = await Promise.all([
		ndk.fetchEvents(relatedEventsFilters[0]),
		ndk.fetchEvents(relatedEventsFilters[1]),
	])

	// Combine and deduplicate
	const allEvents = new Set<NDKEvent>([...Array.from(eventsByAuthors), ...Array.from(eventsByMentions)])

	// Filter events by order ID programmatically
	const relatedEvents = new Set<NDKEvent>(
		Array.from(allEvents).filter((event) => {
			const orderTag = event.tags.find((tag) => tag[0] === 'order')
			return orderTag?.[1] && orderIds.includes(orderTag[1])
		}),
	)

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
	const isConnected = !!ndk?.activeUser

	return useQuery({
		queryKey: orderKeys.all,
		queryFn: fetchOrders,
		enabled: isConnected,
	})
}

/**
 * Fetches orders where the specified user is the buyer
 */
export const fetchOrdersByBuyer = async (buyerPubkey: string): Promise<OrderWithRelatedEvents[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Orders where the specified user is the author (buyer sending order to merchant)
	const orderCreationFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		authors: [buyerPubkey],
		limit: 100,
	}

	const allOrders = await ndk.fetchEvents(orderCreationFilter)

	// Filter for ORDER_CREATION type programmatically
	const orders = new Set<NDKEvent>(
		Array.from(allOrders).filter((event) => {
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			return typeTag?.[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION
		}),
	)

	if (orders.size === 0) return []

	// Get all order IDs
	const orderIds = Array.from(orders)
		.map((order) => {
			const orderTag = order.tags.find((tag) => tag[0] === 'order')
			return orderTag?.[1]
		})
		.filter(Boolean) as string[]

	if (orderIds.length === 0) return []

	// Collect all unique sellers from orders
	const sellersSet = new Set<string>()
	Array.from(orders).forEach((order) => {
		const sellerTag = order.tags.find((tag) => tag[0] === 'p')
		if (sellerTag?.[1]) sellersSet.add(sellerTag[1])
	})
	const sellers = Array.from(sellersSet)
	const allAuthors = [buyerPubkey, ...sellers]

	// Fetch related events more efficiently using authors filter
	const relatedEventsFilters: NDKFilter[] = [
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			authors: allAuthors,
			limit: 500,
		},
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			'#p': allAuthors,
			limit: 500,
		},
	]

	const [eventsByAuthors, eventsByMentions] = await Promise.all([
		ndk.fetchEvents(relatedEventsFilters[0]),
		ndk.fetchEvents(relatedEventsFilters[1]),
	])

	const allEvents = new Set<NDKEvent>([...Array.from(eventsByAuthors), ...Array.from(eventsByMentions)])

	const relatedEvents = new Set<NDKEvent>(
		Array.from(allEvents).filter((event) => {
			const orderTag = event.tags.find((tag) => tag[0] === 'order')
			return orderTag?.[1] && orderIds.includes(orderTag[1])
		}),
	)

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
	})
}

/**
 * Fetches orders where the specified user is the seller (recipient of order messages)
 */
export const fetchOrdersBySeller = async (sellerPubkey: string): Promise<OrderWithRelatedEvents[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Orders where the specified user is the recipient (merchant receiving orders)
	const orderReceivedFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#p': [sellerPubkey],
		limit: 100,
	}

	const allOrders = await ndk.fetchEvents(orderReceivedFilter)

	// Filter for ORDER_CREATION type programmatically
	const orders = new Set<NDKEvent>(
		Array.from(allOrders).filter((event) => {
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			return typeTag?.[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION
		}),
	)

	if (orders.size === 0) return []

	// Get all order IDs
	const orderIds = Array.from(orders)
		.map((order) => {
			const orderTag = order.tags.find((tag) => tag[0] === 'order')
			return orderTag?.[1]
		})
		.filter(Boolean) as string[]

	if (orderIds.length === 0) return []

	// Collect all unique buyers from orders
	const buyersSet = new Set<string>()
	Array.from(orders).forEach((order) => {
		buyersSet.add(order.pubkey) // buyer is the author
	})
	const buyers = Array.from(buyersSet)
	const allAuthors = [sellerPubkey, ...buyers]

	// Fetch related events more efficiently using authors filter
	const relatedEventsFilters: NDKFilter[] = [
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			authors: allAuthors,
			limit: 500,
		},
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			'#p': allAuthors,
			limit: 500,
		},
	]

	const [eventsByAuthors, eventsByMentions] = await Promise.all([
		ndk.fetchEvents(relatedEventsFilters[0]),
		ndk.fetchEvents(relatedEventsFilters[1]),
	])

	const allEvents = new Set<NDKEvent>([...Array.from(eventsByAuthors), ...Array.from(eventsByMentions)])

	const relatedEvents = new Set<NDKEvent>(
		Array.from(allEvents).filter((event) => {
			const orderTag = event.tags.find((tag) => tag[0] === 'order')
			return orderTag?.[1] && orderIds.includes(orderTag[1])
		}),
	)

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
 * Hook to fetch orders where the specified user is the seller
 */
export const useOrdersBySeller = (sellerPubkey: string) => {
	return useQuery({
		queryKey: orderKeys.bySeller(sellerPubkey),
		queryFn: () => fetchOrdersBySeller(sellerPubkey),
		enabled: !!sellerPubkey,
	})
}

/**
 * Fetches a specific order by its ID
 */
export const fetchOrderById = async (orderId: string): Promise<OrderWithRelatedEvents | null> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Check if we have a hash format (event ID)
	const isHash = /^[0-9a-f]{64}$/.test(orderId)

	// Fetch order creation events - cannot use '#type' or '#order' filters
	const orderFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		limit: 100,
	}

	// Add the appropriate filter depending on what type of ID we have
	if (isHash) {
		// If it's a hash, it could be the event ID
		orderFilter.ids = [orderId]
	}

	const allOrderEvents = await ndk.fetchEvents(orderFilter)

	// Filter programmatically for ORDER_CREATION type and matching order ID
	const matchingOrders = Array.from(allOrderEvents).filter((event) => {
		const typeTag = event.tags.find((tag) => tag[0] === 'type')
		if (typeTag?.[1] !== ORDER_MESSAGE_TYPE.ORDER_CREATION) return false

		// Check if order ID matches
		if (isHash && event.id === orderId) return true

		const orderTag = event.tags.find((tag) => tag[0] === 'order')
		return orderTag?.[1] === orderId
	})

	if (matchingOrders.length === 0) return null

	const orderEvent = matchingOrders[0] // Take the first matching order event

	// Get the order ID from the order tag
	const orderIdFromTag = orderEvent.tags.find((tag) => tag[0] === 'order')?.[1]
	const eventId = orderEvent.id

	if (!orderIdFromTag) return null

	// Get buyer and seller from the order
	const buyer = orderEvent.pubkey
	const seller = orderEvent.tags.find((tag) => tag[0] === 'p')?.[1]
	if (!seller) return null

	const participants = [buyer, seller]

	// Fetch related events more efficiently using authors filter
	const relatedEventsFilters: NDKFilter[] = [
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			authors: participants,
			limit: 500,
		},
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			'#p': participants,
			limit: 500,
		},
	]

	const [eventsByAuthors, eventsByMentions] = await Promise.all([
		ndk.fetchEvents(relatedEventsFilters[0]),
		ndk.fetchEvents(relatedEventsFilters[1]),
	])

	const allEvents = new Set<NDKEvent>([...Array.from(eventsByAuthors), ...Array.from(eventsByMentions)])

	// Filter events by order ID programmatically
	const relatedEvents = new Set<NDKEvent>(
		Array.from(allEvents).filter((event) => {
			const orderTag = event.tags.find((tag) => tag[0] === 'order')
			// Match both the order UUID and the event ID
			return orderTag?.[1] && (orderTag[1] === orderIdFromTag || orderTag[1] === eventId)
		}),
	)

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

		// Subscription for all related events - no multi-character tag filters
		const relatedEventsFilter = {
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
		}

		const subscription = ndk.subscribe(relatedEventsFilter, {
			closeOnEose: false, // Keep subscription open
		})

		const refreshOrderDetails = () => {
			queryClient.invalidateQueries({ queryKey: orderKeys.details(orderId) })
		}

		// Event handler for all events related to this order
		subscription.on('event', (newEvent) => {
			// Check if this event is related to our order
			const orderTag = newEvent.tags.find((tag) => tag[0] === 'order')
			if (!orderTag?.[1] || orderTag[1] !== orderId) return

			// Any related event should refresh order details (status, shipping, payment requests/receipts, messages)
			refreshOrderDetails()
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
		staleTime: Infinity,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
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
