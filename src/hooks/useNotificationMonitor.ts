import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { notificationActions, notificationStore } from '@/lib/stores/notifications'
import { ORDER_GENERAL_KIND, ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import { createAuthorRelayReadDeps, readAuthorScopedEvents } from '@/lib/nostr/authorRelayRead'
import { fetchUserRelayListWithPreferences } from '@/queries/relay-list'
import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk'

/**
 * Monitor nostr events and update notification counts in real-time
 * This hook should be used once at the app/dashboard level
 */
export const useNotificationMonitor = () => {
	const { user } = useStore(authStore)
	const { isInitialized } = useStore(notificationStore)
	const subscriptionsRef = useRef<NDKSubscription[]>([])
	const isMonitoringRef = useRef(false)

	useEffect(() => {
		// Only run if user is authenticated and store is initialized
		if (!user?.pubkey || !isInitialized || isMonitoringRef.current) {
			return
		}

		const ndk = ndkActions.getNDK()
		if (!ndk) return

		// Mark as monitoring to prevent duplicate subscriptions
		isMonitoringRef.current = true

		console.log('[NotificationMonitor] Starting notification monitoring for user:', user.pubkey)

		// Helper to check if an event is newer than last seen
		const isNewOrder = (event: NDKEvent): boolean => {
			const lastSeen = notificationActions.getLastSeenOrders()
			return (event.created_at || 0) > lastSeen
		}

		const isNewMessage = (event: NDKEvent, pubkey: string): boolean => {
			const lastSeen = notificationActions.getLastSeenForConversation(pubkey)
			return (event.created_at || 0) > lastSeen
		}

		const isNewPurchaseUpdate = (event: NDKEvent): boolean => {
			const lastSeen = notificationActions.getLastSeenPurchases()
			return (event.created_at || 0) > lastSeen
		}

		// Initial fetch to calculate current unseen counts
		const initializeNotifications = async () => {
			try {
				// ADR-0002 F3: these are reads scoped to the reader — the reader's
				// own orders, messages and purchase updates — so the relays the
				// bounded path may consult are the READER's own kind-10002
				// declarations (an inbox read), never a counterparty's: the `#p`
				// filters below name no author, so a counterparty's relay set is
				// not knowable before the read. The pinned read is canonical; the
				// bounded path (capped, serial, session-bounded) runs only when
				// the pinned read misses and the single /api/config decision is
				// ON. Residual gap, recorded in the ADR: a counterparty that
				// publishes only to its own relays is not reached by this read.
				const authorRelayDeps = createAuthorRelayReadDeps({ ndk, fetchAuthorRelayList: fetchUserRelayListWithPreferences })
				const readSelfScopedEvents = (filter: NDKFilter) =>
					readAuthorScopedEvents(filter, { authorPubkey: user.pubkey, purpose: 'self' }, authorRelayDeps).then((result) => result.events)

				// Fetch recent orders where user is seller (recipient)
				const orderFilter: NDKFilter = {
					kinds: [ORDER_PROCESS_KIND],
					'#p': [user.pubkey],
					limit: 100,
				}

				const orderEvents = await readSelfScopedEvents(orderFilter)

				// Filter for order creation events
				const newOrders = Array.from(orderEvents).filter((event) => {
					const typeTag = event.tags.find((tag) => tag[0] === 'type')
					return typeTag?.[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION && isNewOrder(event)
				})

				// Fetch recent messages (kind 14)
				const messageFilter: NDKFilter = {
					kinds: [ORDER_GENERAL_KIND],
					'#p': [user.pubkey],
					limit: 100,
				}

				const messageEvents = await readSelfScopedEvents(messageFilter)

				// Group messages by sender and count unseen per conversation
				const conversationCounts: Record<string, number> = {}
				let totalUnseenMessages = 0

				Array.from(messageEvents).forEach((event) => {
					const senderPubkey = event.pubkey
					if (senderPubkey !== user.pubkey && isNewMessage(event, senderPubkey)) {
						conversationCounts[senderPubkey] = (conversationCounts[senderPubkey] || 0) + 1
						totalUnseenMessages++
					}
				})

				// Fetch recent purchase updates (orders where user is buyer)
				const purchaseFilter: NDKFilter = {
					kinds: [ORDER_PROCESS_KIND],
					authors: [user.pubkey],
					limit: 100,
				}

				const purchaseEvents = await readSelfScopedEvents(purchaseFilter)

				// Filter for purchase updates (payment requests, status updates, shipping updates)
				// Exclude order creation events since those are initiated by the buyer
				const newPurchaseUpdates = Array.from(purchaseEvents).filter((event) => {
					const typeTag = event.tags.find((tag) => tag[0] === 'type')
					const isUpdate =
						typeTag?.[1] === ORDER_MESSAGE_TYPE.PAYMENT_REQUEST ||
						typeTag?.[1] === ORDER_MESSAGE_TYPE.STATUS_UPDATE ||
						typeTag?.[1] === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE

					// Only count if it's an update type AND it's from the seller (not the buyer)
					return isUpdate && event.pubkey !== user.pubkey && isNewPurchaseUpdate(event)
				})

				// Update store with initial counts
				notificationActions.recalculateFromEvents({
					orderCount: newOrders.length,
					messageCount: totalUnseenMessages,
					purchaseCount: newPurchaseUpdates.length,
					conversationCounts,
				})

				console.log('[NotificationMonitor] Initial counts:', {
					orders: newOrders.length,
					messages: totalUnseenMessages,
					purchases: newPurchaseUpdates.length,
					conversations: Object.keys(conversationCounts).length,
				})
			} catch (error) {
				console.error('[NotificationMonitor] Failed to initialize notifications:', error)
			}
		}

		// Start initial fetch
		initializeNotifications()

		// Set up real-time subscriptions

		// 1. Subscribe to new orders where user is seller
		const orderSubscription = ndk.subscribe(
			{
				kinds: [ORDER_PROCESS_KIND],
				'#p': [user.pubkey],
				since: Math.floor(Date.now() / 1000), // Only new events from now
			},
			{
				closeOnEose: false,
			},
		)

		orderSubscription.on('event', (event: NDKEvent) => {
			// Check if it's an order creation event
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			if (typeTag?.[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
				// Only increment if it's newer than last seen
				if (isNewOrder(event)) {
					console.log('[NotificationMonitor] New order received:', event.id)
					notificationActions.incrementUnseenOrders()
				}
			}
		})

		subscriptionsRef.current.push(orderSubscription)

		// 2. Subscribe to new messages where user is recipient
		const messageSubscription = ndk.subscribe(
			{
				kinds: [ORDER_GENERAL_KIND],
				'#p': [user.pubkey],
				since: Math.floor(Date.now() / 1000), // Only new events from now
			},
			{
				closeOnEose: false,
			},
		)

		messageSubscription.on('event', (event: NDKEvent) => {
			const senderPubkey = event.pubkey
			// Don't count messages we sent
			if (senderPubkey !== user.pubkey && isNewMessage(event, senderPubkey)) {
				console.log('[NotificationMonitor] New message received from:', senderPubkey)
				notificationActions.incrementUnseenForConversation(senderPubkey)
			}
		})

		subscriptionsRef.current.push(messageSubscription)

		// 3. Subscribe to purchase updates (orders where user is buyer)
		// Listen for events tagged with user's pubkey that are updates from sellers
		const purchaseUpdateSubscription = ndk.subscribe(
			{
				kinds: [ORDER_PROCESS_KIND],
				'#p': [user.pubkey],
				since: Math.floor(Date.now() / 1000),
			},
			{
				closeOnEose: false,
			},
		)

		purchaseUpdateSubscription.on('event', (event: NDKEvent) => {
			// Only count if event is from someone else (the seller)
			if (event.pubkey === user.pubkey) return

			const typeTag = event.tags.find((tag) => tag[0] === 'type')

			// Handle purchase-related updates (seller sending updates to buyer)
			if (typeTag) {
				switch (typeTag[1]) {
					case ORDER_MESSAGE_TYPE.PAYMENT_REQUEST:
					case ORDER_MESSAGE_TYPE.STATUS_UPDATE:
					case ORDER_MESSAGE_TYPE.SHIPPING_UPDATE:
						if (isNewPurchaseUpdate(event)) {
							console.log('[NotificationMonitor] Purchase update received:', typeTag[1], event.id)
							notificationActions.incrementUnseenPurchases()
						}
						break
					case ORDER_MESSAGE_TYPE.ORDER_CREATION:
						// This is a new order where user is seller - already handled above
						break
				}
			}
		})

		subscriptionsRef.current.push(purchaseUpdateSubscription)

		console.log('[NotificationMonitor] Subscriptions active:', subscriptionsRef.current.length)

		// Cleanup function
		return () => {
			console.log('[NotificationMonitor] Stopping notification monitoring')
			subscriptionsRef.current.forEach((sub) => {
				sub.stop()
			})
			subscriptionsRef.current = []
			isMonitoringRef.current = false
		}
	}, [user?.pubkey, isInitialized])
}
