import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'

export const AUCTION_KIND = 30408 as unknown as NonNullable<NDKFilter['kinds']>[number]
export const AUCTION_BID_KIND = 1023 as unknown as NonNullable<NDKFilter['kinds']>[number]
export const AUCTION_SETTLEMENT_KIND = 1024 as unknown as NonNullable<NDKFilter['kinds']>[number]
export const ACTIVE_AUCTION_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])
export const AUCTION_ROOT_EVENT_ID_TAG = 'auction_root_event_id'

export const AUCTION_SETTLEMENT_POLICY = 'cashu_p2pk_path_oracle_v1'

const AUCTION_IMMUTABLE_SINGLE_TAGS = [
	'auction_type',
	'start_at',
	'end_at',
	'currency',
	'price',
	'starting_bid',
	'bid_increment',
	'reserve',
	'path_issuer',
	'key_scheme',
	'p2pk_xpub',
	'extension_rule',
	'max_end_at',
	'settlement_policy',
	'schema',
]
const AUCTION_IMMUTABLE_MULTI_TAGS = ['mint']

export type AuctionSettlementPublishStatus = 'settled' | 'reserve_not_met'
export type AuctionExtensionRule =
	| { kind: 'none'; raw: string }
	| { kind: 'anti_sniping'; raw: string; windowSeconds: number; extensionSeconds: number }

export type AuctionBidChainGroup = {
	bidderPubkey: string
	latestBid: NDKEvent
	chain: NDKEvent[]
}

export interface ResolvedAuctionVersionSet {
	rootEvent: NDKEvent
	displayEvent: NDKEvent
	rootEventId: string
	rejectedEventIds: string[]
}

export interface AuctionSettlementWinnerToken {
	bidEventId: string
	bidderPubkey: string
	derivationPath: string
	childPubkey: string
	mintUrl: string
	amount: number
	totalBidAmount: number
	commitment: string
	locktime: number
	refundPubkey: string
	token: string
}

export interface AuctionSettlementPlanResponse {
	auctionEventId: string
	auctionCoordinates?: string
	status: AuctionSettlementPublishStatus
	closeAt: number
	reserve: number
	winningBidEventId?: string
	winnerPubkey?: string
	finalAmount: number
	winnerTokens: AuctionSettlementWinnerToken[]
	/** Identifier echoed into the kind 1024 settlement event for issuer audit. */
	releaseId?: string
}

export const getAuctionTagValue = (event: NDKEvent, tagName: string): string => event.tags.find((tag) => tag[0] === tagName)?.[1] || ''
export const getAuctionTagValues = (event: NDKEvent, tagName: string): string[] =>
	event.tags.filter((tag) => tag[0] === tagName && !!tag[1]).map((tag) => tag[1] || '')

export const parseAuctionNonNegativeInt = (value?: string, fallback: number = 0): number => {
	const parsed = value ? parseInt(value, 10) : NaN
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export const getAuctionBidAmount = (bidEvent: NDKEvent): number => {
	const amountTag = getAuctionTagValue(bidEvent, 'amount')
	if (amountTag) return parseAuctionNonNegativeInt(amountTag, 0)

	try {
		const parsedContent = JSON.parse(bidEvent.content || '{}')
		return parseAuctionNonNegativeInt(String(parsedContent?.amount || '0'), 0)
	} catch {
		return 0
	}
}

export const getAuctionBidStatus = (bidEvent: NDKEvent): string => getAuctionTagValue(bidEvent, 'status') || 'unknown'

export const getAuctionReserveAmount = (auctionEvent: NDKEvent): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'reserve'), 0)

export const getAuctionStartAt = (auctionEvent: NDKEvent): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'start_at'), 0)
export const getAuctionEndAt = (auctionEvent: NDKEvent): number => parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'end_at'), 0)
export const getAuctionMaxEndAt = (auctionEvent: NDKEvent): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'max_end_at'), 0)
export const getAuctionRootEventId = (auctionEvent: NDKEvent): string =>
	getAuctionTagValue(auctionEvent, AUCTION_ROOT_EVENT_ID_TAG) || auctionEvent.id
export const getAuctionCoordinate = (auctionEvent: NDKEvent): string => {
	const dTag = getAuctionTagValue(auctionEvent, 'd')
	return dTag ? `${AUCTION_KIND}:${auctionEvent.pubkey}:${dTag}` : ''
}

