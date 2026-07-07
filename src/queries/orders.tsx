import { ORDER_GENERAL_KIND, ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, ORDER_STATUS, PAYMENT_RECEIPT_KIND } from '@/lib/schemas/order'
import { NIP59_GIFT_WRAP_KIND, signerSupportsNip44 } from '@/lib/nostr/nip59'
import { decryptPrivateOrderMessageWithSigner, type PrivateOrderDeliveryDetails } from '@/lib/orders/privateOrderMessage'
import { applesauceIo, type NostrFilter } from '@/lib/nostr/io'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent, type NDKFilter, type NDKSigner } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Event } from 'nostr-tools'
import { useEffect, useMemo } from 'react'
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
	privateOrderDetails?: PrivateOrderDeliveryDetails
	privateOrderDetailsEvent?: NDKEvent
}

type FetchOrdersBySellerOptions = {
	includePrivateOrderDetails?: boolean
	signer?: NDKSigner | null
}

type UseOrdersBySellerOptions = {
	includePrivateOrderDetails?: boolean
}

type FetchOrderByIdOptions = {
	includePrivateOrderDetails?: boolean
	signer?: NDKSigner | null
}

type UseOrderByIdOptions = {
	includePrivateOrderDetails?: boolean
}

type PublicOrderCorrelationFields = {
	orderId: string
	buyerPubkey: string
	sellerPubkey: string
	totalAmountSats: number
	items: Map<string, number>
	shippingRef?: string
}

export type SellerPrivateOrderDetailsCandidate = {
	details: PrivateOrderDeliveryDetails
	event: NDKEvent
}

const PRODUCT_REF_KIND = '30402'
const SHIPPING_REF_KIND = '30406'
const ORDER_CREATION_SUBJECT = 'order-info'
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

type OrdersNdk = NonNullable<ReturnType<typeof ndkActions.getNDK>>

async function fetchNdkEventSet(ndk: OrdersNdk, filter: NDKFilter | NDKFilter[]): Promise<Set<NDKEvent>> {
	const rawEvents = await applesauceIo.fetchEvents(filter as NostrFilter | NostrFilter[])
	const uniqueRawEvents = new Map<string, (typeof rawEvents)[number]>()
	for (const event of rawEvents) {
		if (!uniqueRawEvents.has(event.id)) uniqueRawEvents.set(event.id, event)
	}
	return new Set(Array.from(uniqueRawEvents.values(), (event) => new NDKEvent(ndk, event)))
}

export const fetchSellerPrivateOrderGiftWraps = async (sellerPubkey: string): Promise<NDKEvent[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const giftWrapFilter: NDKFilter = {
		kinds: [NIP59_GIFT_WRAP_KIND],
		'#p': [sellerPubkey],
		limit: 500,
	}

	return Array.from(await fetchNdkEventSet(ndk, giftWrapFilter))
}

export const decryptSellerPrivateOrderGiftWraps = async (params: {
	giftWrapEvents: NDKEvent[]
	sellerPubkey: string
	signer?: NDKSigner | null
}): Promise<SellerPrivateOrderDetailsCandidate[]> => {
	const { giftWrapEvents, sellerPubkey, signer } = params
	if (!isHexPubkey(sellerPubkey)) return []
	if (!signer) return []

	const signerPubkey = await getSignerPubkey(signer)
	if (signerPubkey !== sellerPubkey) return []
	if (!(await signerSupportsNip44(signer, 'decrypt'))) return []

	const decryptedCandidates: SellerPrivateOrderDetailsCandidate[] = []
	for (const giftWrapEvent of giftWrapEvents) {
		try {
			const giftWrap = ndkEventToRawEvent(giftWrapEvent)
			const decrypted = await decryptPrivateOrderMessageWithSigner({
				giftWrap,
				signer,
				expectedSellerPubkey: sellerPubkey,
			})
			decryptedCandidates.push({ details: decrypted.details, event: giftWrapEvent })
		} catch {
			// Private delivery details are best-effort seller enrichment. Keep public orders usable.
		}
	}

	return decryptedCandidates
}

