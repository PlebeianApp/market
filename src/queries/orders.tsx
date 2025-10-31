import { ORDER_GENERAL_KIND, ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND, ORDER_STATUS, PAYMENT_RECEIPT_KIND } from '@/lib/schemas/order'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo } from 'react'
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
	let ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const user = ndk.activeUser
	if (!user) throw new Error('No active user')

	// Ensure NDK is connected before querying
	const ndkState = ndkStore.state
	if (!ndkState.isConnected) {
		await ndkActions.connect()
	}

	// Re-check NDK after connection
	ndk = ndkActions.getNDK()
	if (!ndk) {
		throw new Error('NDK not initialized after connection')
	}

	// Ensure NDK pool is ready before creating subscriptions
	if (!ndk.pool) {
		// Wait a bit for pool to initialize
		await new Promise(resolve => setTimeout(resolve, 100))
		ndk = ndkActions.getNDK()
		if (!ndk || !ndk.pool) {
			throw new Error('NDK pool not initialized')
		}
	}

	// Fetch orders where the current user is involved (either as sender or recipient of encrypted DMs)
	// Per gamma_spec.md, we can't filter by #type or #order tags - they're not valid Nostr filter tags
	// We fetch all Kind 16 messages and decrypt to filter by type tag client-side
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

	// Get signer for decryption
	const signer = ndkActions.getSigner()

	// Fetch orders sent using subscription pattern
	let ordersSent: Set<NDKEvent> = new Set()
	try {
		const ordersSentSet = new Set<NDKEvent>()
		
		// Verify NDK is ready before creating subscription
		if (!ndk || !ndk.pool) {
			throw new Error('NDK not ready for subscription')
		}
		
		const sentSubscription = ndk.subscribe(orderCreationFilter, {
			closeOnEose: true,
		})

		sentSubscription.on('event', async (event: NDKEvent) => {
			// Decrypt and filter client-side by type tag
			try {
				if (signer && event.content && !event.content.startsWith('{')) {
					await event.decrypt(undefined, signer)
				}
				
				const typeTag = event.tags.find((tag) => tag[0] === 'type')
				if (typeTag && typeTag[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
					ordersSentSet.add(event)
				}
			} catch (error) {
				console.warn('🔍 fetchOrders: Error processing sent event:', error)
			}
		})

		// Set up eose and close handlers BEFORE starting
		let stopped = false
		const stopSentSubscription = () => {
			if (!stopped) {
				stopped = true
				// Don't call stop() - let NDK handle cleanup naturally with closeOnEose
				// Manually stopping causes NDK internal errors
			}
		}

		// Start subscription AFTER handlers are set up but BEFORE Promise.race
		// This ensures subscription is active when timeout handlers are registered
		sentSubscription.start()

		await Promise.race([
			new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					stopSentSubscription()
					resolve()
				}, 3000)

				sentSubscription.on('eose', () => {
					clearTimeout(timeout)
					stopSentSubscription()
					resolve()
				})

				sentSubscription.on('close', () => {
					clearTimeout(timeout)
					stopSentSubscription()
					resolve()
				})
			}),
			new Promise<void>((resolve) => {
				setTimeout(() => {
					stopSentSubscription()
					resolve()
				}, 3500)
			})
		])

		ordersSent = ordersSentSet
	} catch (error) {
		console.error('🔍 fetchOrders: Error fetching orders sent:', error)
		ordersSent = new Set()
	}

	// Fetch orders received using subscription pattern
	let ordersReceived: Set<NDKEvent> = new Set()
	try {
		const ordersReceivedSet = new Set<NDKEvent>()
		
		// Verify NDK is ready before creating subscription
		if (!ndk || !ndk.pool) {
			throw new Error('NDK not ready for subscription')
		}
		
		const receivedSubscription = ndk.subscribe(orderReceivedFilter, {
			closeOnEose: true,
		})

		receivedSubscription.on('event', async (event: NDKEvent) => {
			// Decrypt and filter client-side by type tag
			try {
				// Try to decrypt if content looks encrypted (doesn't start with { or [)
				if (signer && event.content && !event.content.trim().startsWith('{') && !event.content.trim().startsWith('[')) {
					await event.decrypt(undefined, signer)
				}
				
				const typeTag = event.tags.find((tag) => tag[0] === 'type')
				if (typeTag && typeTag[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
					ordersReceivedSet.add(event)
				}
			} catch (error) {
				console.warn('🔍 fetchOrders: Error processing received event:', error)
				// Even if decryption fails, check if type tag exists (might already be decrypted)
				const typeTag = event.tags.find((tag) => tag[0] === 'type')
				if (typeTag && typeTag[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
					ordersReceivedSet.add(event)
				}
			}
		})

		// Set up eose and close handlers BEFORE starting
		let stopped = false
		const stopReceivedSubscription = () => {
			if (!stopped) {
				stopped = true
				// Don't call stop() - let NDK handle cleanup naturally with closeOnEose
				// Manually stopping causes NDK internal errors
			}
		}

		// Start subscription AFTER handlers are set up but BEFORE Promise.race
		receivedSubscription.start()

		await Promise.race([
			new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					stopReceivedSubscription()
					resolve()
				}, 3000)

				receivedSubscription.on('eose', () => {
					clearTimeout(timeout)
					stopReceivedSubscription()
					resolve()
				})

				receivedSubscription.on('close', () => {
					clearTimeout(timeout)
					stopReceivedSubscription()
					resolve()
				})
			}),
			new Promise<void>((resolve) => {
				setTimeout(() => {
					stopReceivedSubscription()
					resolve()
				}, 3500)
			})
		])

		ordersReceived = ordersReceivedSet
	} catch (error) {
		console.error('🔍 fetchOrders: Error fetching orders received:', error)
		ordersReceived = new Set()
	}

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
	// Per gamma_spec.md, we can't filter by #order tag - filter client-side after decryption
	const relatedEventsFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
		limit: 500,
	}

	// Fetch related events using subscription pattern
	let relatedEvents: Set<NDKEvent> = new Set()
	try {
		const relatedEventsSet = new Set<NDKEvent>()
		
		// Verify NDK is ready before creating subscription
		if (!ndk || !ndk.pool) {
			throw new Error('NDK not ready for subscription')
		}
		
		const subscription = ndk.subscribe(relatedEventsFilter, {
			closeOnEose: true,
		})

		subscription.on('event', async (event: NDKEvent) => {
			// Decrypt and filter by order tag client-side
			try {
				if (signer && event.content && !event.content.startsWith('{')) {
					await event.decrypt(undefined, signer)
				}
				
				// Check if this event is related to any of our orders
				const orderTag = event.tags.find((tag) => tag[0] === 'order')
				if (orderTag && orderIds.includes(orderTag[1])) {
					relatedEventsSet.add(event)
				}
			} catch (error) {
				console.warn('🔍 fetchOrders: Error processing related event:', error)
			}
		})

		// Set up eose and close handlers BEFORE starting
		let stopped = false
		const stopSubscription = () => {
			if (!stopped) {
				stopped = true
				// Don't call stop() - let NDK handle cleanup naturally with closeOnEose
				// Manually stopping causes NDK internal errors
			}
		}

		// Start subscription AFTER handlers are set up but BEFORE Promise.race
		subscription.start()

		await Promise.race([
			new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					stopSubscription()
					resolve()
				}, 2000)

				subscription.on('eose', () => {
					clearTimeout(timeout)
					stopSubscription()
					resolve()
				})

				subscription.on('close', () => {
					clearTimeout(timeout)
					stopSubscription()
					resolve()
				})
			}),
			new Promise<void>((resolve) => {
				setTimeout(() => {
					stopSubscription()
					resolve()
				}, 2500)
			})
		])

		relatedEvents = relatedEventsSet
	} catch (error) {
		console.error('🔍 fetchOrders: Error fetching related events:', error)
		relatedEvents = new Set()
	}

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
export const fetchOrdersByBuyer = async (buyerPubkey: string, queryClient?: ReturnType<typeof useQueryClient>): Promise<OrderWithRelatedEvents[]> => {
	let ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	if (!buyerPubkey) {
		console.warn('fetchOrdersByBuyer: buyerPubkey is empty, returning empty array')
		return []
	}

	// Ensure NDK is connected before querying
	const ndkState = ndkStore.state
	if (!ndkState.isConnected) {
		await ndkActions.connect()
	}

	// Re-check NDK after connection to ensure it's still valid
	let currentNdk = ndkActions.getNDK()
	if (!currentNdk) {
		throw new Error('NDK not initialized after connection')
	}
	ndk = currentNdk

	// Ensure NDK pool is ready before creating subscriptions
	if (!ndk.pool) {
		// Wait a bit for pool to initialize
		await new Promise(resolve => setTimeout(resolve, 100))
		ndk = ndkActions.getNDK()
		if (!ndk || !ndk.pool) {
			throw new Error('NDK pool not initialized')
		}
	}

	// Orders where the specified user is the author (buyer sending order to merchant)
	// Per gamma_spec.md, we can't filter by #type or #order tags - they're not valid Nostr filter tags
	// We fetch all Kind 16 messages and decrypt to filter by type tag client-side
	const orderCreationFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		authors: [buyerPubkey],
		limit: 100,
	}

	const relayUrls = ndk.explicitRelayUrls || (ndk.pool?.relays ? Array.from(ndk.pool.relays.keys()) : [])

	let orders: Set<NDKEvent>
	// Track order IDs dynamically as they're discovered
	const orderIdsSet = new Set<string>()
	// Declare related events subscription outside try block so it's accessible later
	let relatedEventsSubscription: NDKSubscription | null = null
	
	try {
		console.log('🔍 fetchOrdersByBuyer: Starting subscription for buyer:', buyerPubkey)
		console.log('🔍 fetchOrdersByBuyer: Filter:', JSON.stringify(orderCreationFilter))
		// Use subscription with closeOnEose to ensure we get EOSE signal
		const ordersSet = new Set<NDKEvent>()
		
		// Verify NDK is ready before creating subscription
		if (!ndk || !ndk.pool) {
			throw new Error('NDK not ready for subscription')
		}
		
		const subscription = ndk.subscribe(orderCreationFilter, {
			closeOnEose: true,
		})

		// Get signer for decryption
		const signer = ndkActions.getSigner()

		// Track all pending event processing promises
		const pendingEventProcessing: Promise<void>[] = []
		let subscriptionClosed = false
		
		// Start related events subscription in parallel
		const relatedEventsFilter: NDKFilter = {
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			limit: 500,
		}
		
		if (queryClient) {
			try {
				relatedEventsSubscription = ndk.subscribe(relatedEventsFilter, {
					closeOnEose: false,
				})
			} catch (subError) {
				console.error('🔍 fetchOrdersByBuyer: Error creating related events subscription:', subError)
			}
		}

		// Set up event handlers first
		subscription.on('event', async (event: NDKEvent) => {
			// Skip if subscription is already closed
			if (subscriptionClosed) return

			// Process event asynchronously and track the promise
			const processPromise = (async () => {
				// Per NIP-17, encrypted direct messages have their tags encrypted
				// We need to decrypt first, then check the type tag
				// However, events might not always be encrypted, so check tags before and after decryption
				
				// First, check if type tag exists before decryption (for unencrypted events)
				let typeTag = event.tags.find((tag) => tag[0] === 'type')
				const orderTag = event.tags.find((tag) => tag[0] === 'order')
				
				// If we already found the type tag and it matches, we can skip decryption
				if (typeTag && typeTag[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
					console.log('🔍 fetchOrdersByBuyer: Found order event (unencrypted):', event.id)
					ordersSet.add(event)
					return
				}
				
				// Try to decrypt if content looks encrypted
				let decrypted = false
				try {
					if (signer && event.content) {
						// Check if content looks encrypted (not JSON)
						const contentLooksEncrypted = !event.content.trim().startsWith('{') && !event.content.trim().startsWith('[')
						if (contentLooksEncrypted) {
							await event.decrypt(undefined, signer)
							decrypted = true
							
							// Re-check tags after decryption (tags might have been encrypted)
							typeTag = event.tags.find((tag) => tag[0] === 'type')
						}
					}
				} catch (error) {
					// Decryption failed - log but continue to check tags
					const errorMsg = error instanceof Error ? error.message : String(error)
					// Filter out base64/invalid padding errors (expected when decrypting wrong events)
					if (!errorMsg.includes('invalid base64') && !errorMsg.includes('Invalid padding') && !errorMsg.includes('invalid payload length') && !errorMsg.includes('Unknown letter')) {
						console.warn('🔍 fetchOrdersByBuyer: Decryption error for event:', errorMsg)
					}
				}
				
				// Check type tag after decryption attempt (or re-check if we already found it)
				typeTag = event.tags.find((tag) => tag[0] === 'type')
				
				// Debug logging
				if (typeTag) {
					console.log('🔍 fetchOrdersByBuyer: Found event with type tag:', {
						typeTagValue: typeTag[1],
						expectedType: ORDER_MESSAGE_TYPE.ORDER_CREATION,
						matches: typeTag[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION,
						hasOrderTag: !!orderTag,
						decrypted,
						eventId: event.id,
						author: event.pubkey,
					})
				} else {
					console.log('🔍 fetchOrdersByBuyer: Event received but no type tag found:', {
						eventId: event.id,
						author: event.pubkey,
						tagsCount: event.tags.length,
						tags: event.tags.map((t) => t[0]),
						decrypted,
					})
				}
				
				// If type tag matches ORDER_CREATION, add the event
				if (typeTag && typeTag[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
					console.log('🔍 fetchOrdersByBuyer: Adding order event:', event.id)
					ordersSet.add(event)
					// Track order ID as it's discovered
					const orderTag = event.tags.find((tag) => tag[0] === 'order')
					if (orderTag?.[1]) {
						orderIdsSet.add(orderTag[1])
					}
				}
			})()

			// Track this promise
			pendingEventProcessing.push(processPromise)
		})
		
		// Set up related events handler if subscription was created
		if (relatedEventsSubscription && queryClient) {
			const updateCacheForOrder = (orderId: string, event: NDKEvent) => {
				if (!queryClient) return
				
				let currentData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(buyerPubkey))
				
				if (!currentData) {
					setTimeout(() => {
						currentData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(buyerPubkey))
						if (!currentData) return
						updateCacheForOrderInner(orderId, event, currentData)
					}, 100)
					return
				}
				
				updateCacheForOrderInner(orderId, event, currentData)
			}
			
			const updateCacheForOrderInner = (orderId: string, event: NDKEvent, currentData: OrderWithRelatedEvents[]) => {
				let orderFound = false
				let eventAdded = false
				
				const updatedData = currentData.map((orderData) => {
					const orderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
					const dataOrderId = orderTag?.[1]
					if (dataOrderId !== orderId) {
						return orderData
					}

					orderFound = true

					const paymentRequests = [...orderData.paymentRequests]
					const statusUpdates = [...orderData.statusUpdates]
					const shippingUpdates = [...orderData.shippingUpdates]
					const generalMessages = [...orderData.generalMessages]
					const paymentReceipts = [...orderData.paymentReceipts]

					const eventExists = (arr: NDKEvent[]) => arr.some(e => e.id === event.id)
					
					if (event.kind === ORDER_PROCESS_KIND) {
						const typeTag = event.tags.find((tag) => tag[0] === 'type')
						if (typeTag) {
							switch (typeTag[1]) {
								case ORDER_MESSAGE_TYPE.PAYMENT_REQUEST:
									if (!eventExists(paymentRequests)) {
										paymentRequests.push(event)
										paymentRequests.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
										eventAdded = true
									}
									break
								case ORDER_MESSAGE_TYPE.STATUS_UPDATE:
									if (!eventExists(statusUpdates)) {
										statusUpdates.push(event)
										statusUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
										eventAdded = true
									}
									break
								case ORDER_MESSAGE_TYPE.SHIPPING_UPDATE:
									if (!eventExists(shippingUpdates)) {
										shippingUpdates.push(event)
										shippingUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
										eventAdded = true
									}
									break
							}
						}
					} else if (event.kind === ORDER_GENERAL_KIND) {
						if (!eventExists(generalMessages)) {
							generalMessages.push(event)
							generalMessages.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
							eventAdded = true
						}
					} else if (event.kind === PAYMENT_RECEIPT_KIND) {
						if (!eventExists(paymentReceipts)) {
							paymentReceipts.push(event)
							paymentReceipts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
							eventAdded = true
						}
					}

					return {
						...orderData,
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
				})

				if (orderFound && eventAdded) {
					const newDataArray = updatedData.map(order => ({
						...order,
						paymentRequests: [...order.paymentRequests],
						statusUpdates: [...order.statusUpdates],
						shippingUpdates: [...order.shippingUpdates],
						generalMessages: [...order.generalMessages],
						paymentReceipts: [...order.paymentReceipts],
					}))
					
					console.log('🔍 fetchOrdersByBuyer: Updating cache for order', orderId, 'event kind:', event.kind)
					queryClient.setQueryData(orderKeys.byBuyer(buyerPubkey), newDataArray)
					queryClient.invalidateQueries({ 
						queryKey: orderKeys.byBuyer(buyerPubkey),
						refetchType: 'none',
					})
				}
			}
			
			let relatedEventsClosed = false
			
			relatedEventsSubscription.on('event', async (event: NDKEvent) => {
				if (relatedEventsClosed) return

				try {
					if (signer && event.content) {
						const contentLooksEncrypted = !event.content.trim().startsWith('{') && !event.content.trim().startsWith('[')
						if (contentLooksEncrypted) {
							try {
								await event.decrypt(undefined, signer)
							} catch (decryptError) {
								const errorMsg = decryptError instanceof Error ? decryptError.message : String(decryptError)
								if (!errorMsg.includes('invalid base64') && !errorMsg.includes('Invalid padding') && !errorMsg.includes('invalid payload length') && !errorMsg.includes('Unknown letter')) {
									console.warn('🔍 fetchOrdersByBuyer: Unexpected decryption error:', errorMsg)
								}
							}
						}
					}
					
					const orderTag = event.tags.find((tag) => tag[0] === 'order')
					if (orderTag && orderTag[1]) {
						const orderId = orderTag[1]
						// Check if this order ID is in our set (might have been added after subscription started)
						if (orderIdsSet.has(orderId)) {
							updateCacheForOrder(orderId, event)
						} else {
							// Check if this order exists in the cache (order IDs might not be in set yet)
							const currentData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(buyerPubkey))
							if (currentData) {
								const orderExists = currentData.some((orderData) => {
									const dataOrderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
									return dataOrderTag?.[1] === orderId
								})
								if (orderExists) {
									orderIdsSet.add(orderId) // Add to set for future events
									updateCacheForOrder(orderId, event)
								}
							}
						}
					}
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error)
					if (!errorMsg.includes('invalid base64') && !errorMsg.includes('Invalid padding') && !errorMsg.includes('invalid payload length') && !errorMsg.includes('Unknown letter')) {
						console.warn('🔍 fetchOrdersByBuyer: Error processing related event:', errorMsg)
					}
				}
			})
			
			// Don't start related events subscription here - it will be started after orders subscription completes
		}

		// Helper to wait for all pending event processing
		const waitForPendingEvents = async (): Promise<void> => {
			if (pendingEventProcessing.length === 0) return
			try {
				await Promise.allSettled(pendingEventProcessing)
			} catch (error) {
				// Errors are already handled in the individual promises
				console.warn('🔍 fetchOrdersByBuyer: Some event processing failed:', error)
			}
		}

		// Set up eose and close handlers BEFORE starting
		let stopped = false
		let subscriptionStarted = false
		const stopSubscription = () => {
			if (!stopped && subscription && subscriptionStarted) {
				stopped = true
				subscriptionClosed = true
				// Don't call stop() - let NDK handle cleanup naturally with closeOnEose
				// Manually stopping causes NDK internal errors
			}
		}

		// Ensure subscription is ready before starting
		if (!subscription) {
			console.error('🔍 fetchOrdersByBuyer: Subscription not available')
			orders = new Set()
		} else {
			// Add small delay to ensure subscription is fully initialized
			await new Promise(resolve => setTimeout(resolve, 50))
			
			try {
				// Start subscription AFTER handlers are set up but BEFORE Promise.race
				subscription.start()
				subscriptionStarted = true
			} catch (startError) {
				console.error('🔍 fetchOrdersByBuyer: Error starting subscription:', startError)
				orders = new Set()
				subscriptionStarted = false
			}
		}
		
		if (!subscriptionStarted || !subscription) {
			console.warn('🔍 fetchOrdersByBuyer: Subscription not started, returning empty orders')
			orders = new Set()
		} else {
			// Start orders subscription and wait for it to complete
			// As soon as we have orders, we'll start fetching related events in parallel
			await Promise.race([
				new Promise<void>((resolve) => {
					const timeout = setTimeout(async () => {
						stopSubscription()
						console.log('🔍 fetchOrdersByBuyer: Timeout reached, found', ordersSet.size, 'orders')
						resolve()
					}, 1000) // Further reduced timeout to 1 second

					subscription.on('eose', async () => {
						console.log('🔍 fetchOrdersByBuyer: EOSE received, found', ordersSet.size, 'orders')
						clearTimeout(timeout)
						stopSubscription()
						resolve()
					})

					subscription.on('close', async () => {
						console.log('🔍 fetchOrdersByBuyer: Subscription closed, found', ordersSet.size, 'orders')
						clearTimeout(timeout)
						stopSubscription()
						resolve()
					})
				}),
				// Fallback timeout
				new Promise<void>((resolve) => {
					setTimeout(() => {
						stopSubscription()
						resolve()
					}, 1500) // Further reduced fallback timeout
				})
			])

			orders = ordersSet
			console.log('🔍 fetchOrdersByBuyer: Subscription completed, found', orders.size, 'orders')
		}
	} catch (error) {
		console.error('🔍 fetchOrdersByBuyer: Error fetching orders:', error)
		throw error
	}

	if (orders.size === 0) {
		console.warn('🔍 fetchOrdersByBuyer: No orders found for buyer:', buyerPubkey)
		return []
	}

	// Get all order IDs (populate from Set we built during subscription)
	const orderIds = Array.from(orderIdsSet).filter(Boolean)

	// Get existing cached data to merge related events if available
	const existingCache = queryClient?.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(buyerPubkey))

	// Create initial result - merge with existing cache if available
	const initialResult: OrderWithRelatedEvents[] = Array.from(orders).map((order) => {
		const orderTag = order.tags.find((tag) => tag[0] === 'order')
		const orderId = orderTag?.[1]
		
		// Add order ID to set so related events subscription can match it
		if (orderId) {
			orderIdsSet.add(orderId)
		}
		
		// Check if we have cached related events for this order
		let cachedRelatedEvents: OrderWithRelatedEvents | undefined
		if (existingCache && orderId) {
			cachedRelatedEvents = existingCache.find((cached) => {
				const cachedOrderTag = cached.order.tags.find((tag) => tag[0] === 'order')
				return cachedOrderTag?.[1] === orderId
			})
		}

		if (!orderId) {
			return {
				order,
				paymentRequests: [],
				statusUpdates: [],
				shippingUpdates: [],
				generalMessages: [],
				paymentReceipts: [],
			}
		}

		// Use cached related events if available, otherwise use empty arrays
		return {
			order,
			paymentRequests: cachedRelatedEvents?.paymentRequests || [],
			statusUpdates: cachedRelatedEvents?.statusUpdates || [],
			shippingUpdates: cachedRelatedEvents?.shippingUpdates || [],
			generalMessages: cachedRelatedEvents?.generalMessages || [],
			paymentReceipts: cachedRelatedEvents?.paymentReceipts || [],
			latestStatus: cachedRelatedEvents?.latestStatus,
			latestShipping: cachedRelatedEvents?.latestShipping,
			latestPaymentRequest: cachedRelatedEvents?.latestPaymentRequest,
			latestPaymentReceipt: cachedRelatedEvents?.latestPaymentReceipt,
			latestMessage: cachedRelatedEvents?.latestMessage,
		}
	})

	// Don't set cache directly here - let the queryFn handle caching and merging
	// Setting cache here would overwrite existing related events

	// Start fetching related events in parallel AFTER orders are found (don't wait)
	if (queryClient && relatedEventsSubscription) {
		// Ensure order IDs are populated
		console.log('🔍 fetchOrdersByBuyer: Order IDs ready for related events:', Array.from(orderIdsSet))
		
		// Start related events subscription after ensuring it's fully initialized
		// Use longer delay and verify subscription is ready before starting
		setTimeout(() => {
			try {
				if (!relatedEventsSubscription || !ndk || !ndk.pool) {
					return
				}

				// Verify subscription has start method
				if ('start' in relatedEventsSubscription && typeof relatedEventsSubscription.start === 'function') {
					relatedEventsSubscription.start()
					console.log('🔍 fetchOrdersByBuyer: Started related events subscription in parallel')
				}
			} catch (startError) {
				// Ignore "Cannot access 's' before initialization" errors - subscription might auto-start
				const errorMsg = startError instanceof Error ? startError.message : String(startError)
				if (errorMsg.includes("Cannot access 's' before initialization") || errorMsg.includes("before initialization")) {
					console.log('🔍 fetchOrdersByBuyer: Subscription already initialized or auto-started')
				} else {
					console.error('🔍 fetchOrdersByBuyer: Error starting related events subscription:', startError)
				}
			}
		}, 400) // Longer delay to ensure subscription is fully initialized
	}

	// Return orders immediately - related events subscription is fetching in parallel
	// The queryFn will handle caching and merging with existing cache
	return initialResult
}

