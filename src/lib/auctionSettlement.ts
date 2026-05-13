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
	// `extension_rule` is retired in v1 (AUCTIONS.md §6.1) but kept in the
	// immutable list so that auctions which still emit it (legacy auctions
	// or backwards-compatible publishers) can't switch its value post-publish.
	'extension_rule',
	'max_end_at',
	'settlement_grace',
	'min_bid_curve',
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
/**
 * Per-auction settlement grace in seconds (the gap between `max_end_at` and
 * the bid's Cashu locktime — see AUCTIONS.md §4.1 / §6.0). Auctions are
 * required to emit this; a 0 fallback signals a malformed (legacy) event.
 */
export const getAuctionSettlementGrace = (auctionEvent: NDKEvent): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'settlement_grace'), 0)

/**
 * AUCTIONS.md §6.1 — Lag tolerance applied server-side when computing
 * the bid floor. `request_path` evaluates the curve at
 * `effective_t = max(server_now - GRACE, end_at)`; `request_settlement`
 * per-bid re-check uses
 * `effective_t = clamp(bid.created_at - GRACE, end_at, max_end_at)`.
 *
 * Single-sided (only the server is lenient) so the bidder client can
 * display the floor at `client_now` without inflation and trust that a
 * bid at the displayed price will be accepted within 5 s of click→relay
 * latency.
 */
export const BID_FLOOR_TIME_GRACE_SECONDS = 5

export const getAuctionStartingBid = (auctionEvent: NDKEvent): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'starting_bid'), 0)

export const getAuctionBidIncrement = (auctionEvent: NDKEvent): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'bid_increment'), 0)

export type AuctionMinBidCurveShape = 'none' | 'linear' | 'exponential'

export interface AuctionMinBidCurve {
	shape: AuctionMinBidCurveShape
	/** Multiplier applied to the baseline floor at `t = max_end_at`. */
	peakMultiplier: number
	/** Raw tag value for diagnostics. `''` when the tag is missing. */
	raw: string
}

const MIN_BID_CURVE_MIN_PEAK = 1
const MIN_BID_CURVE_MAX_PEAK = 100

const parseMinBidCurvePeak = (value: string): number => {
	const parsed = Number.parseFloat(value)
	if (!Number.isFinite(parsed)) return MIN_BID_CURVE_MIN_PEAK
	if (parsed < MIN_BID_CURVE_MIN_PEAK) return MIN_BID_CURVE_MIN_PEAK
	if (parsed > MIN_BID_CURVE_MAX_PEAK) return MIN_BID_CURVE_MAX_PEAK
	return parsed
}

/**
 * Parse the `min_bid_curve` tag value `<shape>:<peak_multiplier>`.
 *
 * Returns `shape: 'none'` (with multiplier `1`) for missing/unrecognised
 * tags so callers can treat "no curve" as the safe default: floor stays
 * flat through the whole bidding window. See AUCTIONS.md §4.1 / §6.1.
 */
export const getAuctionMinBidCurve = (auctionEvent: NDKEvent): AuctionMinBidCurve => {
	const raw = getAuctionTagValue(auctionEvent, 'min_bid_curve')
	if (!raw) return { shape: 'none', peakMultiplier: 1, raw: '' }
	const [shapeRaw, peakRaw] = raw.split(':')
	if (shapeRaw === 'none') return { shape: 'none', peakMultiplier: 1, raw }
	if (shapeRaw === 'linear' || shapeRaw === 'exponential') {
		return { shape: shapeRaw, peakMultiplier: parseMinBidCurvePeak(peakRaw ?? ''), raw }
	}
	// Unrecognised shape — treat as no curve. Be permissive (don't throw)
	// because malformed tags shouldn't brick the bidder UI.
	return { shape: 'none', peakMultiplier: 1, raw }
}

/**
 * Compute the minimum acceptable bid amount for an auction at a given
 * unix-seconds moment, per AUCTIONS.md §6.1.
 *
 * Pure function — same inputs always yield the same output. Used in three
 * places:
 *   - bidder UI: live display of "your bid floor right now is X sats"
 *   - CVM `request_path`: enforced gate before issuing a derivation path
 *   - CVM `request_settlement`: per-bid re-check
 *
 * Floor formula:
 *   `baseline = topBid === 0 ? startingBid : topBid + bidIncrement`
 *   `multiplier(t) = 1` outside the curve window or when shape='none'
 *   `multiplier(t) = peakMultiplier` at or past `max_end_at`
 *   `multiplier(t) = linearly/exponentially interpolated otherwise`
 *   `floor = baseline × multiplier(t)`
 *
 * Returns a positive integer (rounded up — bidder must pay at least the
 * computed floor; rounding down would let bidders shave a sat off).
 */
export const computeAuctionBidFloor = (
	auctionEvent: NDKEvent,
	topBid: number,
	atSeconds: number,
): number => {
	const endAt = getAuctionEndAt(auctionEvent)
	const maxEndAt = getAuctionMaxEndAt(auctionEvent) || endAt
	const startingBid = getAuctionStartingBid(auctionEvent)
	const bidIncrement = getAuctionBidIncrement(auctionEvent)
	const curve = getAuctionMinBidCurve(auctionEvent)

	const baseline = topBid > 0 ? topBid + bidIncrement : startingBid
	const multiplier = computeAuctionFloorMultiplier({
		atSeconds,
		endAt,
		maxEndAt,
		shape: curve.shape,
		peakMultiplier: curve.peakMultiplier,
	})

	// `Math.ceil` so a fractional multiplier still requires the bidder to
	// pay AT LEAST the floor — never less. (E.g. baseline=100,
	// multiplier=1.5 → floor=150 exactly; multiplier=1.501 → 151.)
	return Math.max(0, Math.ceil(baseline * multiplier))
}

/**
 * Floor multiplier at `atSeconds`. Extracted so the seller's
 * curve-preview UI can plot the curve without a full auction event in
 * hand. Same monotonic behaviour as `computeAuctionBidFloor`.
 */
export const computeAuctionFloorMultiplier = (params: {
	atSeconds: number
	endAt: number
	maxEndAt: number
	shape: AuctionMinBidCurveShape
	peakMultiplier: number
}): number => {
	const { atSeconds, endAt, maxEndAt, shape, peakMultiplier } = params
	if (shape === 'none' || peakMultiplier <= 1) return 1
	if (maxEndAt <= endAt) return 1 // zero-duration window → curve disabled
	if (atSeconds <= endAt) return 1
	if (atSeconds >= maxEndAt) return peakMultiplier
	const tNorm = (atSeconds - endAt) / (maxEndAt - endAt)
	if (shape === 'linear') return 1 + (peakMultiplier - 1) * tNorm
	// exponential
	return Math.pow(peakMultiplier, tNorm)
}
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

	const createdAtDelta = (left.latestBid.created_at || 0) - (right.latestBid.created_at || 0)
	if (createdAtDelta !== 0) return createdAtDelta

	return left.latestBid.id.localeCompare(right.latestBid.id)
}
