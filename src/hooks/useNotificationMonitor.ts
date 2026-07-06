import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { AUCTION_BID_KIND, AUCTION_SETTLEMENT_KIND } from '@/lib/auctionSettlement'
import { ndkActions } from '@/lib/stores/ndk'
import { notificationActions, notificationStore } from '@/lib/stores/notifications'
import { ORDER_GENERAL_KIND, ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import {
	fetchAuctionBidsByBidder,
	fetchAuctionsByPubkey,
	getAuctionBiddingCutoffAt,
	getAuctionId,
	getAuctionRootEventId,
	getAuctionStartAt,
	getBidAmount,
	getBidAuctionCoordinates,
	getBidAuctionEventId,
} from '@/queries/auctions'
import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk'

const AUCTION_MONITOR_LIMIT = 500
const AUCTION_FILTER_CHUNK_SIZE = 80
const AUCTION_LIFECYCLE_POLL_INTERVAL_MS = 60000
const IGNORED_AUCTION_BID_STATUSES = new Set(['cancelled', 'canceled', 'rejected', 'failed', 'expired', 'refunded', 'reclaimed', 'claimed'])

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)))

const chunkValues = (values: string[], size: number): string[][] => {
	const chunks: string[][] = []
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size))
	}
	return chunks
}

const dedupeEvents = (events: NDKEvent[]): NDKEvent[] => {
	const seen = new Set<string>()
	return events.filter((event) => {
		if (!event.id || seen.has(event.id)) return false
		seen.add(event.id)
		return true
	})
}

const getAuctionCoordinate = (auction: NDKEvent): string => {
	const auctionDTag = getAuctionId(auction)
	return auctionDTag ? `30408:${auction.pubkey}:${auctionDTag}` : ''
}

const getEventAuctionRootId = (event: NDKEvent): string => getBidAuctionEventId(event)

const getEventAuctionCoordinate = (event: NDKEvent): string => getBidAuctionCoordinates(event)

const isScheduledAuction = (auction: NDKEvent): boolean => {
	const startAt = getAuctionStartAt(auction)
	const createdAt = auction.created_at ?? 0
	return startAt > 0 && startAt > createdAt
}

const collectSellerAuctionLifecycleNotifications = (
	sellerAuctions: NDKEvent[],
	lastSeenAuctionLive: number,
	lastSeenAuctionSettlementBegins: number,
	seenAuctionLiveEventIds: Set<string>,
	seenAuctionSettlementBeginsEventIds: Set<string>,
): {
	liveEvents: NDKEvent[]
	settlementBeginsEvents: NDKEvent[]
} => {
	const now = Math.floor(Date.now() / 1000)
	const liveEvents: NDKEvent[] = []
	const settlementBeginsEvents: NDKEvent[] = []

	for (const auction of sellerAuctions) {
		if (!auction.id) continue

		const startAt = getAuctionStartAt(auction)
		const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
		const scheduledAuction = isScheduledAuction(auction)

		if (
			scheduledAuction &&
			!seenAuctionLiveEventIds.has(auction.id) &&
			startAt > lastSeenAuctionLive &&
			now >= startAt &&
			(biddingCutoffAt <= 0 || now < biddingCutoffAt)
		) {
			liveEvents.push(auction)
		}

		if (
			!seenAuctionSettlementBeginsEventIds.has(auction.id) &&
			biddingCutoffAt > 0 &&
			biddingCutoffAt > lastSeenAuctionSettlementBegins &&
			now >= biddingCutoffAt
		) {
			settlementBeginsEvents.push(auction)
		}
	}

	return { liveEvents, settlementBeginsEvents }
}

const getAuctionBidStatus = (event: NDKEvent): string =>
	event.tags
		.find((tag) => tag[0] === 'status')?.[1]
		?.trim()
		.toLowerCase() || 'unknown'

const isCountableAuctionBidEvent = (event: NDKEvent): boolean => {
	const status = getAuctionBidStatus(event)
	return !IGNORED_AUCTION_BID_STATUSES.has(status)
}

const makeTaggedAuctionFilters = ({
	kind,
	auctionRootEventIds,
	auctionCoordinates,
	since,
}: {
	kind: NonNullable<NDKFilter['kinds']>[number]
	auctionRootEventIds: string[]
	auctionCoordinates: string[]
	since?: number
}): NDKFilter[] => {
	const filters: NDKFilter[] = []
	const baseFilter = {
		kinds: [kind],
		limit: AUCTION_MONITOR_LIMIT,
		...(typeof since === 'number' ? { since } : {}),
	}

	for (const eventIdChunk of chunkValues(auctionRootEventIds, AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			'#e': eventIdChunk,
		})
	}

	for (const coordinateChunk of chunkValues(auctionCoordinates, AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			'#a': coordinateChunk,
		})
	}

	return filters
}

