import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { AUCTION_BID_KIND, AUCTION_SETTLEMENT_KIND } from '@/lib/auctionSettlement'
import { LIVE_ACTIVITY_KIND, LIVE_CHAT_KIND, parseLiveActivity } from '@/lib/nip53'
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
import { fetchProductsByPubkey, getProductId } from '@/queries/products'
import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk'

const AUCTION_MONITOR_LIMIT = 500
const AUCTION_FILTER_CHUNK_SIZE = 80
const AUCTION_LIFECYCLE_POLL_INTERVAL_MS = 60000
const IGNORED_AUCTION_BID_STATUSES = new Set(['cancelled', 'canceled', 'rejected', 'failed', 'expired', 'refunded', 'reclaimed', 'claimed'])
const LIVE_ACTIVITY_KIND_NDK = LIVE_ACTIVITY_KIND as unknown as NonNullable<NDKFilter['kinds']>[number]
const LIVE_CHAT_KIND_NDK = LIVE_CHAT_KIND as unknown as NonNullable<NDKFilter['kinds']>[number]
const COMMENT_KIND_NDK = 1111 as unknown as NonNullable<NDKFilter['kinds']>[number]

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

const getProductCoordinate = (product: NDKEvent): string => {
	const productDTag = getProductId(product)
	return productDTag ? `30402:${product.pubkey}:${productDTag}` : ''
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

const fetchSellerProductCommentEvents = async ({
	productCoordinates,
	productEventIds,
	since,
}: {
	productCoordinates: string[]
	productEventIds: string[]
	since?: number
}): Promise<NDKEvent[]> => {
	const filters: NDKFilter[] = []
	const baseFilter = {
		kinds: [COMMENT_KIND_NDK],
		limit: AUCTION_MONITOR_LIMIT,
		...(typeof since === 'number' ? { since } : {}),
	}

	for (const coordinateChunk of chunkValues(productCoordinates, AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			'#a': coordinateChunk,
		})
		filters.push({
			...baseFilter,
			'#A': coordinateChunk,
		})
	}

	for (const eventIdChunk of chunkValues(productEventIds, AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			'#e': eventIdChunk,
		})
		filters.push({
			...baseFilter,
			'#E': eventIdChunk,
		})
	}

	if (filters.length === 0) return []

	const events = await ndkActions.fetchEventsWithTimeout(filters.length === 1 ? filters[0] : filters, { timeoutMs: 8000 })
	return dedupeEvents(Array.from(events))
}