/**
 * Hook to fetch orders where the specified user is the buyer
 */
export const useOrdersByBuyer = (buyerPubkey: string) => {
	const ndk = ndkActions.getNDK()
	const ndkState = useStore(ndkStore)
	const isConnected = ndkState.isConnected
	const queryClient = useQueryClient()
	
	// Enable query when NDK is initialized (not just connected)
	// The queryFn will handle connecting NDK if needed
	const queryEnabled = !!buyerPubkey && !!ndk

	const queryResult = useQuery({
		queryKey: orderKeys.byBuyer(buyerPubkey),
		queryFn: async () => {
			// Get cached data before attempting fetch
			const cachedData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(buyerPubkey))
			
			try {
				const result = await fetchOrdersByBuyer(buyerPubkey, queryClient)
				
				// If result is empty but we have cached data, preserve cache to prevent disappearing
				if (result.length === 0 && cachedData && cachedData.length > 0) {
					return cachedData
				}
				
				// ALWAYS merge result with cached data to preserve related events
				// This ensures cache is never wiped - we always preserve what's already there
				if (cachedData && cachedData.length > 0) {
					// Create a map of cached orders by order ID for quick lookup
					const cachedMap = new Map<string, OrderWithRelatedEvents>()
					cachedData.forEach((cachedOrder) => {
						const orderTag = cachedOrder.order.tags.find((tag) => tag[0] === 'order')
						const orderId = orderTag?.[1]
						if (orderId) {
							cachedMap.set(orderId, cachedOrder)
						}
					})
					
					// Merge: if result has empty related events but cache has them, use cache's related events
					const mergedResult = result.map((orderData) => {
						const orderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
						const orderId = orderTag?.[1]
						if (!orderId) return orderData
						
						const cachedOrder = cachedMap.get(orderId)
						if (!cachedOrder) return orderData
						
						// If result has empty related events but cache has them, use cache's related events
						const hasRelatedEvents = 
							orderData.statusUpdates.length > 0 ||
							orderData.paymentReceipts.length > 0 ||
							orderData.shippingUpdates.length > 0 ||
							orderData.paymentRequests.length > 0 ||
							orderData.generalMessages.length > 0
						
						const cachedHasRelatedEvents = 
							cachedOrder.statusUpdates.length > 0 ||
							cachedOrder.paymentReceipts.length > 0 ||
							cachedOrder.shippingUpdates.length > 0 ||
							cachedOrder.paymentRequests.length > 0 ||
							cachedOrder.generalMessages.length > 0
						
						// If result doesn't have related events but cache does, use cache's related events
						if (!hasRelatedEvents && cachedHasRelatedEvents) {
							return cachedOrder
						}
						
						// Otherwise, merge: take the union of events from both (deduplicated by event ID)
						const mergeEvents = (resultEvents: NDKEvent[], cachedEvents: NDKEvent[]) => {
							const eventMap = new Map<string, NDKEvent>()
							// First add cached events
							cachedEvents.forEach(e => eventMap.set(e.id, e))
							// Then add result events (they take precedence if duplicate)
							resultEvents.forEach(e => eventMap.set(e.id, e))
							return Array.from(eventMap.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
						}
						
						return {
							...orderData,
							paymentRequests: mergeEvents(orderData.paymentRequests, cachedOrder.paymentRequests),
							statusUpdates: mergeEvents(orderData.statusUpdates, cachedOrder.statusUpdates),
							shippingUpdates: mergeEvents(orderData.shippingUpdates, cachedOrder.shippingUpdates),
							generalMessages: mergeEvents(orderData.generalMessages, cachedOrder.generalMessages),
							paymentReceipts: mergeEvents(orderData.paymentReceipts, cachedOrder.paymentReceipts),
							latestStatus: mergeEvents(orderData.statusUpdates, cachedOrder.statusUpdates)[0],
							latestShipping: mergeEvents(orderData.shippingUpdates, cachedOrder.shippingUpdates)[0],
							latestPaymentRequest: mergeEvents(orderData.paymentRequests, cachedOrder.paymentRequests)[0],
							latestPaymentReceipt: mergeEvents(orderData.paymentReceipts, cachedOrder.paymentReceipts)[0],
							latestMessage: mergeEvents(orderData.generalMessages, cachedOrder.generalMessages)[0],
						}
					})
					
					// Cache the merged result to preserve related events - this prevents cache from being wiped
					queryClient.setQueryData(orderKeys.byBuyer(buyerPubkey), mergedResult)
					return mergedResult
				}
				
				// No cached data - cache the result as-is
				queryClient.setQueryData(orderKeys.byBuyer(buyerPubkey), result)
				return result
			} catch (error) {
				console.error('🔍 useOrdersByBuyer: queryFn error:', error)
				// Check if we have existing cache data - don't overwrite with empty array on error
				if (cachedData && cachedData.length > 0) {
					return cachedData
				}
				// Only return empty array if we truly have no cached data
				return []
			}
		},
		enabled: queryEnabled,
		refetchOnMount: false, // Don't refetch on mount - use cache if available
		refetchOnWindowFocus: false, // Don't refetch on window focus - preserve cache
		refetchOnReconnect: true, // Refetch when reconnecting to network
		staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
		gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes (increased to match purchases persistence)
		// Return empty array as placeholder data when disabled
		placeholderData: queryEnabled ? undefined : [],
		retry: 1, // Only retry once on failure
		retryDelay: 1000, // Wait 1s before retry
		notifyOnChangeProps: ['data', 'error', 'status'], // Explicitly notify on these changes
		structuralSharing: false, // Disable structural sharing to ensure React detects all cache updates
	})

	// Refetch when NDK connects to ensure we get fresh data
	useEffect(() => {
		if (!queryEnabled || !isConnected) return
		
		// Only refetch if we don't have data or if data is stale
		const queryData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(buyerPubkey))
		if (queryData && queryData.length > 0) {
			// We have data, don't aggressively refetch
			return
		}
		
		// Small delay to ensure connection is fully established
		const timer = setTimeout(() => {
			queryClient.refetchQueries({ queryKey: orderKeys.byBuyer(buyerPubkey) }).catch((err) => {
				console.warn('Failed to refetch orders after NDK connection:', err)
			})
		}, 100)
		
		return () => clearTimeout(timer)
	}, [isConnected, queryEnabled, buyerPubkey, queryClient])

	return queryResult
}