const fetchTaggedAuctionEvents = async ({
	kind,
	auctionRootEventIds,
	auctionCoordinates,
	since,
}: {
	kind: NonNullable<NDKFilter['kinds']>[number]
	auctionRootEventIds: string[]
	auctionCoordinates: string[]
	since?: number
}): Promise<NDKEvent[]> => {
	const filters = makeTaggedAuctionFilters({ kind, auctionRootEventIds, auctionCoordinates, since })
	if (filters.length === 0) return []

	const events = await ndkActions.fetchEventsWithTimeout(filters.length === 1 ? filters[0] : filters, { timeoutMs: 8000 })
	return dedupeEvents(Array.from(events))
}

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

		let isCancelled = false
		const subscriptionSince = Math.floor(Date.now() / 1000)
		const seenAuctionEventIds = new Set<string>()
		const seenAuctionLiveEventIds = new Set<string>()
		const seenAuctionSettlementBeginsEventIds = new Set<string>()
		const seenBidEventIds = new Set<string>()
		const seenSettlementEventIds = new Set<string>()
		let auctionLifecyclePollId: number | null = null

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

		const isNewAuctionBid = (event: NDKEvent): boolean => {
			const lastSeen = notificationActions.getLastSeenAuctionBids()
			return (event.created_at || 0) > lastSeen
		}

		const isNewBidUpdate = (event: NDKEvent): boolean => {
			const lastSeen = notificationActions.getLastSeenBidUpdates()
			return (event.created_at || 0) > lastSeen
		}

		const subscribeToTaggedAuctionEvents = ({
			kind,
			tagName,
			values,
			onEvent,
		}: {
			kind: NonNullable<NDKFilter['kinds']>[number]
			tagName: '#e' | '#a'
			values: string[]
			onEvent: (event: NDKEvent) => void
		}) => {
			if (isCancelled || values.length === 0) return

			const filter = {
				kinds: [kind],
				[tagName]: values,
				since: subscriptionSince,
			} as NDKFilter

			const subscription = ndk.subscribe(filter, {
				closeOnEose: false,
			})

			subscription.on('event', onEvent)
			subscriptionsRef.current.push(subscription)
		}

		const getHighestOwnBidAmountForAuction = (
			event: NDKEvent,
			highestOwnBidByRootId: Map<string, number>,
			highestOwnBidByCoordinate: Map<string, number>,
		): number => {
			const auctionRootEventId = getEventAuctionRootId(event)
			const auctionCoordinate = getEventAuctionCoordinate(event)
			const rootAmount = auctionRootEventId ? (highestOwnBidByRootId.get(auctionRootEventId) ?? 0) : 0
			const coordinateAmount = auctionCoordinate ? (highestOwnBidByCoordinate.get(auctionCoordinate) ?? 0) : 0
			return Math.max(rootAmount, coordinateAmount)
		}

		// Initial fetch to calculate current unseen counts and set up auction-specific subscriptions
		const initializeNotifications = async () => {
			try {
				// Fetch recent orders where user is seller (recipient)
				const orderFilter: NDKFilter = {
					kinds: [ORDER_PROCESS_KIND],
					'#p': [user.pubkey],
					limit: 100,
				}

				const orderEvents = await ndk.fetchEvents(orderFilter)

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

				const messageEvents = await ndk.fetchEvents(messageFilter)

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

				const purchaseEvents = await ndk.fetchEvents(purchaseFilter)

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

				const sellerAuctions = await fetchAuctionsByPubkey(user.pubkey, 500)
				const sellerAuctionRootEventIds = uniqueStrings(sellerAuctions.map((auction) => getAuctionRootEventId(auction) || auction.id))
				const sellerAuctionCoordinates = uniqueStrings(sellerAuctions.map(getAuctionCoordinate))
				const { liveEvents: initialAuctionLiveEvents, settlementBeginsEvents: initialAuctionSettlementBeginsEvents } =
					collectSellerAuctionLifecycleNotifications(
						sellerAuctions,
						notificationActions.getLastSeenAuctionLive(),
						notificationActions.getLastSeenAuctionSettlementBegins(),
						seenAuctionLiveEventIds,
						seenAuctionSettlementBeginsEventIds,
					)
				for (const auction of initialAuctionLiveEvents) {
					if (auction.id) seenAuctionLiveEventIds.add(auction.id)
				}
				for (const auction of initialAuctionSettlementBeginsEvents) {
					if (auction.id) seenAuctionSettlementBeginsEventIds.add(auction.id)
				}
				const sellerBidEvents = await fetchTaggedAuctionEvents({
					kind: AUCTION_BID_KIND,
					auctionRootEventIds: sellerAuctionRootEventIds,
					auctionCoordinates: sellerAuctionCoordinates,
					since: notificationActions.getLastSeenAuctionBids() + 1,
				})

				const newSellerBidEvents = sellerBidEvents.filter((event) => {
					seenAuctionEventIds.add(event.id)
					return event.pubkey !== user.pubkey && isCountableAuctionBidEvent(event) && isNewAuctionBid(event)
				})

				const ownBidEvents = await fetchAuctionBidsByBidder(user.pubkey, 500)
				const highestOwnBidByRootId = new Map<string, number>()
				const highestOwnBidByCoordinate = new Map<string, number>()

				for (const bid of ownBidEvents) {
					const amount = getBidAmount(bid)
					const auctionRootEventId = getBidAuctionEventId(bid)
					const auctionCoordinate = getBidAuctionCoordinates(bid)

					if (auctionRootEventId) {
						highestOwnBidByRootId.set(auctionRootEventId, Math.max(highestOwnBidByRootId.get(auctionRootEventId) ?? 0, amount))
					}
					if (auctionCoordinate) {
						highestOwnBidByCoordinate.set(auctionCoordinate, Math.max(highestOwnBidByCoordinate.get(auctionCoordinate) ?? 0, amount))
					}
				}

				const watchedAuctionRootEventIds = Array.from(highestOwnBidByRootId.keys())
				const watchedAuctionCoordinates = Array.from(highestOwnBidByCoordinate.keys())
				const watchedBidEvents = await fetchTaggedAuctionEvents({
					kind: AUCTION_BID_KIND,
					auctionRootEventIds: watchedAuctionRootEventIds,
					auctionCoordinates: watchedAuctionCoordinates,
					since: notificationActions.getLastSeenBidUpdates() + 1,
				})
				const watchedSettlementEvents = await fetchTaggedAuctionEvents({
					kind: AUCTION_SETTLEMENT_KIND,
					auctionRootEventIds: watchedAuctionRootEventIds,
					auctionCoordinates: watchedAuctionCoordinates,
					since: notificationActions.getLastSeenBidUpdates() + 1,
				})

				const newHigherBidEvents = watchedBidEvents.filter((event) => {
					seenBidEventIds.add(event.id)
					if (event.pubkey === user.pubkey || !isCountableAuctionBidEvent(event) || !isNewBidUpdate(event)) return false

					const highestOwnBidAmount = getHighestOwnBidAmountForAuction(event, highestOwnBidByRootId, highestOwnBidByCoordinate)
					return highestOwnBidAmount > 0 && getBidAmount(event) > highestOwnBidAmount
				})

				const newSettlementEvents = watchedSettlementEvents.filter((event) => {
					seenSettlementEventIds.add(event.id)
					return event.pubkey !== user.pubkey && isNewBidUpdate(event)
				})

				if (isCancelled) return

				// Update store with initial counts
				notificationActions.recalculateFromEvents({
					orderCount: newOrders.length,
					messageCount: totalUnseenMessages,
					purchaseCount: newPurchaseUpdates.length,
					conversationCounts,
					auctionBidCount: newSellerBidEvents.length,
					auctionLiveCount: initialAuctionLiveEvents.length,
					auctionSettlementBeginsCount: initialAuctionSettlementBeginsEvents.length,
					bidUpdateCount: newHigherBidEvents.length + newSettlementEvents.length,
				})

				console.log('[NotificationMonitor] Initial counts:', {
					orders: newOrders.length,
					messages: totalUnseenMessages,
					purchases: newPurchaseUpdates.length,
					auctionBids: newSellerBidEvents.length,
					auctionLive: initialAuctionLiveEvents.length,
					auctionSettlementBegins: initialAuctionSettlementBeginsEvents.length,
					bidUpdates: newHigherBidEvents.length + newSettlementEvents.length,
					conversations: Object.keys(conversationCounts).length,
				})

				const handleSellerBidEvent = (event: NDKEvent) => {
					if (!event.id || seenAuctionEventIds.has(event.id)) return
					seenAuctionEventIds.add(event.id)
					if (event.pubkey === user.pubkey || !isCountableAuctionBidEvent(event) || !isNewAuctionBid(event)) return

					console.log('[NotificationMonitor] New auction bid received:', event.id)
					notificationActions.incrementUnseenAuctionBids()
				}

				const handleWatchedBidEvent = (event: NDKEvent) => {
					if (!event.id || seenBidEventIds.has(event.id)) return
					seenBidEventIds.add(event.id)
					if (event.pubkey === user.pubkey || !isCountableAuctionBidEvent(event) || !isNewBidUpdate(event)) return

					const highestOwnBidAmount = getHighestOwnBidAmountForAuction(event, highestOwnBidByRootId, highestOwnBidByCoordinate)
					if (highestOwnBidAmount <= 0 || getBidAmount(event) <= highestOwnBidAmount) return

					console.log('[NotificationMonitor] New higher bid on watched auction:', event.id)
					notificationActions.incrementUnseenBidUpdates()
				}

				const handleWatchedSettlementEvent = (event: NDKEvent) => {
					if (!event.id || seenSettlementEventIds.has(event.id)) return
					seenSettlementEventIds.add(event.id)
					if (event.pubkey === user.pubkey || !isNewBidUpdate(event)) return

					console.log('[NotificationMonitor] New settlement on watched auction:', event.id)
					notificationActions.incrementUnseenBidUpdates()
				}

				subscribeToTaggedAuctionEvents({
					kind: AUCTION_BID_KIND,
					tagName: '#e',
					values: sellerAuctionRootEventIds,
					onEvent: handleSellerBidEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: AUCTION_BID_KIND,
					tagName: '#a',
					values: sellerAuctionCoordinates,
					onEvent: handleSellerBidEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: AUCTION_BID_KIND,
					tagName: '#e',
					values: watchedAuctionRootEventIds,
					onEvent: handleWatchedBidEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: AUCTION_BID_KIND,
					tagName: '#a',
					values: watchedAuctionCoordinates,
					onEvent: handleWatchedBidEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: AUCTION_SETTLEMENT_KIND,
					tagName: '#e',
					values: watchedAuctionRootEventIds,
					onEvent: handleWatchedSettlementEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: AUCTION_SETTLEMENT_KIND,
					tagName: '#a',
					values: watchedAuctionCoordinates,
					onEvent: handleWatchedSettlementEvent,
				})

				console.log('[NotificationMonitor] Subscriptions active:', subscriptionsRef.current.length)

				auctionLifecyclePollId = window.setInterval(async () => {
					try {
						const sellerAuctions = await fetchAuctionsByPubkey(user.pubkey, 500)
						const { liveEvents, settlementBeginsEvents } = collectSellerAuctionLifecycleNotifications(
							sellerAuctions,
							notificationActions.getLastSeenAuctionLive(),
							notificationActions.getLastSeenAuctionSettlementBegins(),
							seenAuctionLiveEventIds,
							seenAuctionSettlementBeginsEventIds,
						)

						for (const auction of liveEvents) {
							if (!auction.id) continue
							seenAuctionLiveEventIds.add(auction.id)
							notificationActions.incrementUnseenAuctionLive()
						}

						for (const auction of settlementBeginsEvents) {
							if (!auction.id) continue
							seenAuctionSettlementBeginsEventIds.add(auction.id)
							notificationActions.incrementUnseenAuctionSettlementBegins()
						}
					} catch (error) {
						console.error('[NotificationMonitor] Failed to poll auction lifecycle notifications:', error)
					}
				}, AUCTION_LIFECYCLE_POLL_INTERVAL_MS)
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
				since: subscriptionSince, // Only new events from now
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
				since: subscriptionSince, // Only new events from now
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
				since: subscriptionSince,
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

		console.log('[NotificationMonitor] Base subscriptions active:', subscriptionsRef.current.length)

		// Cleanup function
		return () => {
			console.log('[NotificationMonitor] Stopping notification monitoring')
			isCancelled = true
			if (auctionLifecyclePollId) {
				window.clearInterval(auctionLifecyclePollId)
			}
			subscriptionsRef.current.forEach((sub) => {
				sub.stop()
			})
			subscriptionsRef.current = []
			isMonitoringRef.current = false
		}
	}, [user?.pubkey, isInitialized])
}