export const getPublicOrderCorrelationFields = (order: NDKEvent): PublicOrderCorrelationFields | null => {
	if (order.kind !== ORDER_PROCESS_KIND) return null

	const type = getRequiredSingleTagValue(order.tags, 'type')
	if (type !== ORDER_MESSAGE_TYPE.ORDER_CREATION) return null

	const subject = getRequiredSingleTagValue(order.tags, 'subject')
	if (subject !== ORDER_CREATION_SUBJECT) return null

	const sellerPubkey = getRequiredSingleTagValue(order.tags, 'p')
	if (!sellerPubkey || !isHexPubkey(sellerPubkey)) return null
	if (!isHexPubkey(order.pubkey)) return null

	const orderId = getRequiredSingleTagValue(order.tags, 'order')
	if (!orderId) return null

	const amount = getRequiredSingleTagValue(order.tags, 'amount')
	if (!amount || !/^\d+$/.test(amount)) return null
	const totalAmountSats = Number(amount)
	if (!Number.isSafeInteger(totalAmountSats) || totalAmountSats <= 0) return null

	const items = canonicalizeItemTags(order.tags, sellerPubkey)
	if (!items) return null

	const shippingRef = getOptionalSingleTagValue(order.tags, 'shipping')
	if (shippingRef === null) return null
	if (shippingRef && !isAddressableRef(shippingRef, SHIPPING_REF_KIND, sellerPubkey)) return null

	return {
		orderId,
		buyerPubkey: order.pubkey,
		sellerPubkey,
		totalAmountSats,
		items,
		shippingRef,
	}
}

export const privateDetailsMatchPublicOrder = (details: PrivateOrderDeliveryDetails, order: NDKEvent): boolean => {
	const publicFields = getPublicOrderCorrelationFields(order)
	if (!publicFields) return false

	if (details.orderId !== publicFields.orderId) return false
	if (details.buyerPubkey !== publicFields.buyerPubkey) return false
	if (details.sellerPubkey !== publicFields.sellerPubkey) return false
	if (details.totalAmountSats !== publicFields.totalAmountSats) return false

	const privateItems = canonicalizeItems(details.items)
	if (!privateItems) return false
	if (!itemMapsEqual(publicFields.items, privateItems)) return false

	const privateShippingRef = details.shippingRef
	if (publicFields.shippingRef !== privateShippingRef) return false

	return true
}

