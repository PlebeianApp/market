import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@/lib/stores/auth'
import { AUCTION_BID_KIND, AUCTION_SETTLEMENT_KIND } from '@/lib/auctionSettlement'
import { ndkActions } from '@/lib/stores/ndk'
import { notificationActions, notificationStore } from '@/lib/stores/notifications'
import { LIVE_ACTIVITY_KIND, LIVE_CHAT_KIND } from '@/lib/nip53'
import { configStore } from '@/lib/stores/config'
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
import { fetchProductsByPubkey, getProductCoordinates } from '@/queries/products'
import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk'

type NDKKind = NonNullable<NDKFilter['kinds']>[number]
const AUCTION_KIND_NDK = 30408 as NDKKind
const COMMENT_KIND_NDK = 1111 as NDKKind
const LIVE_ACTIVITY_KIND_NDK = LIVE_ACTIVITY_KIND as unknown as NDKKind
const LIVE_CHAT_KIND_NDK = LIVE_CHAT_KIND as unknown as NDKKind

const AUCTION_MONITOR_LIMIT = 500
const AUCTION_FILTER_CHUNK_SIZE = 80
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

const getAddressableEventCoordinate = (event: NDKEvent): string => {
	const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
	return dTag ? `${event.kind}:${event.pubkey}:${dTag}` : ''
}

const getTagValues = (event: NDKEvent, tagNames: string[]): string[] =>
	event.tags.filter((tag) => tagNames.includes(tag[0]) && Boolean(tag[1])).map((tag) => tag[1])

const resolveScopedKeyFromLookups = (values: string[], lookups: Array<Map<string, string>>): string => {
	for (const value of values) {
		for (const lookup of lookups) {
			const scopedKey = lookup.get(value)
			if (scopedKey) return scopedKey
		}
	}
	return ''
}