/**
 * Fetches orders where the specified user is the seller (recipient of order messages)
 */
export const fetchOrdersBySeller = async (sellerPubkey: string, queryClient?: ReturnType<typeof useQueryClient>): Promise<OrderWithRelatedEvents[]> => {
	// Get NDK instance - ensure it's initialized
	let ndk = ndkActions.getNDK()
	if (!ndk) {
		// Try to initialize if not already initialized
		ndk = ndkActions.initialize()
		if (!ndk) {
			throw new Error('NDK not initialized')
		}
	}

	if (!sellerPubkey) {
		console.warn('fetchOrdersBySeller: sellerPubkey is empty, returning empty array')
		return []
	}

	// Ensure NDK is connected before querying
	const ndkState = ndkStore.state
	if (!ndkState.isConnected) {
		await ndkActions.connect()
	}

	// Re-check NDK after connection to ensure it's still valid
	ndk = ndkActions.getNDK()
	if (!ndk) {
		throw new Error('NDK not initialized after connection')
	}

	// Ensure NDK pool is ready before creating subscriptions
	if (!ndk.pool) {
		// Wait a bit for pool to initialize
		await new Promise(resolve => setTimeout(resolve, 100))
		ndk = ndkActions.getNDK()
		if (!ndk || !ndk.pool) {
			throw new Error('NDK pool not initialized')
		}
	}

	// Orders where the specified user is the recipient (merchant receiving orders)
	// Per gamma_spec.md, we can't filter by #type or #order tags - they're not valid Nostr filter tags
	// We fetch all Kind 16 messages and decrypt to filter by type tag client-side
	const orderReceivedFilter: NDKFilter = {
		kinds: [ORDER_PROCESS_KIND],
		'#p': [sellerPubkey],
		limit: 100,
	}

	const relayUrls = ndk.explicitRelayUrls || (ndk.pool?.relays ? Array.from(ndk.pool.relays.keys()) : [])

	let orders: Set<NDKEvent>
	// Track order IDs dynamically as they're discovered
	const orderIdsSet = new Set<string>()
	// Declare related events subscription outside try block so it's accessible later
	let relatedEventsSubscription: NDKSubscription | null = null
	
	try {
		// Use subscription - we'll handle closing ourselves to avoid NDK internal timeout conflicts
		const ordersSet = new Set<NDKEvent>()
		
		// Verify NDK is ready before creating subscription
		if (!ndk || !ndk.pool) {
			throw new Error('NDK not ready for subscription')
		}
		
		const subscription = ndk.subscribe(orderReceivedFilter, {
			closeOnEose: false, // Handle closing ourselves to avoid NDK internal timeout errors
		})

		// Get signer for decryption
		const signer = ndkActions.getSigner()

		// Track all pending decryption promises
		const pendingDecryptions: Promise<void>[] = []
		let subscriptionClosed = false
		let lastEventReceivedTime = Date.now()
		
		// Start related events subscription in parallel
		const relatedEventsFilter: NDKFilter = {
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			limit: 500,
		}
		
		if (queryClient) {
			try {
				relatedEventsSubscription = ndk.subscribe(relatedEventsFilter, {
					closeOnEose: false,
				})
			} catch (subError) {
				console.error('🔍 fetchOrdersBySeller: Error creating related events subscription:', subError)
			}
		}

		subscription.on('event', async (event: NDKEvent) => {
			// Update last event time for inactivity tracking
			lastEventReceivedTime = Date.now()
			
			// Skip processing if subscription is already closed
			if (subscriptionClosed) {
				return
			}

			// Ensure NDK is still valid before processing
			const currentNdk = ndkActions.getNDK()
			if (!currentNdk) {
				console.warn('🔍 fetchOrdersBySeller: NDK became invalid during event processing, skipping event')
				return
			}

			// Decrypt and filter by type tag client-side
			const decryptionPromise = (async () => {
				try {
					// Re-check signer and NDK before decrypting
					const currentSigner = ndkActions.getSigner()
					if (!currentSigner) {
						console.warn('🔍 fetchOrdersBySeller: Signer not available for decryption')
						return
					}

					let decrypted = false
					if (currentSigner && event.content) {
						// Check if content looks encrypted (not JSON)
						const contentLooksEncrypted = !event.content.trim().startsWith('{') && !event.content.trim().startsWith('[')
						if (contentLooksEncrypted) {
							// Check again if decryption is still allowed before attempting
							if (subscriptionClosed) {
								return
							}
							try {
								await event.decrypt(undefined, currentSigner)
								decrypted = true
							} catch (decryptError) {
								// Decryption failed - continue to check tags
								const errorMsg = decryptError instanceof Error ? decryptError.message : String(decryptError)
								// If decryption fails due to subscription being closed or NDK issues, don't process further
								if (errorMsg.includes('initialization') || errorMsg.includes('not initialized')) {
									return
								}
							}
						}
					}
					
					// Only process if subscription hasn't closed
					if (!subscriptionClosed) {
						// Check type tag after decryption attempt
						const typeTag = event.tags.find((tag) => tag[0] === 'type')
						const orderTag = event.tags.find((tag) => tag[0] === 'order')
						
						// If type tag matches ORDER_CREATION, add the event
						if (typeTag && typeTag[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
							ordersSet.add(event)
							// Track order ID as it's discovered
							if (orderTag?.[1]) {
								orderIdsSet.add(orderTag[1])
							}
						}
					}
				} catch (error) {
					// General error - log but continue if we haven't closed
					if (!subscriptionClosed) {
						const errorMsg = error instanceof Error ? error.message : String(error)
					}
				}
			})()

			// Track this decryption promise
			pendingDecryptions.push(decryptionPromise)
		})
		
		// Set up related events handler if subscription was created
		if (relatedEventsSubscription && queryClient) {
			const updateCacheForOrder = (orderId: string, event: NDKEvent) => {
				if (!queryClient) return
				
				let currentData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(sellerPubkey))
				
				if (!currentData) {
					setTimeout(() => {
						currentData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(sellerPubkey))
						if (!currentData) return
						updateCacheForOrderInner(orderId, event, currentData)
					}, 100)
					return
				}
				
				updateCacheForOrderInner(orderId, event, currentData)
			}
			
			const updateCacheForOrderInner = (orderId: string, event: NDKEvent, currentData: OrderWithRelatedEvents[]) => {
				let orderFound = false
				let eventAdded = false
				
				const updatedData = currentData.map((orderData) => {
					const orderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
					const dataOrderId = orderTag?.[1]
					if (dataOrderId !== orderId) {
						return orderData
					}

					orderFound = true

					const paymentRequests = [...orderData.paymentRequests]
					const statusUpdates = [...orderData.statusUpdates]
					const shippingUpdates = [...orderData.shippingUpdates]
					const generalMessages = [...orderData.generalMessages]
					const paymentReceipts = [...orderData.paymentReceipts]

					const eventExists = (arr: NDKEvent[]) => arr.some(e => e.id === event.id)
					
					if (event.kind === ORDER_PROCESS_KIND) {
						const typeTag = event.tags.find((tag) => tag[0] === 'type')
						if (typeTag) {
							switch (typeTag[1]) {
								case ORDER_MESSAGE_TYPE.PAYMENT_REQUEST:
									if (!eventExists(paymentRequests)) {
										paymentRequests.push(event)
										paymentRequests.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
										eventAdded = true
									}
									break
								case ORDER_MESSAGE_TYPE.STATUS_UPDATE:
									if (!eventExists(statusUpdates)) {
										statusUpdates.push(event)
										statusUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
										eventAdded = true
									}
									break
								case ORDER_MESSAGE_TYPE.SHIPPING_UPDATE:
									if (!eventExists(shippingUpdates)) {
										shippingUpdates.push(event)
										shippingUpdates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
										eventAdded = true
									}
									break
							}
						}
					} else if (event.kind === ORDER_GENERAL_KIND) {
						if (!eventExists(generalMessages)) {
							generalMessages.push(event)
							generalMessages.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
							eventAdded = true
						}
					} else if (event.kind === PAYMENT_RECEIPT_KIND) {
						if (!eventExists(paymentReceipts)) {
							paymentReceipts.push(event)
							paymentReceipts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
							eventAdded = true
						}
					}

					return {
						...orderData,
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
				})

				if (orderFound && eventAdded) {
					const newDataArray = updatedData.map(order => ({
						...order,
						paymentRequests: [...order.paymentRequests],
						statusUpdates: [...order.statusUpdates],
						shippingUpdates: [...order.shippingUpdates],
						generalMessages: [...order.generalMessages],
						paymentReceipts: [...order.paymentReceipts],
					}))
					
					console.log('🔍 fetchOrdersBySeller: Updating cache for order', orderId, 'event kind:', event.kind)
					queryClient.setQueryData(orderKeys.bySeller(sellerPubkey), newDataArray)
					queryClient.invalidateQueries({ 
						queryKey: orderKeys.bySeller(sellerPubkey),
						refetchType: 'none',
					})
				}
			}
			
			let relatedEventsClosed = false
			
			relatedEventsSubscription.on('event', async (event: NDKEvent) => {
				if (relatedEventsClosed) return

				try {
					if (signer && event.content) {
						const contentLooksEncrypted = !event.content.trim().startsWith('{') && !event.content.trim().startsWith('[')
						if (contentLooksEncrypted) {
							try {
								await event.decrypt(undefined, signer)
							} catch (decryptError) {
								const errorMsg = decryptError instanceof Error ? decryptError.message : String(decryptError)
								if (!errorMsg.includes('invalid base64') && !errorMsg.includes('Invalid padding') && !errorMsg.includes('invalid payload length') && !errorMsg.includes('Unknown letter')) {
									console.warn('🔍 fetchOrdersBySeller: Unexpected decryption error:', errorMsg)
								}
							}
						}
					}
					
					const orderTag = event.tags.find((tag) => tag[0] === 'order')
					if (orderTag && orderTag[1]) {
						const orderId = orderTag[1]
						// Check if this order ID is in our set (might have been added after subscription started)
						if (orderIdsSet.has(orderId)) {
							updateCacheForOrder(orderId, event)
						} else {
							// Check if this order exists in the cache (order IDs might not be in set yet)
							const currentData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(sellerPubkey))
							if (currentData) {
								const orderExists = currentData.some((orderData) => {
									const dataOrderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
									return dataOrderTag?.[1] === orderId
								})
								if (orderExists) {
									orderIdsSet.add(orderId) // Add to set for future events
									updateCacheForOrder(orderId, event)
								}
							}
						}
					}
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error)
					if (!errorMsg.includes('invalid base64') && !errorMsg.includes('Invalid padding') && !errorMsg.includes('invalid payload length') && !errorMsg.includes('Unknown letter')) {
						console.warn('🔍 fetchOrdersBySeller: Error processing related event:', errorMsg)
					}
				}
			})
			
			// Don't start related events subscription here - it will be started after orders subscription completes
		}

		// Set up eose and close handlers BEFORE starting
		let stopped = false
		const stopSubscription = () => {
			if (!stopped) {
				stopped = true
				subscriptionClosed = true
				// Don't call stop() - let NDK handle cleanup naturally with closeOnEose
				// Manually stopping causes NDK internal errors
			}
		}

		// Helper to wait for all pending decryptions
		const waitForDecryptions = async (): Promise<void> => {
			if (pendingDecryptions.length === 0) return
			
			try {
				// Wait for all pending decryptions with a reasonable timeout
				await Promise.allSettled(pendingDecryptions)
			} catch (error) {
				// Ignore errors - we've already handled them in the decryption promise
				console.warn('🔍 fetchOrdersBySeller: Some decryptions failed:', error)
			}
		}

		// Start subscription AFTER handlers are set up but BEFORE Promise.race
		subscription.start()

		await Promise.race([
			new Promise<void>((resolvePromise) => {
				let eoseReceived = false
				let inactivityTimer: NodeJS.Timeout | null = null
				const INACTIVITY_TIMEOUT = 1500 // Reduced to 1.5s after last event before closing for faster loading

				const checkInactivityAndClose = async () => {
					const timeSinceLastEvent = Date.now() - lastEventReceivedTime
					if (timeSinceLastEvent >= INACTIVITY_TIMEOUT) {
						if (inactivityTimer) clearTimeout(inactivityTimer)
						await waitForDecryptions()
						stopSubscription()
						resolvePromise()
					} else {
						// Schedule another check
						const remainingTime = INACTIVITY_TIMEOUT - timeSinceLastEvent
						inactivityTimer = setTimeout(checkInactivityAndClose, remainingTime)
					}
				}

				const timeout = setTimeout(async () => {
					if (inactivityTimer) clearTimeout(inactivityTimer)
					await waitForDecryptions()
					stopSubscription()
					resolvePromise()
				}, 3000) // Reduced timeout to 3s for faster loading

				subscription.on('eose', async () => {
					eoseReceived = true
					// Wait shorter after EOSE before starting inactivity check
					setTimeout(() => {
						checkInactivityAndClose()
					}, 1000) // Reduced wait after EOSE to 1s for faster loading
				})

				subscription.on('close', async () => {
					clearTimeout(timeout)
					if (inactivityTimer) clearTimeout(inactivityTimer)
					await waitForDecryptions()
					stopSubscription()
					resolvePromise()
				})
			}),
			// Fallback timeout to ensure we never wait more than 5s total
			new Promise<void>((resolvePromise) => {
				setTimeout(async () => {
					await waitForDecryptions()
					stopSubscription()
					resolvePromise()
				}, 5000) // Reduced fallback timeout for faster loading
			})
		])

		orders = ordersSet
		console.log('🔍 fetchOrdersBySeller: Subscription completed, found', orders.size, 'orders')
	} catch (error) {
		console.error('🔍 fetchOrdersBySeller: Error fetching orders:', error)
		orders = new Set()
	}

	if (orders.size === 0) {
		return []
	}

	// Get all order IDs (populate from Set we built during subscription)
	const orderIds = Array.from(orderIdsSet).filter(Boolean)

	// Get existing cached data to merge related events if available
	const existingCache = queryClient?.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(sellerPubkey))

	// Create initial result - merge with existing cache if available
	const initialResult = Array.from(orders).map((order) => {
		const orderTag = order.tags.find((tag) => tag[0] === 'order')
		const orderId = orderTag?.[1] || ''
		
		// Add order ID to set so related events subscription can match it
		if (orderId) {
			orderIdsSet.add(orderId)
		}
		
		// Check if we have cached related events for this order
		let cachedRelatedEvents: OrderWithRelatedEvents | undefined
		if (existingCache && orderId) {
			cachedRelatedEvents = existingCache.find((cached) => {
				const cachedOrderTag = cached.order.tags.find((tag) => tag[0] === 'order')
				return cachedOrderTag?.[1] === orderId
			})
		}
		
		return {
			order,
			paymentRequests: cachedRelatedEvents?.paymentRequests || [],
			statusUpdates: cachedRelatedEvents?.statusUpdates || [],
			shippingUpdates: cachedRelatedEvents?.shippingUpdates || [],
			generalMessages: cachedRelatedEvents?.generalMessages || [],
			paymentReceipts: cachedRelatedEvents?.paymentReceipts || [],
			latestStatus: cachedRelatedEvents?.latestStatus,
			latestShipping: cachedRelatedEvents?.latestShipping,
			latestPaymentRequest: cachedRelatedEvents?.latestPaymentRequest,
			latestPaymentReceipt: cachedRelatedEvents?.latestPaymentReceipt,
			latestMessage: cachedRelatedEvents?.latestMessage,
		}
	})

	// Don't set cache directly here - let the queryFn handle caching and merging
	// Setting cache here would overwrite existing related events

	// Start fetching related events in parallel AFTER orders are found (don't wait)
	if (queryClient && relatedEventsSubscription) {
		// Ensure order IDs are populated
		console.log('🔍 fetchOrdersBySeller: Order IDs ready for related events:', Array.from(orderIdsSet))
		
		// Start related events subscription after ensuring it's fully initialized
		// Use longer delay and verify subscription is ready before starting
		setTimeout(() => {
			try {
				if (!relatedEventsSubscription || !ndk || !ndk.pool) {
					return
				}

				// Verify subscription has start method
				if ('start' in relatedEventsSubscription && typeof relatedEventsSubscription.start === 'function') {
					relatedEventsSubscription.start()
					console.log('🔍 fetchOrdersBySeller: Started related events subscription in parallel')
				}
			} catch (startError) {
				// Ignore "Cannot access 's' before initialization" errors - subscription might auto-start
				const errorMsg = startError instanceof Error ? startError.message : String(startError)
				if (errorMsg.includes("Cannot access 's' before initialization") || errorMsg.includes("before initialization")) {
					console.log('🔍 fetchOrdersBySeller: Subscription already initialized or auto-started')
				} else {
					console.error('🔍 fetchOrdersBySeller: Error starting related events subscription:', startError)
				}
			}
		}, 400) // Longer delay to ensure subscription is fully initialized
	}

	// Return orders immediately - related events subscription is fetching in parallel
	// The queryFn will handle caching and merging with existing cache
	return initialResult
}