const fetchSellerAuctionCommentEvents = async ({
	auctionCoordinates,
	auctionEventIds,
	since,
}: {
	auctionCoordinates: string[]
	auctionEventIds: string[]
	since?: number
}): Promise<NDKEvent[]> => {
	const filters: NDKFilter[] = []
	const baseFilter = {
		kinds: [COMMENT_KIND_NDK],
		limit: AUCTION_MONITOR_LIMIT,
		...(typeof since === 'number' ? { since } : {}),
	}

	for (const coordinateChunk of chunkValues(auctionCoordinates, AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			'#a': coordinateChunk,
		})
		filters.push({
			...baseFilter,
			'#A': coordinateChunk,
		})
	}

	for (const eventIdChunk of chunkValues(auctionEventIds, AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			'#e': eventIdChunk,
		})
		filters.push({
			...baseFilter,
			'#E': eventIdChunk,
		})
	}

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
		const seenAuctionCommentEventIds = new Set<string>()
		const seenAuctionEventCommentIds = new Set<string>()
		const seenProductCommentEventIds = new Set<string>()
		const subscribedLiveChatCoords = new Set<string>()
		const subscribedProductCommentCoords = new Set<string>()
		const seenAuctionLiveEventIds = new Set<string>()
		const seenAuctionSettlementBeginsEventIds = new Set<string>()
		const seenBidEventIds = new Set<string>()
		const seenSettlementEventIds = new Set<string>()
		let auctionLifecyclePollId: number | null = null

		// Mark as monitoring to prevent duplicate subscriptions
		isMonitoringRef.current = true

		console.log('[NotificationMonitor] Starting notification monitoring for user:', user.pubkey)

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

		const isNewAuctionComment = (event: NDKEvent): boolean => {
			const lastSeen = notificationActions.getLastSeenAuctionComments()
			return (event.created_at || 0) > lastSeen
		}

		const isNewAuctionEventComment = (event: NDKEvent): boolean => {
			const lastSeen = notificationActions.getLastSeenAuctionEventComments()
			return (event.created_at || 0) > lastSeen
		}

		const isNewProductComment = (event: NDKEvent): boolean => {
			const lastSeen = notificationActions.getLastSeenProductComments()
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
			tagName: '#e' | '#E' | '#a' | '#A'
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

		const initializeNotifications = async () => {
			try {
				const orderFilter: NDKFilter = {
					kinds: [ORDER_PROCESS_KIND],
					'#p': [user.pubkey],
					limit: 100,
				}

				const orderEvents = await ndk.fetchEvents(orderFilter)
				const newOrders = Array.from(orderEvents).filter((event) => {
					const typeTag = event.tags.find((tag) => tag[0] === 'type')
					return typeTag?.[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION && isNewOrder(event)
				})

				const messageFilter: NDKFilter = {
					kinds: [ORDER_GENERAL_KIND],
					'#p': [user.pubkey],
					limit: 100,
				}

				const messageEvents = await ndk.fetchEvents(messageFilter)
				const conversationCounts: Record<string, number> = {}
				let totalUnseenMessages = 0

				Array.from(messageEvents).forEach((event) => {
					const senderPubkey = event.pubkey
					if (senderPubkey !== user.pubkey && isNewMessage(event, senderPubkey)) {
						conversationCounts[senderPubkey] = (conversationCounts[senderPubkey] || 0) + 1
						totalUnseenMessages++
					}
				})

				const purchaseFilter: NDKFilter = {
					kinds: [ORDER_PROCESS_KIND],
					authors: [user.pubkey],
					limit: 100,
				}

				const purchaseEvents = await ndk.fetchEvents(purchaseFilter)
				const newPurchaseUpdates = Array.from(purchaseEvents).filter((event) => {
					const typeTag = event.tags.find((tag) => tag[0] === 'type')
					const isUpdate =
						typeTag?.[1] === ORDER_MESSAGE_TYPE.PAYMENT_REQUEST ||
						typeTag?.[1] === ORDER_MESSAGE_TYPE.STATUS_UPDATE ||
						typeTag?.[1] === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE

					return isUpdate && event.pubkey !== user.pubkey && isNewPurchaseUpdate(event)
				})

				const sellerAuctions = await fetchAuctionsByPubkey(user.pubkey, 500)
				const sellerProducts = await fetchProductsByPubkey(user.pubkey, true, 500)
				const sellerAuctionRootEventIds = uniqueStrings(sellerAuctions.map((auction) => getAuctionRootEventId(auction) || auction.id))
				const sellerAuctionCoordinates = uniqueStrings(sellerAuctions.map(getAuctionCoordinate))
				const sellerAuctionEventIds = uniqueStrings(sellerAuctions.map((auction) => getAuctionRootEventId(auction) || auction.id))
				const sellerProductCoordinates = uniqueStrings(sellerProducts.map(getProductCoordinate))
				const sellerProductEventIds = uniqueStrings(sellerProducts.map((product) => product.id))

				const sellerLiveActivityEvents = await fetchTaggedAuctionEvents({
					kind: LIVE_ACTIVITY_KIND_NDK,
					auctionRootEventIds: [],
					auctionCoordinates: sellerAuctionCoordinates,
				})
				const sellerLiveActivityCoordinates = uniqueStrings(
					sellerLiveActivityEvents.map((event) => parseLiveActivity(event).coord).filter(Boolean),
				)
				const sellerLiveChatEvents = await fetchTaggedAuctionEvents({
					kind: LIVE_CHAT_KIND_NDK,
					auctionRootEventIds: [],
					auctionCoordinates: sellerLiveActivityCoordinates,
					since: notificationActions.getLastSeenAuctionComments() + 1,
				})
				const newSellerCommentEvents = sellerLiveChatEvents.filter((event) => {
					seenAuctionCommentEventIds.add(event.id)
					return event.pubkey !== user.pubkey && isNewAuctionComment(event)
				})

				const sellerAuctionCommentEvents = await fetchSellerAuctionCommentEvents({
					auctionCoordinates: sellerAuctionCoordinates,
					auctionEventIds: sellerAuctionEventIds,
					since: notificationActions.getLastSeenAuctionEventComments() + 1,
				})
				const newSellerAuctionEventCommentEvents = sellerAuctionCommentEvents.filter((event) => {
					seenAuctionEventCommentIds.add(event.id)
					return event.pubkey !== user.pubkey && isNewAuctionEventComment(event)
				})

				const sellerProductCommentEvents = await fetchSellerProductCommentEvents({
					productCoordinates: sellerProductCoordinates,
					productEventIds: sellerProductEventIds,
					since: notificationActions.getLastSeenProductComments() + 1,
				})
				const newSellerProductCommentEvents = sellerProductCommentEvents.filter((event) => {
					seenProductCommentEventIds.add(event.id)
					return event.pubkey !== user.pubkey && isNewProductComment(event)
				})

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

				notificationActions.recalculateFromEvents({
					orderCount: newOrders.length,
					messageCount: totalUnseenMessages,
					purchaseCount: newPurchaseUpdates.length,
					conversationCounts,
					auctionBidCount: newSellerBidEvents.length,
					auctionCommentCount: newSellerCommentEvents.length,
					auctionEventCommentCount: newSellerAuctionEventCommentEvents.length,
					productCommentCount: newSellerProductCommentEvents.length,
					auctionLiveCount: initialAuctionLiveEvents.length,
					auctionSettlementBeginsCount: initialAuctionSettlementBeginsEvents.length,
					bidUpdateCount: newHigherBidEvents.length + newSettlementEvents.length,
				})

				console.log('[NotificationMonitor] Initial counts:', {
					orders: newOrders.length,
					messages: totalUnseenMessages,
					purchases: newPurchaseUpdates.length,
					auctionBids: newSellerBidEvents.length,
					auctionComments: newSellerCommentEvents.length,
					auctionEventComments: newSellerAuctionEventCommentEvents.length,
					productComments: newSellerProductCommentEvents.length,
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

				const handleSellerLiveChatEvent = (event: NDKEvent) => {
					if (!event.id || seenAuctionCommentEventIds.has(event.id)) return
					seenAuctionCommentEventIds.add(event.id)
					if (event.pubkey === user.pubkey) return

					console.log('[NotificationMonitor] New auction live-chat comment received:', event.id)
					notificationActions.incrementUnseenAuctionComments()
				}

				const handleSellerProductCommentEvent = (event: NDKEvent) => {
					if (!event.id || seenProductCommentEventIds.has(event.id)) return
					seenProductCommentEventIds.add(event.id)
					if (event.pubkey === user.pubkey) return

					console.log('[NotificationMonitor] New product comment received:', event.id)
					notificationActions.incrementUnseenProductComments()
				}

				const handleSellerAuctionEventComment = (event: NDKEvent) => {
					if (!event.id || seenAuctionEventCommentIds.has(event.id)) return
					seenAuctionEventCommentIds.add(event.id)
					if (event.pubkey === user.pubkey) return

					console.log('[NotificationMonitor] New auction thread comment received:', event.id)
					notificationActions.incrementUnseenAuctionEventComments()
				}

				const subscribeToLiveChatCoord = (coord: string) => {
					if (!coord || subscribedLiveChatCoords.has(coord)) return
					subscribedLiveChatCoords.add(coord)
					subscribeToTaggedAuctionEvents({
						kind: LIVE_CHAT_KIND_NDK,
						tagName: '#a',
						values: [coord],
						onEvent: handleSellerLiveChatEvent,
					})
				}

				const subscribeToProductCommentCoord = (coord: string) => {
					if (!coord || subscribedProductCommentCoords.has(coord)) return
					subscribedProductCommentCoords.add(coord)
					subscribeToTaggedAuctionEvents({
						kind: COMMENT_KIND_NDK,
						tagName: '#a',
						values: [coord],
						onEvent: handleSellerProductCommentEvent,
					})
					subscribeToTaggedAuctionEvents({
						kind: COMMENT_KIND_NDK,
						tagName: '#A',
						values: [coord],
						onEvent: handleSellerProductCommentEvent,
					})
				}

				const handleSellerLiveActivityEvent = (event: NDKEvent) => {
					const coord = parseLiveActivity(event).coord
					subscribeToLiveChatCoord(coord)
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

				for (const coord of sellerLiveActivityCoordinates) {
					subscribeToLiveChatCoord(coord)
				}
				for (const coord of sellerProductCoordinates) {
					subscribeToProductCommentCoord(coord)
				}
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#a',
					values: sellerAuctionCoordinates,
					onEvent: handleSellerAuctionEventComment,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#A',
					values: sellerAuctionCoordinates,
					onEvent: handleSellerAuctionEventComment,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#e',
					values: sellerAuctionEventIds,
					onEvent: handleSellerAuctionEventComment,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#E',
					values: sellerAuctionEventIds,
					onEvent: handleSellerAuctionEventComment,
				})
				subscribeToTaggedAuctionEvents({
					kind: LIVE_ACTIVITY_KIND_NDK,
					tagName: '#a',
					values: sellerAuctionCoordinates,
					onEvent: handleSellerLiveActivityEvent,
				})
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
						const pollSellerAuctions = await fetchAuctionsByPubkey(user.pubkey, 500)
						const { liveEvents, settlementBeginsEvents } = collectSellerAuctionLifecycleNotifications(
							pollSellerAuctions,
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

						const pollSellerAuctionCoordinates = uniqueStrings(pollSellerAuctions.map(getAuctionCoordinate))
						const pollLiveActivityEvents = await fetchTaggedAuctionEvents({
							kind: LIVE_ACTIVITY_KIND_NDK,
							auctionRootEventIds: [],
							auctionCoordinates: pollSellerAuctionCoordinates,
						})
						const pollLiveActivityCoordinates = uniqueStrings(
							pollLiveActivityEvents.map((event) => parseLiveActivity(event).coord).filter(Boolean),
						)
						const pollLiveChatEvents = await fetchTaggedAuctionEvents({
							kind: LIVE_CHAT_KIND_NDK,
							auctionRootEventIds: [],
							auctionCoordinates: pollLiveActivityCoordinates,
							since: notificationActions.getLastSeenAuctionComments() + 1,
						})
						for (const event of pollLiveChatEvents) {
							if (!event.id || seenAuctionCommentEventIds.has(event.id)) continue
							seenAuctionCommentEventIds.add(event.id)
							if (event.pubkey === user.pubkey) continue
							notificationActions.incrementUnseenAuctionComments()
						}

						const pollSellerAuctionEventIds = uniqueStrings(
							pollSellerAuctions.map((auction) => getAuctionRootEventId(auction) || auction.id),
						)
						const pollAuctionCommentEvents = await fetchSellerAuctionCommentEvents({
							auctionCoordinates: pollSellerAuctionCoordinates,
							auctionEventIds: pollSellerAuctionEventIds,
							since: notificationActions.getLastSeenAuctionEventComments() + 1,
						})
						for (const event of pollAuctionCommentEvents) {
							if (!event.id || seenAuctionEventCommentIds.has(event.id)) continue
							seenAuctionEventCommentIds.add(event.id)
							if (event.pubkey === user.pubkey) continue
							notificationActions.incrementUnseenAuctionEventComments()
						}

						const pollSellerProducts = await fetchProductsByPubkey(user.pubkey, true, 500)
						const pollSellerProductCoordinates = uniqueStrings(pollSellerProducts.map(getProductCoordinate))
						const pollSellerProductEventIds = uniqueStrings(pollSellerProducts.map((product) => product.id))
						for (const coord of pollSellerProductCoordinates) {
							subscribeToProductCommentCoord(coord)
						}

						const pollProductCommentEvents = await fetchSellerProductCommentEvents({
							productCoordinates: pollSellerProductCoordinates,
							productEventIds: pollSellerProductEventIds,
							since: notificationActions.getLastSeenProductComments() + 1,
						})
						for (const event of pollProductCommentEvents) {
							if (!event.id || seenProductCommentEventIds.has(event.id)) continue
							seenProductCommentEventIds.add(event.id)
							if (event.pubkey === user.pubkey) continue
							notificationActions.incrementUnseenProductComments()
						}
					} catch (error) {
						console.error('[NotificationMonitor] Failed to poll auction lifecycle notifications:', error)
					}
				}, AUCTION_LIFECYCLE_POLL_INTERVAL_MS)
			} catch (error) {
				console.error('[NotificationMonitor] Failed to initialize notifications:', error)
			}
		}

		initializeNotifications()

		const orderSubscription = ndk.subscribe(
			{
				kinds: [ORDER_PROCESS_KIND],
				'#p': [user.pubkey],
				since: subscriptionSince,
			},
			{
				closeOnEose: false,
			},
		)

		orderSubscription.on('event', (event: NDKEvent) => {
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			if (typeTag?.[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
				if (isNewOrder(event)) {
					console.log('[NotificationMonitor] New order received:', event.id)
					notificationActions.incrementUnseenOrders()
				}
			}
		})

		subscriptionsRef.current.push(orderSubscription)

		const messageSubscription = ndk.subscribe(
			{
				kinds: [ORDER_GENERAL_KIND],
				'#p': [user.pubkey],
				since: subscriptionSince,
			},
			{
				closeOnEose: false,
			},
		)

		messageSubscription.on('event', (event: NDKEvent) => {
			const senderPubkey = event.pubkey
			if (senderPubkey !== user.pubkey && isNewMessage(event, senderPubkey)) {
				console.log('[NotificationMonitor] New message received from:', senderPubkey)
				notificationActions.incrementUnseenForConversation(senderPubkey)
			}
		})

		subscriptionsRef.current.push(messageSubscription)

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
			if (event.pubkey === user.pubkey) return

			const typeTag = event.tags.find((tag) => tag[0] === 'type')
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
						break
				}
			}
		})

		subscriptionsRef.current.push(purchaseUpdateSubscription)

		console.log('[NotificationMonitor] Base subscriptions active:', subscriptionsRef.current.length)

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