export const attachPrivateOrderDetailsToOrders = (
	orders: OrderWithRelatedEvents[],
	decryptedDetails: SellerPrivateOrderDetailsCandidate[],
): OrderWithRelatedEvents[] => {
	const sortedDetails = [...decryptedDetails].sort(comparePrivateOrderDetailsCandidates)

	return orders.map((orderWithEvents) => {
		const match = sortedDetails.find((candidate) => privateDetailsMatchPublicOrder(candidate.details, orderWithEvents.order))
		if (!match) return orderWithEvents
		return {
			...orderWithEvents,
			privateOrderDetails: match.details,
			privateOrderDetailsEvent: match.event,
		}
	})
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

	const [ordersSent, ordersReceived] = await Promise.all([
		fetchNdkEventSet(ndk, orderCreationFilter),
		fetchNdkEventSet(ndk, orderReceivedFilter),
	])

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
		fetchNdkEventSet(ndk, relatedEventsFilters[0]),
		fetchNdkEventSet(ndk, relatedEventsFilters[1]),
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

	const allOrders = await fetchNdkEventSet(ndk, orderCreationFilter)

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
		fetchNdkEventSet(ndk, relatedEventsFilters[0]),
		fetchNdkEventSet(ndk, relatedEventsFilters[1]),
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
export const fetchOrdersBySeller = async (
	sellerPubkey: string,
	options: FetchOrdersBySellerOptions = {},
): Promise<OrderWithRelatedEvents[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Orders where the specified user is the recipient (merchant receiving orders)
	const orderReceivedFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#p': [sellerPubkey],
		limit: 100,
	}

	const allOrders = await fetchNdkEventSet(ndk, orderReceivedFilter)

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
		fetchNdkEventSet(ndk, relatedEventsFilters[0]),
		fetchNdkEventSet(ndk, relatedEventsFilters[1]),
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
	const publicOrders = Array.from(orders).map((order) => {
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

	if (!options.includePrivateOrderDetails) return publicOrders

	try {
		const giftWrapEvents = await fetchSellerPrivateOrderGiftWraps(sellerPubkey)
		const decryptedDetails = await decryptSellerPrivateOrderGiftWraps({
			giftWrapEvents,
			sellerPubkey,
			signer: options.signer ?? ndkActions.getSigner(),
		})
		return attachPrivateOrderDetailsToOrders(publicOrders, decryptedDetails)
	} catch {
		return publicOrders
	}
}

/**
 * Hook to fetch orders where the specified user is the seller
 */
export const useOrdersBySeller = (sellerPubkey: string, options: UseOrdersBySellerOptions = {}) => {
	const includePrivateOrderDetails = options.includePrivateOrderDetails === true
	return useQuery({
		queryKey: includePrivateOrderDetails ? orderKeys.bySellerWithPrivate(sellerPubkey) : orderKeys.bySeller(sellerPubkey),
		queryFn: () =>
			fetchOrdersBySeller(
				sellerPubkey,
				includePrivateOrderDetails
					? {
							includePrivateOrderDetails: true,
							signer: ndkActions.getSigner(),
						}
					: undefined,
			),
		enabled: !!sellerPubkey,
	})
}

/**
 * Fetches a specific order by its ID
 */
export const fetchOrderById = async (orderId: string, options: FetchOrderByIdOptions = {}): Promise<OrderWithRelatedEvents | null> => {
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

	const allOrderEvents = await fetchNdkEventSet(ndk, orderFilter)

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
		fetchNdkEventSet(ndk, relatedEventsFilters[0]),
		fetchNdkEventSet(ndk, relatedEventsFilters[1]),
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

	const publicOrder = {
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

	if (!options.includePrivateOrderDetails) return publicOrder

	try {
		const giftWrapEvents = await fetchSellerPrivateOrderGiftWraps(seller)
		const decryptedDetails = await decryptSellerPrivateOrderGiftWraps({
			giftWrapEvents,
			sellerPubkey: seller,
			signer: options.signer ?? ndkActions.getSigner(),
		})
		return attachPrivateOrderDetailsToOrders([publicOrder], decryptedDetails)[0] ?? publicOrder
	} catch {
		return publicOrder
	}
}

export function subscribeToOrderUpdates(params: {
	ndk: OrdersNdk
	orderId: string
	logicalOrderId?: string
	fetchedOrderEventId?: string
	onMatchedEvent: () => void
}): () => void {
	const { ndk, orderId, logicalOrderId, fetchedOrderEventId, onMatchedEvent } = params
	const relatedEventsFilter: NostrFilter = {
		kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
	}

	return applesauceIo.subscribe(
		relatedEventsFilter,
		(rawEvent) => {
			const newEvent = new NDKEvent(ndk, rawEvent)
			const taggedOrderId = newEvent.tags.find((tag) => tag[0] === 'order')?.[1]
			const matchesRouteId = newEvent.id === orderId || taggedOrderId === orderId
			const matchesFetchedOrder = !!taggedOrderId && (taggedOrderId === logicalOrderId || taggedOrderId === fetchedOrderEventId)
			if (matchesRouteId || matchesFetchedOrder) onMatchedEvent()
		},
		{ closeOnEose: false },
	)
}

/**
 * Hook to fetch a specific order by its ID
 */
export const useOrderById = (orderId: string, options: UseOrderByIdOptions = {}) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const includePrivateOrderDetails = options.includePrivateOrderDetails === true
	const queryKey = useMemo(
		() => (includePrivateOrderDetails ? orderKeys.detailsWithPrivate(orderId) : orderKeys.details(orderId)),
		[includePrivateOrderDetails, orderId],
	)
	const orderQuery = useQuery({
		queryKey,
		queryFn: () =>
			fetchOrderById(
				orderId,
				includePrivateOrderDetails
					? {
							includePrivateOrderDetails: true,
							signer: ndkActions.getSigner(),
						}
					: undefined,
			),
		enabled: !!orderId,
		staleTime: Infinity,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	})

	const fetchedOrderEventId = orderQuery.data?.order.id
	const logicalOrderId = orderQuery.data?.order.tags.find((tag) => tag[0] === 'order')?.[1]

	// Set up a live subscription to monitor events for this order
	useEffect(() => {
		if (!orderId || !ndk) return

		const refreshOrderDetails = () => {
			void queryClient.invalidateQueries({ queryKey })
			void queryClient.refetchQueries({ queryKey })
		}

		const stop = subscribeToOrderUpdates({
			ndk,
			orderId,
			logicalOrderId,
			fetchedOrderEventId,
			onMatchedEvent: refreshOrderDetails,
		})

		return stop
	}, [fetchedOrderEventId, logicalOrderId, ndk, orderId, queryClient, queryKey])

	return orderQuery
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

function comparePrivateOrderDetailsCandidates(a: SellerPrivateOrderDetailsCandidate, b: SellerPrivateOrderDetailsCandidate): number {
	const createdAtDiff = (b.event.created_at || 0) - (a.event.created_at || 0)
	if (createdAtDiff !== 0) return createdAtDiff
	return (b.event.id || '').localeCompare(a.event.id || '')
}

async function getSignerPubkey(signer: NDKSigner): Promise<string | null> {
	try {
		const user = await signer.user()
		return user.pubkey
	} catch {
		return null
	}
}

function ndkEventToRawEvent(event: NDKEvent): Event {
	const rawEvent =
		typeof event.rawEvent === 'function'
			? event.rawEvent()
			: {
					id: event.id,
					pubkey: event.pubkey,
					created_at: event.created_at,
					kind: event.kind,
					tags: event.tags,
					content: event.content,
					sig: event.sig,
				}

	if (typeof rawEvent.kind !== 'number') throw new Error('Malformed private order gift wrap')
	if (typeof rawEvent.content !== 'string') throw new Error('Malformed private order gift wrap')
	if (typeof rawEvent.created_at !== 'number') throw new Error('Malformed private order gift wrap')
	if (typeof rawEvent.pubkey !== 'string' || !isHexPubkey(rawEvent.pubkey)) throw new Error('Malformed private order gift wrap')
	if (typeof rawEvent.id !== 'string') throw new Error('Malformed private order gift wrap')
	if (typeof rawEvent.sig !== 'string') throw new Error('Malformed private order gift wrap')
	if (
		!Array.isArray(rawEvent.tags) ||
		!rawEvent.tags.every((tag) => Array.isArray(tag) && tag.every((value) => typeof value === 'string'))
	) {
		throw new Error('Malformed private order gift wrap')
	}

	return rawEvent as Event
}

function getRequiredSingleTagValue(tags: string[][], tagName: string): string | undefined {
	const matches = tags.filter((tag) => tag[0] === tagName)
	if (matches.length !== 1) return undefined
	return matches[0]?.[1]
}

function getOptionalSingleTagValue(tags: string[][], tagName: string): string | undefined | null {
	const matches = tags.filter((tag) => tag[0] === tagName)
	if (matches.length === 0) return undefined
	if (matches.length > 1) return null
	const value = matches[0]?.[1]
	if (!value) return null
	return value
}

function canonicalizeItemTags(tags: string[][], sellerPubkey: string): Map<string, number> | null {
	const itemTags = tags.filter((tag) => tag[0] === 'item')
	if (itemTags.length === 0) return null

	const items = itemTags.map((tag) => {
		const productRef = tag[1]
		const quantityText = tag[2]
		if (!productRef || !isAddressableRef(productRef, PRODUCT_REF_KIND, sellerPubkey)) return null
		if (!quantityText || !/^\d+$/.test(quantityText)) return null
		const quantity = Number(quantityText)
		if (!Number.isSafeInteger(quantity) || quantity <= 0) return null
		return { productRef, quantity }
	})

	if (items.some((item) => item === null)) return null
	return canonicalizeItems(items as Array<{ productRef: string; quantity: number }>)
}

function canonicalizeItems(items: Array<{ productRef: string; quantity: number }>): Map<string, number> | null {
	if (items.length === 0) return null
	const canonicalItems = new Map<string, number>()

	for (const item of items) {
		if (!item.productRef) return null
		if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) return null
		const currentQuantity = canonicalItems.get(item.productRef) ?? 0
		const nextQuantity = currentQuantity + item.quantity
		if (!Number.isSafeInteger(nextQuantity)) return null
		canonicalItems.set(item.productRef, nextQuantity)
	}

	return canonicalItems
}

function itemMapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
	if (a.size !== b.size) return false
	for (const [productRef, quantity] of a) {
		if (b.get(productRef) !== quantity) return false
	}
	return true
}

function isAddressableRef(value: string, expectedKind: string, expectedPubkey: string): boolean {
	if (value.includes('\n') || value.includes('\r')) return false
	const [kind, pubkey, ...dTagParts] = value.split(':')
	const dTag = dTagParts.join(':')
	return kind === expectedKind && pubkey === expectedPubkey && dTag.length > 0
}

function isHexPubkey(value: string): boolean {
	return HEX_PUBKEY_RE.test(value)
}

/**
 * Format a satoshi amount for display
 */
export const formatSats = (amount?: string): string => {
	if (!amount) return '-'
	return `${parseInt(amount).toLocaleString()} sats`
}