const normalizeComparableValueList = (values: string[]): string[] =>
	Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right))

export const getAuctionExtensionRule = (auctionEvent: NDKEvent): AuctionExtensionRule => {
	const raw = getAuctionTagValue(auctionEvent, 'extension_rule') || 'none'
	if (raw === 'none') return { kind: 'none', raw }

	const [ruleKind, windowValue, extensionValue] = raw.split(':')
	if (ruleKind !== 'anti_sniping') return { kind: 'none', raw }

	const windowSeconds = parseAuctionNonNegativeInt(windowValue, 0)
	const extensionSeconds = parseAuctionNonNegativeInt(extensionValue, 0)
	if (windowSeconds <= 0 || extensionSeconds <= 0) return { kind: 'none', raw }

	return {
		kind: 'anti_sniping',
		raw,
		windowSeconds,
		extensionSeconds,
	}
}

export const auctionImmutableFieldsMatch = (rootEvent: NDKEvent, candidateEvent: NDKEvent): boolean => {
	for (const tagName of AUCTION_IMMUTABLE_SINGLE_TAGS) {
		if (getAuctionTagValue(rootEvent, tagName) !== getAuctionTagValue(candidateEvent, tagName)) return false
	}

	for (const tagName of AUCTION_IMMUTABLE_MULTI_TAGS) {
		const rootValues = normalizeComparableValueList(getAuctionTagValues(rootEvent, tagName))
		const candidateValues = normalizeComparableValueList(getAuctionTagValues(candidateEvent, tagName))
		if (rootValues.length !== candidateValues.length) return false
		if (rootValues.some((value, index) => value !== candidateValues[index])) return false
	}

	return true
}

export const compareAuctionPublishedOrderAscending = (left: NDKEvent, right: NDKEvent): number => {
	const createdAtDelta = (left.created_at || 0) - (right.created_at || 0)
	if (createdAtDelta !== 0) return createdAtDelta
	return left.id.localeCompare(right.id)
}

export const resolveAuctionVersionSet = (events: NDKEvent[]): ResolvedAuctionVersionSet | null => {
	if (!events.length) return null

	const sorted = [...events].sort(compareAuctionPublishedOrderAscending)
	const explicitRootId = sorted.map((event) => getAuctionTagValue(event, AUCTION_ROOT_EVENT_ID_TAG)).find(Boolean)
	const rootEvent = (explicitRootId ? sorted.find((event) => event.id === explicitRootId) : undefined) || sorted[0]
	const rootEventId = rootEvent.id
	const compatibleEvents = sorted.filter((event) => {
		const eventRootEventId = getAuctionTagValue(event, AUCTION_ROOT_EVENT_ID_TAG)
		if (eventRootEventId && eventRootEventId !== rootEventId) return false
		return auctionImmutableFieldsMatch(rootEvent, event)
	})
	const displayEvent = compatibleEvents[compatibleEvents.length - 1] || rootEvent
	const compatibleIds = new Set(compatibleEvents.map((event) => event.id))

	return {
		rootEvent,
		displayEvent,
		rootEventId,
		rejectedEventIds: sorted.filter((event) => !compatibleIds.has(event.id)).map((event) => event.id),
	}
}

export const compareAuctionBidChronologyAscending = (left: NDKEvent, right: NDKEvent): number => {
	const createdAtDelta = (left.created_at || 0) - (right.created_at || 0)
	if (createdAtDelta !== 0) return createdAtDelta
	return left.id.localeCompare(right.id)
}

export const getAuctionEffectiveEndAt = (auctionEvent: NDKEvent, bids: NDKEvent[]): number => {
	const nominalEndAt = getAuctionEndAt(auctionEvent)
	if (!nominalEndAt) return 0

	const extensionRule = getAuctionExtensionRule(auctionEvent)
	if (extensionRule.kind !== 'anti_sniping') return nominalEndAt

	const maxEndAt = getAuctionMaxEndAt(auctionEvent)
	if (!maxEndAt || maxEndAt <= nominalEndAt) return nominalEndAt

	const startAt = getAuctionStartAt(auctionEvent)
	const auctionRootEventId = getAuctionRootEventId(auctionEvent)
	let effectiveEndAt = nominalEndAt

	for (const bid of [...bids].sort(compareAuctionBidChronologyAscending)) {
		if (!ACTIVE_AUCTION_BID_STATUSES.has(getAuctionBidStatus(bid))) continue
		if (getAuctionTagValue(bid, 'e') !== auctionRootEventId) continue

		const bidCreatedAt = bid.created_at || 0
		if (bidCreatedAt < startAt) continue
		if (bidCreatedAt > effectiveEndAt) continue

		const remaining = effectiveEndAt - bidCreatedAt
		if (remaining > 0 && remaining < extensionRule.windowSeconds) {
			effectiveEndAt = Math.min(maxEndAt, effectiveEndAt + extensionRule.extensionSeconds)
		}
	}

	return effectiveEndAt
}