/**
 * Hook to fetch orders where the specified user is the seller
 */
export const useOrdersBySeller = (sellerPubkey: string) => {
	const ndk = ndkActions.getNDK()
	const ndkState = useStore(ndkStore)
	const isConnected = ndkState.isConnected
	const queryClient = useQueryClient()
	
	// Enable query when NDK is initialized (not just connected)
	// The queryFn will handle connecting NDK if needed
	const queryEnabled = !!sellerPubkey && !!ndk
	
	const queryResult = useQuery({
		queryKey: orderKeys.bySeller(sellerPubkey),
		queryFn: async () => {
			// Get cached data before attempting fetch
			const cachedData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(sellerPubkey))
			
			try {
				const result = await fetchOrdersBySeller(sellerPubkey, queryClient)
				
				// If result is empty but we have cached data, preserve cache to prevent disappearing
				if (result.length === 0 && cachedData && cachedData.length > 0) {
					return cachedData
				}
				
				// ALWAYS merge result with cached data to preserve related events
				// This ensures cache is never wiped - we always preserve what's already there
				if (cachedData && cachedData.length > 0) {
					// Create a map of cached orders by order ID for quick lookup
					const cachedMap = new Map<string, OrderWithRelatedEvents>()
					cachedData.forEach((cachedOrder) => {
						const orderTag = cachedOrder.order.tags.find((tag) => tag[0] === 'order')
						const orderId = orderTag?.[1]
						if (orderId) {
							cachedMap.set(orderId, cachedOrder)
						}
					})
					
					// Merge: if result has empty related events but cache has them, use cache's related events
					const mergedResult = result.map((orderData) => {
						const orderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
						const orderId = orderTag?.[1]
						if (!orderId) return orderData
						
						const cachedOrder = cachedMap.get(orderId)
						if (!cachedOrder) return orderData
						
						// If result has empty related events but cache has them, use cache's related events
						const hasRelatedEvents = 
							orderData.statusUpdates.length > 0 ||
							orderData.paymentReceipts.length > 0 ||
							orderData.shippingUpdates.length > 0 ||
							orderData.paymentRequests.length > 0 ||
							orderData.generalMessages.length > 0
						
						const cachedHasRelatedEvents = 
							cachedOrder.statusUpdates.length > 0 ||
							cachedOrder.paymentReceipts.length > 0 ||
							cachedOrder.shippingUpdates.length > 0 ||
							cachedOrder.paymentRequests.length > 0 ||
							cachedOrder.generalMessages.length > 0
						
						// CRITICAL: If result doesn't have related events but cache does, use cache's related events
						// This prevents status reset when fetchOrdersBySeller returns empty arrays
						if (!hasRelatedEvents && cachedHasRelatedEvents) {
							// Return cached order with updated order event (in case order event changed)
							return {
								...cachedOrder,
								order: orderData.order, // Use latest order event
							}
						}
						
						// Otherwise, merge: take the union of events from both (deduplicated by event ID)
						// Cached events are added first, then result events (they take precedence if duplicate)
						const mergeEvents = (resultEvents: NDKEvent[], cachedEvents: NDKEvent[]) => {
							const eventMap = new Map<string, NDKEvent>()
							// First add cached events (preserve what's already in cache)
							cachedEvents.forEach(e => eventMap.set(e.id, e))
							// Then add result events (they take precedence if duplicate)
							resultEvents.forEach(e => eventMap.set(e.id, e))
							return Array.from(eventMap.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
						}
						
						return {
							...orderData,
							paymentRequests: mergeEvents(orderData.paymentRequests, cachedOrder.paymentRequests),
							statusUpdates: mergeEvents(orderData.statusUpdates, cachedOrder.statusUpdates),
							shippingUpdates: mergeEvents(orderData.shippingUpdates, cachedOrder.shippingUpdates),
							generalMessages: mergeEvents(orderData.generalMessages, cachedOrder.generalMessages),
							paymentReceipts: mergeEvents(orderData.paymentReceipts, cachedOrder.paymentReceipts),
							latestStatus: mergeEvents(orderData.statusUpdates, cachedOrder.statusUpdates)[0],
							latestShipping: mergeEvents(orderData.shippingUpdates, cachedOrder.shippingUpdates)[0],
							latestPaymentRequest: mergeEvents(orderData.paymentRequests, cachedOrder.paymentRequests)[0],
							latestPaymentReceipt: mergeEvents(orderData.paymentReceipts, cachedOrder.paymentReceipts)[0],
							latestMessage: mergeEvents(orderData.generalMessages, cachedOrder.generalMessages)[0],
						}
					})
					
					// Cache the merged result to preserve related events - this prevents cache from being wiped
					queryClient.setQueryData(orderKeys.bySeller(sellerPubkey), mergedResult)
					return mergedResult
				}
				
				// No cached data - cache the result as-is
				queryClient.setQueryData(orderKeys.bySeller(sellerPubkey), result)
				return result
			} catch (error) {
				console.error('🔍 useOrdersBySeller: queryFn error:', error)
				// Check if we have existing cache data - don't overwrite with empty array on error
				if (cachedData && cachedData.length > 0) {
					return cachedData
				}
				// Only return empty array if we truly have no cached data
				return []
			}
		},
		enabled: queryEnabled,
		refetchOnMount: false, // Don't refetch on mount - use cache if available
		refetchOnWindowFocus: false, // Don't refetch on window focus - preserve cache
		refetchOnReconnect: true, // Refetch when reconnecting to network
		staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
		gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes (increased for better persistence)
		// Return empty array as placeholder data when disabled
		placeholderData: queryEnabled ? undefined : [],
		retry: 1, // Only retry once on failure
		retryDelay: 1000, // Wait 1s before retry
		notifyOnChangeProps: ['data', 'error', 'status'], // Explicitly notify on these changes
		structuralSharing: false, // Disable structural sharing to ensure React detects all changes
	})

	// Refetch when NDK connects to ensure we get fresh data
	useEffect(() => {
		if (!queryEnabled || !isConnected) return
		
		// Only refetch if we don't have data or if data is stale
		const queryData = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(sellerPubkey))
		if (queryData && queryData.length > 0) {
			// We have data, don't aggressively refetch
			return
		}
		
		// Small delay to ensure connection is fully established
		const timer = setTimeout(() => {
			queryClient.refetchQueries({ queryKey: orderKeys.bySeller(sellerPubkey) }).catch((err) => {
				console.warn('Failed to refetch orders after NDK connection:', err)
			})
		}, 100)
		
		return () => clearTimeout(timer)
	}, [isConnected, queryEnabled, sellerPubkey, queryClient])

	return queryResult
}