const getAuctionNotificationKey = (auction: NDKEvent): string =>
	getAuctionRootEventId(auction) || getAuctionCoordinate(auction) || auction.id

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
	authors,
}: {
	kind: NDKKind
	auctionRootEventIds: string[]
	auctionCoordinates: string[]
	since?: number
	authors?: string[]
}): NDKFilter[] => {
	const filters: NDKFilter[] = []
	const baseFilter = {
		kinds: [kind],
		limit: AUCTION_MONITOR_LIMIT,
		...(authors && authors.length > 0 ? { authors } : {}),
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

const makeTaggedValueFilters = ({
	kind,
	tagName,
	values,
	since,
	authors,
}: {
	kind: NDKKind
	tagName: '#a' | '#A' | '#e' | '#E'
	values: string[]
	since?: number
	authors?: string[]
}): NDKFilter[] => {
	const filters: NDKFilter[] = []
	const baseFilter = {
		kinds: [kind],
		limit: AUCTION_MONITOR_LIMIT,
		...(authors && authors.length > 0 ? { authors } : {}),
		...(typeof since === 'number' ? { since } : {}),
	}

	for (const valueChunk of chunkValues(uniqueStrings(values), AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			[tagName]: valueChunk,
		})
	}

	return filters
}

const getTrustedAuthorsForKind = (kind: NDKKind): string[] | undefined => {
	if (kind !== LIVE_ACTIVITY_KIND_NDK) return undefined

	const cvmServerPubkey = configStore.state.config.cvmServerPubkey?.trim()
	return cvmServerPubkey ? [cvmServerPubkey] : undefined
}

const fetchTaggedAuctionEvents = async ({
	kind,
	auctionRootEventIds,
	auctionCoordinates,
	since,
}: {
	kind: NDKKind
	auctionRootEventIds: string[]
	auctionCoordinates: string[]
	since?: number
}): Promise<NDKEvent[]> => {
	const trustedAuthors = getTrustedAuthorsForKind(kind)
	const filters = makeTaggedAuctionFilters({
		kind,
		auctionRootEventIds,
		auctionCoordinates,
		since,
		authors: trustedAuthors,
	})
	if (filters.length === 0) return []

	const events = await ndkActions.fetchEventsWithTimeout(filters.length === 1 ? filters[0] : filters, { timeoutMs: 8000 })
	return dedupeEvents(Array.from(events))
}

const fetchTaggedEvents = async ({
	kind,
	tagName,
	values,
	since,
	authors,
}: {
	kind: NDKKind
	tagName: '#a' | '#A' | '#e' | '#E'
	values: string[]
	since?: number
	authors?: string[]
}): Promise<NDKEvent[]> => {
	const filters = makeTaggedValueFilters({
		kind,
		tagName,
		values,
		since,
		authors,
	})
	if (filters.length === 0) return []

	const events = await ndkActions.fetchEventsWithTimeout(filters.length === 1 ? filters[0] : filters, { timeoutMs: 8000 })
	return dedupeEvents(Array.from(events))
}

const fetchAddressableCommentEvents = async ({
	targetEventIds,
	targetCoordinates,
	since,
}: {
	targetEventIds: string[]
	targetCoordinates: string[]
	since?: number
}): Promise<NDKEvent[]> => {
	const [byCoordinates, byUpperCoordinates, byUpperEventIds] = await Promise.all([
		fetchTaggedEvents({
			kind: COMMENT_KIND_NDK,
			tagName: '#a',
			values: targetCoordinates,
			since,
		}),
		fetchTaggedEvents({
			kind: COMMENT_KIND_NDK,
			tagName: '#A',
			values: targetCoordinates,
			since,
		}),
		fetchTaggedEvents({
			kind: COMMENT_KIND_NDK,
			tagName: '#E',
			values: targetEventIds,
			since,
		}),
	])

	return dedupeEvents([...byCoordinates, ...byUpperCoordinates, ...byUpperEventIds])
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
		const seenAuctionThreadCommentEventIds = new Set<string>()
		const seenBidEventIds = new Set<string>()
		const seenProductCommentEventIds = new Set<string>()
		const seenSettlementEventIds = new Set<string>()
		const scheduledAuctionLiveKeys = new Set<string>()
		const scheduledAuctionSettlementKeys = new Set<string>()
		const phaseTimeoutIds: number[] = []

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

		const isNewAuctionBid = (event: NDKEvent, auctionKey?: string): boolean => {
			const lastSeen = notificationActions.getLastSeenAuctionBids(auctionKey)
			return (event.created_at || 0) > lastSeen
		}

		const isNewBidUpdate = (event: NDKEvent): boolean => {
			const lastSeen = notificationActions.getLastSeenBidUpdates()
			return (event.created_at || 0) > lastSeen
		}

		const isNewAuctionComment = (event: NDKEvent, auctionKey?: string): boolean => {
			const lastSeen = notificationActions.getLastSeenAuctionComments(auctionKey)
			return (event.created_at || 0) > lastSeen
		}

		const isNewAuctionEventComment = (event: NDKEvent, auctionKey?: string): boolean => {
			const lastSeen = notificationActions.getLastSeenAuctionEventComments(auctionKey)
			return (event.created_at || 0) > lastSeen
		}

		const isNewProductComment = (event: NDKEvent, productKey?: string): boolean => {
			const lastSeen = notificationActions.getLastSeenProductComments(productKey)
			return (event.created_at || 0) > lastSeen
		}

		const subscribeToTaggedAuctionEvents = ({
			kind,
			tagName,
			values,
			onEvent,
		}: {
			kind: NDKKind
			tagName: '#e' | '#a' | '#A' | '#E'
			values: string[]
			onEvent: (event: NDKEvent) => void
		}) => {
			if (isCancelled || values.length === 0) return

			const trustedAuthors = getTrustedAuthorsForKind(kind)

			for (const valueChunk of chunkValues(uniqueStrings(values), AUCTION_FILTER_CHUNK_SIZE)) {
				const filter = {
					kinds: [kind],
					[tagName]: valueChunk,
					...(trustedAuthors ? { authors: trustedAuthors } : {}),
					since: subscriptionSince,
				} as NDKFilter

				const subscription = ndk.subscribe(filter, {
					closeOnEose: false,
				})

				subscription.on('event', onEvent)
				subscriptionsRef.current.push(subscription)
			}
		}

		const scheduleAuctionPhaseNotification = (auction: NDKEvent) => {
			const auctionKey = getAuctionNotificationKey(auction)
			if (!auctionKey) return

			const scheduleAt = (runAt: number, scheduledKeys: Set<string>, callback: () => void) => {
				if (!runAt || runAt <= Math.floor(Date.now() / 1000) || scheduledKeys.has(auctionKey)) return
				scheduledKeys.add(auctionKey)
				const timeoutId = window.setTimeout(
					() => {
						scheduledKeys.delete(auctionKey)
						if (isCancelled) return
						callback()
					},
					Math.max(0, runAt * 1000 - Date.now()),
				)
				phaseTimeoutIds.push(timeoutId)
			}

			const startAt = getAuctionStartAt(auction)
			if (startAt > notificationActions.getLastSeenAuctionLive(auctionKey)) {
				scheduleAt(startAt, scheduledAuctionLiveKeys, () => {
					console.log('[NotificationMonitor] Seller auction went live:', auction.id)
					notificationActions.incrementUnseenAuctionLive()
				})
			}

			const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
			if (biddingCutoffAt > notificationActions.getLastSeenAuctionSettlementBegins(auctionKey)) {
				scheduleAt(biddingCutoffAt, scheduledAuctionSettlementKeys, () => {
					console.log('[NotificationMonitor] Seller auction entered settlement:', auction.id)
					notificationActions.incrementUnseenAuctionSettlementBegins()
				})
			}
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
				const now = Math.floor(Date.now() / 1000)
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
				const sellerProducts = await fetchProductsByPubkey(user.pubkey, true, 500)
				const sellerAuctionKeyByRootEventId = new Map<string, string>()
				const sellerAuctionKeyByCoordinate = new Map<string, string>()
				const sellerProductKeyByEventId = new Map<string, string>()
				const sellerProductKeyByCoordinate = new Map<string, string>()

				for (const auction of sellerAuctions) {
					const auctionKey = getAuctionNotificationKey(auction)
					if (!auctionKey) continue

					const rootEventId = getAuctionRootEventId(auction) || auction.id
					const coordinate = getAuctionCoordinate(auction)
					if (rootEventId) sellerAuctionKeyByRootEventId.set(rootEventId, auctionKey)
					if (coordinate) sellerAuctionKeyByCoordinate.set(coordinate, auctionKey)
				}

				for (const product of sellerProducts) {
					const productKey = getProductCoordinates(product) || product.id
					if (!productKey) continue

					sellerProductKeyByEventId.set(product.id, productKey)
					const coordinate = getProductCoordinates(product)
					if (coordinate) sellerProductKeyByCoordinate.set(coordinate, productKey)
				}

				const sellerAuctionRootEventIds = uniqueStrings(sellerAuctions.map((auction) => getAuctionRootEventId(auction) || auction.id))
				const sellerAuctionCoordinates = uniqueStrings(sellerAuctions.map(getAuctionCoordinate))
				const sellerProductEventIds = uniqueStrings(sellerProducts.map((product) => product.id))
				const sellerProductCoordinates = uniqueStrings(sellerProducts.map(getProductCoordinates))
				const sellerBidEvents = await fetchTaggedAuctionEvents({
					kind: AUCTION_BID_KIND,
					auctionRootEventIds: sellerAuctionRootEventIds,
					auctionCoordinates: sellerAuctionCoordinates,
					since: notificationActions.getLastSeenAuctionBids() + 1,
				})
				const sellerLiveActivityEvents = await fetchTaggedAuctionEvents({
					kind: LIVE_ACTIVITY_KIND_NDK,
					auctionRootEventIds: [],
					auctionCoordinates: sellerAuctionCoordinates,
				})
				const sellerLiveActivityCoords = uniqueStrings(
					sellerLiveActivityEvents.map((event) => getAddressableEventCoordinate(event)).filter(Boolean),
				)
				const sellerAuctionKeyByLiveActivityCoordinate = new Map<string, string>()
				for (const event of sellerLiveActivityEvents) {
					const liveActivityCoordinate = getAddressableEventCoordinate(event)
					if (!liveActivityCoordinate) continue

					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerAuctionKeyByCoordinate,
						sellerAuctionKeyByRootEventId,
					])
					if (auctionKey) sellerAuctionKeyByLiveActivityCoordinate.set(liveActivityCoordinate, auctionKey)
				}
				const sellerLiveChatEvents = await fetchTaggedAuctionEvents({
					kind: LIVE_CHAT_KIND_NDK,
					auctionRootEventIds: [],
					auctionCoordinates: sellerLiveActivityCoords,
					since: notificationActions.getLastSeenAuctionComments() + 1,
				})
				const [sellerAuctionCommentEvents, sellerProductCommentEvents] = await Promise.all([
					fetchAddressableCommentEvents({
						targetEventIds: sellerAuctionRootEventIds,
						targetCoordinates: sellerAuctionCoordinates,
						since: notificationActions.getLastSeenAuctionEventComments() + 1,
					}),
					fetchAddressableCommentEvents({
						targetEventIds: sellerProductEventIds,
						targetCoordinates: sellerProductCoordinates,
						since: notificationActions.getLastSeenProductComments() + 1,
					}),
				])

				const newSellerBidEvents = sellerBidEvents.filter((event) => {
					seenAuctionEventIds.add(event.id)
					const auctionKey = resolveScopedKeyFromLookups([getEventAuctionRootId(event), getEventAuctionCoordinate(event)].filter(Boolean), [
						sellerAuctionKeyByRootEventId,
						sellerAuctionKeyByCoordinate,
					])
					return event.pubkey !== user.pubkey && isCountableAuctionBidEvent(event) && isNewAuctionBid(event, auctionKey)
				})

				const newSellerLiveChatEvents = sellerLiveChatEvents.filter((event) => {
					seenAuctionCommentEventIds.add(event.id)
					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A']), [sellerAuctionKeyByLiveActivityCoordinate])
					return event.pubkey !== user.pubkey && isNewAuctionComment(event, auctionKey)
				})

				const newSellerAuctionCommentEvents = sellerAuctionCommentEvents.filter((event) => {
					seenAuctionThreadCommentEventIds.add(event.id)
					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerAuctionKeyByCoordinate,
						sellerAuctionKeyByRootEventId,
					])
					return event.pubkey !== user.pubkey && isNewAuctionEventComment(event, auctionKey)
				})

				const newSellerProductCommentEvents = sellerProductCommentEvents.filter((event) => {
					seenProductCommentEventIds.add(event.id)
					const productKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerProductKeyByCoordinate,
						sellerProductKeyByEventId,
					])
					return event.pubkey !== user.pubkey && isNewProductComment(event, productKey)
				})

				const unseenAuctionLiveCount = sellerAuctions.filter((auction) => {
					const startAt = getAuctionStartAt(auction)
					return startAt > notificationActions.getLastSeenAuctionLive(getAuctionNotificationKey(auction)) && startAt <= now
				}).length

				const unseenAuctionSettlementBeginsCount = sellerAuctions.filter((auction) => {
					const biddingCutoffAt = getAuctionBiddingCutoffAt(auction)
					return (
						biddingCutoffAt > notificationActions.getLastSeenAuctionSettlementBegins(getAuctionNotificationKey(auction)) &&
						biddingCutoffAt <= now
					)
				}).length

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
					auctionCommentCount: newSellerLiveChatEvents.length,
					auctionEventCommentCount: newSellerAuctionCommentEvents.length,
					productCommentCount: newSellerProductCommentEvents.length,
					auctionLiveCount: unseenAuctionLiveCount,
					auctionSettlementBeginsCount: unseenAuctionSettlementBeginsCount,
					bidUpdateCount: newHigherBidEvents.length + newSettlementEvents.length,
				})

				console.log('[NotificationMonitor] Initial counts:', {
					orders: newOrders.length,
					messages: totalUnseenMessages,
					purchases: newPurchaseUpdates.length,
					auctionBids: newSellerBidEvents.length,
					auctionComments: newSellerLiveChatEvents.length,
					auctionEventComments: newSellerAuctionCommentEvents.length,
					productComments: newSellerProductCommentEvents.length,
					auctionLive: unseenAuctionLiveCount,
					auctionSettlementBegins: unseenAuctionSettlementBeginsCount,
					bidUpdates: newHigherBidEvents.length + newSettlementEvents.length,
					conversations: Object.keys(conversationCounts).length,
				})

				sellerAuctions.forEach(scheduleAuctionPhaseNotification)

				const handleSellerBidEvent = (event: NDKEvent) => {
					if (!event.id || seenAuctionEventIds.has(event.id)) return
					seenAuctionEventIds.add(event.id)

					const auctionKey = resolveScopedKeyFromLookups([getEventAuctionRootId(event), getEventAuctionCoordinate(event)].filter(Boolean), [
						sellerAuctionKeyByRootEventId,
						sellerAuctionKeyByCoordinate,
					])
					if (event.pubkey === user.pubkey || !isCountableAuctionBidEvent(event) || !isNewAuctionBid(event, auctionKey)) return

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

				const handleSellerLiveChatEvent = (event: NDKEvent) => {
					if (!event.id || seenAuctionCommentEventIds.has(event.id)) return
					seenAuctionCommentEventIds.add(event.id)

					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A']), [sellerAuctionKeyByLiveActivityCoordinate])
					if (event.pubkey === user.pubkey || !isNewAuctionComment(event, auctionKey)) return

					console.log('[NotificationMonitor] New live chat comment on seller auction:', event.id)
					notificationActions.incrementUnseenAuctionComments()
				}

				const handleSellerAuctionCommentEvent = (event: NDKEvent) => {
					if (!event.id || seenAuctionThreadCommentEventIds.has(event.id)) return
					seenAuctionThreadCommentEventIds.add(event.id)

					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerAuctionKeyByCoordinate,
						sellerAuctionKeyByRootEventId,
					])
					if (event.pubkey === user.pubkey || !isNewAuctionEventComment(event, auctionKey)) return

					console.log('[NotificationMonitor] New thread comment on seller auction:', event.id)
					notificationActions.incrementUnseenAuctionEventComments()
				}

				const handleSellerProductCommentEvent = (event: NDKEvent) => {
					if (!event.id || seenProductCommentEventIds.has(event.id)) return
					seenProductCommentEventIds.add(event.id)

					const productKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerProductKeyByCoordinate,
						sellerProductKeyByEventId,
					])
					if (event.pubkey === user.pubkey || !isNewProductComment(event, productKey)) return

					console.log('[NotificationMonitor] New thread comment on seller product:', event.id)
					notificationActions.incrementUnseenProductComments()
				}

				const handleWatchedSettlementEvent = (event: NDKEvent) => {
					if (!event.id || seenSettlementEventIds.has(event.id)) return
					seenSettlementEventIds.add(event.id)
					if (event.pubkey === user.pubkey || !isNewBidUpdate(event)) return

					console.log('[NotificationMonitor] New settlement on watched auction:', event.id)
					notificationActions.incrementUnseenBidUpdates()
				}

				const handleOwnAuctionEvent = (event: NDKEvent) => {
					if (event.pubkey !== user.pubkey) return
					scheduleAuctionPhaseNotification(event)
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
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#a',
					values: sellerAuctionCoordinates,
					onEvent: handleSellerAuctionCommentEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#A',
					values: sellerAuctionCoordinates,
					onEvent: handleSellerAuctionCommentEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#E',
					values: sellerAuctionRootEventIds,
					onEvent: handleSellerAuctionCommentEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#a',
					values: sellerProductCoordinates,
					onEvent: handleSellerProductCommentEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#A',
					values: sellerProductCoordinates,
					onEvent: handleSellerProductCommentEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#E',
					values: sellerProductEventIds,
					onEvent: handleSellerProductCommentEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: LIVE_CHAT_KIND_NDK,
					tagName: '#a',
					values: sellerLiveActivityCoords,
					onEvent: handleSellerLiveChatEvent,
				})

				const auctionListingSubscription = ndk.subscribe(
					{
						kinds: [AUCTION_KIND_NDK],
						authors: [user.pubkey],
						since: subscriptionSince,
					},
					{
						closeOnEose: false,
					},
				)

				auctionListingSubscription.on('event', handleOwnAuctionEvent)
				subscriptionsRef.current.push(auctionListingSubscription)

				console.log('[NotificationMonitor] Subscriptions active:', subscriptionsRef.current.length)
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
			phaseTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
			subscriptionsRef.current.forEach((sub) => {
				sub.stop()
			})
			subscriptionsRef.current = []
			isMonitoringRef.current = false
		}
	}, [user?.pubkey, isInitialized])
}