export const getAuctionWindowValidBids = (auctionEvent: NDKEvent, bids: NDKEvent[]): NDKEvent[] => {
	const auctionRootEventId = getAuctionRootEventId(auctionEvent)
	const startAt = getAuctionStartAt(auctionEvent)
	const effectiveEndAt = getAuctionEffectiveEndAt(auctionEvent, bids)

	return [...bids].sort(compareAuctionBidChronologyAscending).filter((bid) => {
		if (!ACTIVE_AUCTION_BID_STATUSES.has(getAuctionBidStatus(bid))) return false
		if (getAuctionTagValue(bid, 'e') !== auctionRootEventId) return false

		const bidCreatedAt = bid.created_at || 0
		return bidCreatedAt >= startAt && bidCreatedAt <= effectiveEndAt
	})
}

export const getAuctionCurrentPrice = (auctionEvent: NDKEvent, bids: NDKEvent[], startingBid: number = 0): number =>
	getAuctionWindowValidBids(auctionEvent, bids).reduce((currentPrice, bid) => Math.max(currentPrice, getAuctionBidAmount(bid)), startingBid)

export const collectAuctionBidChain = (latestBid: NDKEvent, bidById: Map<string, NDKEvent>): NDKEvent[] => {
	const chain: NDKEvent[] = []
	const seen = new Set<string>()
	let current: NDKEvent | undefined = latestBid

	while (current && !seen.has(current.id)) {
		chain.unshift(current)
		seen.add(current.id)
		const previousBidId = getAuctionTagValue(current, 'prev_bid')
		if (!previousBidId) break
		const previousBid = bidById.get(previousBidId)
		if (!previousBid) {
			throw new Error(`Missing previous bid event ${previousBidId} for bid ${latestBid.id}`)
		}
		current = previousBid
	}

	return chain
}

export const buildActiveAuctionBidChains = (bids: NDKEvent[]): AuctionBidChainGroup[] => {
	const latestByBidder = new Map<string, NDKEvent>()

	for (const bid of bids) {
		if (!ACTIVE_AUCTION_BID_STATUSES.has(getAuctionBidStatus(bid))) continue
		const existing = latestByBidder.get(bid.pubkey)
		if (!existing) {
			latestByBidder.set(bid.pubkey, bid)
			continue
		}

		const amountDelta = getAuctionBidAmount(bid) - getAuctionBidAmount(existing)
		if (amountDelta > 0) {
			latestByBidder.set(bid.pubkey, bid)
			continue
		}
		if (amountDelta === 0) {
			const createdAtDelta = (bid.created_at || 0) - (existing.created_at || 0)
			if (createdAtDelta > 0 || (createdAtDelta === 0 && bid.id.localeCompare(existing.id) > 0)) {
				latestByBidder.set(bid.pubkey, bid)
			}
		}
	}

	const bidById = new Map(bids.map((bid) => [bid.id, bid]))
	return Array.from(latestByBidder.entries()).map(([bidderPubkey, latestBid]) => ({
		bidderPubkey,
		latestBid,
		chain: collectAuctionBidChain(latestBid, bidById),
	}))
}

export const compareAuctionBidChainPriority = (left: AuctionBidChainGroup, right: AuctionBidChainGroup): number => {
	const amountDelta = getAuctionBidAmount(right.latestBid) - getAuctionBidAmount(left.latestBid)
	if (amountDelta !== 0) return amountDelta

	const createdAtDelta = (right.latestBid.created_at || 0) - (left.latestBid.created_at || 0)
	if (createdAtDelta !== 0) return createdAtDelta

	return right.latestBid.id.localeCompare(left.latestBid.id)
}