/**
 * Fetches a specific order by its ID
 * Checks cache first before making REQ
 */
export const fetchOrderById = async (orderId: string, queryClient?: ReturnType<typeof useQueryClient>): Promise<OrderWithRelatedEvents | null> => {
	// Check cache first if queryClient is provided
	if (queryClient) {
		// Check if order is in detail cache
		const cachedOrder = queryClient.getQueryData<OrderWithRelatedEvents>(orderKeys.details(orderId))
		if (cachedOrder) {
			console.log(`🔍 fetchOrderById: Found order ${orderId} in detail cache`)
			return cachedOrder
		}

		// Check if order is in list caches (buyer/seller orders)
		const signer = ndkActions.getSigner()
		const user = signer ? await signer.user().catch(() => null) : null
		const userPubkey = user?.pubkey

		if (userPubkey) {
			const buyerOrders = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(userPubkey)) || []
			const sellerOrders = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(userPubkey)) || []
			const allCachedOrders = [...buyerOrders, ...sellerOrders]

			const found = allCachedOrders.find((order) => {
				const orderTag = order.order.tags.find((tag) => tag[0] === 'order')
				return orderTag?.[1] === orderId
			})

			if (found) {
				console.log(`🔍 fetchOrderById: Found order ${orderId} in list cache`)
				// Cache it in detail cache for future lookups
				queryClient.setQueryData(orderKeys.details(orderId), found)
				return found
			}
		}
	}

	let ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Ensure NDK is connected before querying
	const ndkState = ndkStore.state
	if (!ndkState.isConnected) {
		console.log(`🔍 fetchOrderById: NDK not connected, connecting...`)
		await ndkActions.connect()
		console.log(`🔍 fetchOrderById: NDK connection status:`, ndkStore.state.isConnected)
	}

	// Re-check NDK after connection
	ndk = ndkActions.getNDK()
	if (!ndk) {
		throw new Error('NDK not initialized after connection')
	}

	// Ensure NDK pool is ready before creating subscriptions
	if (!ndk.pool) {
		// Wait a bit for pool to initialize
		await new Promise(resolve => setTimeout(resolve, 100))
		ndk = ndkActions.getNDK()
		if (!ndk || !ndk.pool) {
			throw new Error('NDK pool not initialized')
		}
	}

	console.log(`🔍 fetchOrderById: Searching for order with ID: ${orderId} (not in cache)`)

	// Check if we have a UUID format or a hash format
	const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(orderId)
	const isHash = /^[0-9a-f]{64}$/.test(orderId)

	console.log(`🔍 fetchOrderById: Order ID format - UUID: ${isUuid}, Hash: ${isHash}`)

	// According to gamma_spec.md, Kind 16 messages use NIP-17 encrypted direct messages
	// The tags (type, order) are NOT encrypted - they're in the public tags array
	// However, we should filter by authors/#p and kinds, then check tags client-side
	// For order lookup, we can use the subject tag which may contain order info, or filter by authors/#p
	
	// Get user pubkey to filter messages they're involved in
	const signer = ndkActions.getSigner()
	const user = signer ? await signer.user().catch(() => null) : null
	const userPubkey = user?.pubkey

	if (!userPubkey) {
		console.warn('🔍 fetchOrderById: No user pubkey available, cannot filter encrypted messages')
		return null
	}

	// Per NIP-17 and gamma_spec.md, Kind 16 messages are encrypted
	// The order tag is encrypted, so we can't filter by it on the relay
	// We need to fetch all Kind 16 messages where the user is involved and decrypt to check the order tag
	// Try both as author (orders they sent) and as recipient (orders they received)
	
	// Fetch order creation event using subscription with timeout
	let orderEvent: NDKEvent | null = null
	try {
		const orderEventsSet = new Set<NDKEvent>()
		
		// Log which relays will be used
		const relayUrls = ndk.explicitRelayUrls || (ndk.pool?.relays ? Array.from(ndk.pool.relays.keys()) : [])
		const connectedRelays = ndk.pool?.connectedRelays()?.map(r => r.url) || []
		console.log(`🔍 fetchOrderById: Using relays:`, relayUrls)
		console.log(`🔍 fetchOrderById: Connected relays:`, connectedRelays)
		console.log(`🔍 fetchOrderById: Searching for order ID: ${orderId}`)
		
		// Create subscriptions for both author and recipient
		const filters: NDKFilter[] = [
			{
				kinds: [ORDER_PROCESS_KIND],
				authors: [userPubkey],
				limit: 100,
			},
			{
				kinds: [ORDER_PROCESS_KIND],
				'#p': [userPubkey],
				limit: 100,
			},
		]

		// Verify NDK is ready before creating subscriptions
		if (!ndk || !ndk.pool) {
			throw new Error('NDK not ready for subscription')
		}

		// Try both filters and combine results
		const subscriptions = filters.map(filter => ndk.subscribe(filter, { closeOnEose: true }))
		
		for (const subscription of subscriptions) {
			subscription.on('event', async (event: NDKEvent) => {
				console.log(`🔍 fetchOrderById: Received event:`, event.id, event.pubkey, `tags (before decrypt):`, event.tags)
				
				// Check if tags are already visible (event might not be encrypted)
				let orderTag = event.tags.find((tag) => tag[0] === 'order')
				let typeTag = event.tags.find((tag) => tag[0] === 'type')
				
				// If tags are not visible, try to decrypt
				if (!orderTag && signer && event.content) {
					try {
						// Check if content looks encrypted (not JSON)
						const contentLooksEncrypted = !event.content.trim().startsWith('{') && !event.content.trim().startsWith('[')
						if (contentLooksEncrypted) {
							await event.decrypt(undefined, signer)
							console.log(`🔍 fetchOrderById: Decrypted event ${event.id}, tags (after decrypt):`, event.tags)
							// Re-check tags after decryption
							orderTag = event.tags.find((tag) => tag[0] === 'order')
							typeTag = event.tags.find((tag) => tag[0] === 'type')
						}
					} catch (error) {
						// Decryption failed - log but continue to check tags
						console.log(`🔍 fetchOrderById: Decryption failed for event ${event.id}:`, error instanceof Error ? error.message : error)
					}
				}
				
				console.log(`🔍 fetchOrderById: Event ${event.id} order tag:`, orderTag, `type tag:`, typeTag)
				
				// Check if this is the order we're looking for
				if (orderTag && orderTag[1] === orderId && typeTag && typeTag[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
					console.log(`🔍 fetchOrderById: ✅ Found matching order event:`, event.id)
					orderEventsSet.add(event)
				} else {
					console.log(`🔍 fetchOrderById: ❌ Event ${event.id} does not match (order tag: ${orderTag?.[1] || 'missing'}, expected: ${orderId}, type tag: ${typeTag?.[1] || 'missing'})`)
				}
			})
		}

		// Set up stop handlers for all subscriptions
		const stoppedSet = new Set<number>()
		const stopAllSubscriptions = () => {
			// Don't call stop() - let NDK handle cleanup naturally with closeOnEose
			// Manually stopping causes NDK internal errors
			subscriptions.forEach((sub, index) => {
				if (!stoppedSet.has(index)) {
					stoppedSet.add(index)
				}
			})
		}

		// Set up eose and close handlers for all subscriptions
		// Each subscription completes when it receives EOSE or close
		const subscriptionCompletePromises: Promise<void>[] = []
		
		subscriptions.forEach((subscription, index) => {
			const completePromise = new Promise<void>((resolve) => {
				let resolved = false
				const markComplete = () => {
					if (!resolved) {
						resolved = true
						resolve()
					}
				}
				
				subscription.on('eose', () => {
					console.log(`🔍 fetchOrderById: EOSE received for subscription ${index}`)
					markComplete()
				})

				subscription.on('close', () => {
					console.log(`🔍 fetchOrderById: Close received for subscription ${index}`)
					markComplete()
				})
			})
			subscriptionCompletePromises.push(completePromise)

			// Start subscription AFTER handlers are set up
			subscription.start()
		})
		
		console.log(`🔍 fetchOrderById: Started ${subscriptions.length} subscriptions, waiting for events...`)

		// Wait for all subscriptions to complete or timeout
		// Create a combined promise that resolves when all subscriptions complete
		const allSubscriptionsComplete = Promise.all(subscriptionCompletePromises).then(() => {
			console.log(`🔍 fetchOrderById: All subscriptions completed`)
			stopAllSubscriptions()
		})

		await Promise.race([
			allSubscriptionsComplete,
			new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					console.log(`🔍 fetchOrderById: Timeout reached after 3s, stopping all subscriptions`)
					stopAllSubscriptions()
					resolve()
				}, 3000) // 3 second timeout
			}),
			// Fallback timeout
			new Promise<void>((resolve) => {
				setTimeout(() => {
					console.log(`🔍 fetchOrderById: Fallback timeout reached after 3.5s`)
					stopAllSubscriptions()
					resolve()
				}, 3500)
			})
		])

		console.log(`🔍 fetchOrderById: Subscription completed, found ${orderEventsSet.size} events`)

		if (orderEventsSet.size === 0) {
			console.log(`🔍 fetchOrderById: No order events found for ID: ${orderId}`)
			console.log(`🔍 fetchOrderById: Relay URLs used:`, relayUrls)
			console.log(`🔍 fetchOrderById: Filters used:`, filters)
			return null
		}
		orderEvent = Array.from(orderEventsSet)[0] // Take the first matching order event
		console.log(`🔍 fetchOrderById: Found order event: ${orderEvent.id}, order tag: ${orderEvent.tags.find((t) => t[0] === 'order')?.[1]}`)
	} catch (error) {
		console.error('🔍 fetchOrderById: Error fetching order event:', error)
		return null
	}

	if (!orderEvent) return null

	// Get the order ID from the order tag and event ID
	const orderIdFromTag = orderEvent.tags.find((tag) => tag[0] === 'order')?.[1]
	const eventId = orderEvent.id

	// Fetch all related events for this order
	// Per NIP-17 and gamma_spec.md, Kind 16 messages are encrypted - tags are encrypted
	// We can't filter by #order, #type, or #subject - fetch all events where user is involved and filter client-side
	const relatedEventsFilters: NDKFilter[] = [
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			authors: [userPubkey],
			limit: 500,
		},
		{
			kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
			'#p': [userPubkey],
			limit: 500,
		},
	]

	console.log(`🔍 fetchOrderById: Fetching related events with filters:`, relatedEventsFilters)
	console.log(`🔍 fetchOrderById: Connected relays for related events:`, ndk.pool?.connectedRelays()?.map(r => r.url) || [])

	// Fetch related events using subscription with timeout
	let relatedEvents: Set<NDKEvent> = new Set()
	try {
		// Verify NDK is still ready before creating subscriptions
		if (!ndk || !ndk.pool) {
			throw new Error('NDK not ready for subscription')
		}
		
		const relatedEventsSet = new Set<NDKEvent>()
		const subscriptions = relatedEventsFilters.map(filter => ndk.subscribe(filter, { closeOnEose: true }))

		for (const subscription of subscriptions) {
			subscription.on('event', async (event: NDKEvent) => {
				// Check if tags are already visible (event might not be encrypted)
				let orderTag = event.tags.find((tag) => tag[0] === 'order')
				
				// If tags are not visible, try to decrypt
				if (!orderTag && signer && event.content) {
					try {
						// Check if content looks encrypted (not JSON)
						const contentLooksEncrypted = !event.content.trim().startsWith('{') && !event.content.trim().startsWith('[')
						if (contentLooksEncrypted) {
							await event.decrypt(undefined, signer)
							// Re-check tags after decryption
							orderTag = event.tags.find((tag) => tag[0] === 'order')
						}
					} catch (error) {
						// Decryption failed - log but continue to check tags
						console.warn('🔍 fetchOrderById: Error processing related event:', error)
					}
				}
				
				// Check if this event is related to our order by checking the order tag
				if (orderTag && orderTag[1] === orderIdFromTag) {
					console.log(`🔍 fetchOrderById: Received related event:`, event.id, event.kind, event.tags.find(t => t[0] === 'type')?.[1])
					relatedEventsSet.add(event)
				}
			})
		}

		// Set up stop handlers for all subscriptions
		const stoppedSet = new Set<number>()
		const stopAllSubscriptions = () => {
			// Don't call stop() - let NDK handle cleanup naturally with closeOnEose
			// Manually stopping causes NDK internal errors
			subscriptions.forEach((sub, index) => {
				if (!stoppedSet.has(index)) {
					stoppedSet.add(index)
				}
			})
		}

		// Set up eose and close handlers for all subscriptions
		const subscriptionCompletePromises: Promise<void>[] = []

		subscriptions.forEach((subscription, index) => {
			const completePromise = new Promise<void>((resolve) => {
				let resolved = false
				const markComplete = () => {
					if (!resolved) {
						resolved = true
						resolve()
					}
				}

				subscription.on('eose', () => {
					console.log(`🔍 fetchOrderById: Related events EOSE received for subscription ${index}`)
					markComplete()
				})

				subscription.on('close', () => {
					console.log(`🔍 fetchOrderById: Related events close received for subscription ${index}`)
					markComplete()
				})
			})
			subscriptionCompletePromises.push(completePromise)

			// Start subscription AFTER handlers are set up
			subscription.start()
		})

		console.log(`🔍 fetchOrderById: Started ${subscriptions.length} subscriptions for related events, waiting...`)

		// Wait for all subscriptions to complete or timeout
		const allSubscriptionsComplete = Promise.all(subscriptionCompletePromises).then(() => {
			console.log(`🔍 fetchOrderById: All related events subscriptions completed`)
			stopAllSubscriptions()
		})

		await Promise.race([
			allSubscriptionsComplete,
			new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					console.log(`🔍 fetchOrderById: Related events timeout reached after 2s, stopping all subscriptions`)
					stopAllSubscriptions()
					resolve()
				}, 2000) // 2 second timeout
			}),
			// Fallback timeout
			new Promise<void>((resolve) => {
				setTimeout(() => {
					console.log(`🔍 fetchOrderById: Related events fallback timeout reached after 2.5s`)
					stopAllSubscriptions()
					resolve()
				}, 2500)
			})
		])

		relatedEvents = relatedEventsSet
		console.log(`🔍 fetchOrderById: Found ${relatedEvents.size} related events`)
	} catch (error) {
		console.error('🔍 fetchOrderById: Error fetching related events:', error)
		relatedEvents = new Set()
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

	const result: OrderWithRelatedEvents = {
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

	// Cache the result if queryClient is available
	if (queryClient) {
		queryClient.setQueryData(orderKeys.details(orderId), result)
		
		// Also update list cache if we have the user pubkey
		const signer = ndkActions.getSigner()
		const user = signer ? await signer.user().catch(() => null) : null
		const userPubkey = user?.pubkey
		
		if (userPubkey) {
			const updateListCache = (key: string[]) => {
				const listData = queryClient.getQueryData<OrderWithRelatedEvents[]>(key)
				if (listData) {
					const updatedList = listData.map((orderData) => {
						const orderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
						if (orderTag?.[1] !== orderId) return orderData
						// Replace with the full result from fetchOrderById
						return result
					})
					queryClient.setQueryData(key, updatedList)
				}
			}
			
			updateListCache(orderKeys.byBuyer(userPubkey))
			updateListCache(orderKeys.bySeller(userPubkey))
		}
	}

	return result
}

/**
 * Hook to fetch a specific order by its ID
 */
export const useOrderById = (orderId: string) => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const { user } = useStore(authStore)
	const userPubkey = user?.pubkey || ''
	
	// Prefetch list queries ONLY if cache is empty (don't refetch if cache exists)
	useEffect(() => {
		if (!userPubkey || !ndk) return

		// Check if we already have cached data - don't prefetch if cache exists
		const sellerCache = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(userPubkey))
		const buyerCache = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(userPubkey))

		// Only prefetch if cache is empty (pass queryClient so merge logic works)
		if (!sellerCache || sellerCache.length === 0) {
			queryClient.prefetchQuery({
				queryKey: orderKeys.bySeller(userPubkey),
				queryFn: () => fetchOrdersBySeller(userPubkey, queryClient),
				staleTime: 30000,
			})
		}

		if (!buyerCache || buyerCache.length === 0) {
			queryClient.prefetchQuery({
				queryKey: orderKeys.byBuyer(userPubkey),
				queryFn: () => fetchOrdersByBuyer(userPubkey, queryClient),
				staleTime: 30000,
			})
		}
	}, [userPubkey, ndk, queryClient])
	
	// Try to get order from list queries cache first - use useMemo to avoid initialization issues
	const cachedOrder = useMemo(() => {
		if (!orderId || !userPubkey) return undefined
		
		try {
			const sellerOrders = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.bySeller(userPubkey)) || []
			const buyerOrders = queryClient.getQueryData<OrderWithRelatedEvents[]>(orderKeys.byBuyer(userPubkey)) || []
			const allCachedOrders = [...sellerOrders, ...buyerOrders]
			
			// Find the order in cache by matching order ID
			// Use a local function to avoid potential hoisting issues
			const findOrderById = (order: OrderWithRelatedEvents): boolean => {
				const orderTag = order.order.tags.find((tag) => tag[0] === 'order')
				const cachedOrderId = orderTag?.[1]
				return cachedOrderId === orderId
			}

			const found = allCachedOrders.find(findOrderById)

			console.log(`🔍 useOrderById: Looking for order ${orderId} in cache, found: ${found ? 'yes' : 'no'}`)
			return found
		} catch (error) {
			console.error('🔍 useOrderById: Error reading from cache:', error)
			return undefined
		}
	}, [orderId, userPubkey, queryClient])

	// Set up a live subscription to monitor events for this order
	useEffect(() => {
		if (!orderId || !ndk || !userPubkey) return

		// Verify NDK pool is ready before creating subscriptions
		if (!ndk.pool) {
			console.warn('useOrderById: NDK pool not ready, skipping subscription')
			return
		}

		// Per NIP-17, Kind 16 messages are encrypted - tags are encrypted
		// We can't filter by #order - fetch all events where user is involved and filter client-side
		const relatedEventsFilters: NDKFilter[] = [
			{
				kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
				authors: [userPubkey],
			},
			{
				kinds: [ORDER_PROCESS_KIND, ORDER_GENERAL_KIND, PAYMENT_RECEIPT_KIND],
				'#p': [userPubkey],
			},
		]

		const subscriptions = relatedEventsFilters.map(filter => 
			ndk.subscribe(filter, { closeOnEose: false }) // Keep subscriptions open
		)

		// Get signer for decryption
		const signer = ndkActions.getSigner()

		// Set up event handlers BEFORE starting subscriptions to ensure handlers are registered
		for (const subscription of subscriptions) {
			subscription.on('event', async (newEvent) => {
				// Check if tags are already visible (event might not be encrypted)
				let orderTag = newEvent.tags.find((tag) => tag[0] === 'order')
				
				// If tags are not visible, try to decrypt
				if (!orderTag && signer && newEvent.content) {
					try {
						// Check if content looks encrypted (not JSON)
						const contentLooksEncrypted = !newEvent.content.trim().startsWith('{') && !newEvent.content.trim().startsWith('[')
						if (contentLooksEncrypted) {
							await newEvent.decrypt(undefined, signer)
							// Re-check tags after decryption
							orderTag = newEvent.tags.find((tag) => tag[0] === 'order')
						}
					} catch (error) {
						console.warn('useOrderById: Error processing live event:', error)
						return
					}
				}
				
				// Check if this event is related to our order by checking the order tag
				if (!orderTag || orderTag[1] !== orderId) {
					// Not related to our order, skip
					return
				}

				// Update cache directly instead of invalidating/refetching to preserve related events
				if (newEvent.kind === ORDER_PROCESS_KIND) {
					const typeTag = newEvent.tags.find((tag) => tag[0] === 'type')
					if (typeTag && (typeTag[1] === ORDER_MESSAGE_TYPE.STATUS_UPDATE || typeTag[1] === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE)) {
						console.log(`🔍 useOrderById: Status/shipping update received, updating cache directly`)
						
						// Update detail cache
						const currentDetail = queryClient.getQueryData<OrderWithRelatedEvents>(orderKeys.details(orderId))
						if (currentDetail) {
							const updatedDetail = { ...currentDetail }
							if (typeTag[1] === ORDER_MESSAGE_TYPE.STATUS_UPDATE) {
								const existing = updatedDetail.statusUpdates.find(e => e.id === newEvent.id)
								if (!existing) {
									updatedDetail.statusUpdates = [...updatedDetail.statusUpdates, newEvent].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
									updatedDetail.latestStatus = updatedDetail.statusUpdates[0]
									queryClient.setQueryData(orderKeys.details(orderId), updatedDetail)
								}
							} else if (typeTag[1] === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE) {
								const existing = updatedDetail.shippingUpdates.find(e => e.id === newEvent.id)
								if (!existing) {
									updatedDetail.shippingUpdates = [...updatedDetail.shippingUpdates, newEvent].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
									updatedDetail.latestShipping = updatedDetail.shippingUpdates[0]
									queryClient.setQueryData(orderKeys.details(orderId), updatedDetail)
								}
							}
						}
						
						// Update list cache (buyer and seller) - update directly to preserve cache
						if (userPubkey) {
							const updateListCache = (key: string[]) => {
								const listData = queryClient.getQueryData<OrderWithRelatedEvents[]>(key)
								if (listData) {
									const updatedList = listData.map((orderData) => {
										const orderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
										if (orderTag?.[1] !== orderId) return orderData
										
										const updated = { ...orderData }
										if (typeTag[1] === ORDER_MESSAGE_TYPE.STATUS_UPDATE) {
											const existing = updated.statusUpdates.find(e => e.id === newEvent.id)
											if (!existing) {
												updated.statusUpdates = [...updated.statusUpdates, newEvent].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
												updated.latestStatus = updated.statusUpdates[0]
											}
										} else if (typeTag[1] === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE) {
											const existing = updated.shippingUpdates.find(e => e.id === newEvent.id)
											if (!existing) {
												updated.shippingUpdates = [...updated.shippingUpdates, newEvent].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
												updated.latestShipping = updated.shippingUpdates[0]
											}
										}
										return updated
									})
									queryClient.setQueryData(key, updatedList)
								}
							}
							
							updateListCache(orderKeys.byBuyer(userPubkey))
							updateListCache(orderKeys.bySeller(userPubkey))
						}
					}
				} else if (newEvent.kind === PAYMENT_RECEIPT_KIND) {
					console.log('🔍 useOrderById: Payment receipt received, updating cache directly:', newEvent.id)
					
					// Update detail cache
					const currentDetail = queryClient.getQueryData<OrderWithRelatedEvents>(orderKeys.details(orderId))
					if (currentDetail) {
						const updatedDetail = { ...currentDetail }
						const existing = updatedDetail.paymentReceipts.find(e => e.id === newEvent.id)
						if (!existing) {
							updatedDetail.paymentReceipts = [...updatedDetail.paymentReceipts, newEvent].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
							updatedDetail.latestPaymentReceipt = updatedDetail.paymentReceipts[0]
							queryClient.setQueryData(orderKeys.details(orderId), updatedDetail)
						}
					}
					
					// Update list cache (buyer and seller) - update directly to preserve cache
					if (userPubkey) {
						const updateListCache = (key: string[]) => {
							const listData = queryClient.getQueryData<OrderWithRelatedEvents[]>(key)
							if (listData) {
								const updatedList = listData.map((orderData) => {
									const orderTag = orderData.order.tags.find((tag) => tag[0] === 'order')
									if (orderTag?.[1] !== orderId) return orderData
									
									const updated = { ...orderData }
									const existing = updated.paymentReceipts.find(e => e.id === newEvent.id)
									if (!existing) {
										updated.paymentReceipts = [...updated.paymentReceipts, newEvent].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
										updated.latestPaymentReceipt = updated.paymentReceipts[0]
									}
									return updated
								})
								queryClient.setQueryData(key, updatedList)
							}
						}
						
						updateListCache(orderKeys.byBuyer(userPubkey))
						updateListCache(orderKeys.bySeller(userPubkey))
					}
				}
			})

		// Start subscriptions AFTER all handlers are set up
		// Add delay to ensure subscriptions are fully initialized before starting
		setTimeout(() => {
			for (const subscription of subscriptions) {
				try {
					// Verify subscription is still valid before starting
					if (!ndk || !ndk.pool || !subscription) {
						continue
					}

					// Verify subscription has start method
					if ('start' in subscription && typeof subscription.start === 'function') {
						subscription.start()
					}
				} catch (startError) {
					// Ignore "Cannot access 's' before initialization" errors - subscription might auto-start
					const errorMsg = startError instanceof Error ? startError.message : String(startError)
					if (errorMsg.includes("Cannot access 's' before initialization") || errorMsg.includes("before initialization")) {
						console.log('useOrderById: Subscription already initialized or auto-started')
					} else {
						console.warn('useOrderById: Error starting subscription:', startError)
					}
				}
			}
		}, 400) // Longer delay to ensure full initialization
	}

		// Clean up subscriptions when unmounting
		// Don't manually stop - let NDK handle cleanup naturally
		// Manually stopping causes NDK internal errors
		return () => {
			// Subscriptions will be cleaned up by NDK when component unmounts
		}
	}, [orderId, ndk, queryClient, userPubkey])

	return useQuery({
		queryKey: orderKeys.details(orderId),
		queryFn: () => fetchOrderById(orderId, queryClient),
		enabled: !!orderId,
		// Use cache-first approach - data is fresh for 2 minutes
		staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
		gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
		refetchOnMount: false, // Don't refetch on mount - use cache if available
		refetchOnWindowFocus: false, // Don't refetch on window focus - preserve cache
		refetchOnReconnect: true, // Refetch when reconnecting to network
		// Use cached order as initial data if available
		initialData: cachedOrder,
		placeholderData: cachedOrder, // Use cached order as placeholder while fetching
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
