import type { NostrEventLike } from './nostr/eventLike'
import {
	AUCTION_BID_KIND,
	AUCTION_KIND,
	AUCTION_ROOT_EVENT_ID_TAG,
	AUCTION_SETTLEMENT_KIND,
	AUCTION_SETTLEMENT_POLICY,
	ACTIVE_AUCTION_BID_STATUSES,
} from './auction/constants'
import { auctionImmutableFieldsMatch as compareAuctionImmutableFields } from './auction/immutability'

// Re-export the constants that used to live here so downstream callers
// don't have to chase the move. The canonical definitions are in
// `src/lib/auction/constants.ts` now (bidder-held-path scheme).
export {
	AUCTION_BID_KIND,
	AUCTION_KIND,
	AUCTION_ROOT_EVENT_ID_TAG,
	AUCTION_SETTLEMENT_KIND,
	AUCTION_SETTLEMENT_POLICY,
	ACTIVE_AUCTION_BID_STATUSES,
}

export type AuctionExtensionRule =
	| { kind: 'none'; raw: string }
	| { kind: 'anti_sniping'; raw: string; windowSeconds: number; extensionSeconds: number }

export type AuctionBidChainGroup = {
	bidderPubkey: string
	latestBid: NostrEventLike
	chain: NostrEventLike[]
}

export interface ResolvedAuctionVersionSet {
	rootEvent: NostrEventLike
	displayEvent: NostrEventLike
	rootEventId: string
	rejectedEventIds: string[]
}

// `AuctionSettlementWinnerToken` and `AuctionSettlementPlanResponse`
// belonged to the v1 path-oracle settlement RPC and are gone. The
// bidder-held-path scheme settles directly on-mint after the bidder
// publishes kind-1025; there's no plan envelope to type.

export const getAuctionTagValue = (event: NostrEventLike, tagName: string): string =>
	event.tags.find((tag) => tag[0] === tagName)?.[1] || ''
export const getAuctionTagValues = (event: NostrEventLike, tagName: string): string[] =>
	event.tags.filter((tag) => tag[0] === tagName && !!tag[1]).map((tag) => tag[1] || '')

export const parseAuctionNonNegativeInt = (value?: string, fallback: number = 0): number => {
	const parsed = value ? parseInt(value, 10) : NaN
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export const getAuctionBidAmount = (bidEvent: NostrEventLike): number => {
	const amountTag = getAuctionTagValue(bidEvent, 'amount')
	if (amountTag) return parseAuctionNonNegativeInt(amountTag, 0)

	try {
		const parsedContent = JSON.parse(bidEvent.content || '{}')
		return parseAuctionNonNegativeInt(String(parsedContent?.amount || '0'), 0)
	} catch {
		return 0
	}
}

export const getAuctionBidStatus = (bidEvent: NostrEventLike): string => getAuctionTagValue(bidEvent, 'status') || 'unknown'

export const getAuctionReserveAmount = (auctionEvent: NostrEventLike): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'reserve'), 0)

export const getAuctionStartAt = (auctionEvent: NostrEventLike): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'start_at'), 0)
export const getAuctionEndAt = (auctionEvent: NostrEventLike): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'end_at'), 0)
export const getAuctionMaxEndAt = (auctionEvent: NostrEventLike): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'max_end_at'), 0)
export const getAuctionBiddingCutoffAt = (auctionEvent: NostrEventLike): number => {
	const endAt = getAuctionEndAt(auctionEvent)
	const maxEndAt = getAuctionMaxEndAt(auctionEvent)

	if (!endAt) return 0
	if (!maxEndAt || maxEndAt < endAt) return endAt

	return maxEndAt
}
/**
 * Per-auction settlement grace in seconds (the gap between `max_end_at` and
 * the bid's Cashu locktime — see AUCTIONS.md §4.1 / §6.0). Auctions are
 * required to emit this; a 0 fallback signals a malformed (legacy) event.
 */
export const getAuctionSettlementGrace = (auctionEvent: NostrEventLike): number =>
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

export const getAuctionStartingBid = (auctionEvent: NostrEventLike): number =>
	parseAuctionNonNegativeInt(getAuctionTagValue(auctionEvent, 'starting_bid'), 0)

export const getAuctionBidIncrement = (auctionEvent: NostrEventLike): number =>
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
export const getAuctionMinBidCurve = (auctionEvent: NostrEventLike): AuctionMinBidCurve => {
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
export const computeAuctionBidFloor = (auctionEvent: NostrEventLike, topBid: number, atSeconds: number): number => {
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
export const getAuctionRootEventId = (auctionEvent: NostrEventLike): string =>
	getAuctionTagValue(auctionEvent, AUCTION_ROOT_EVENT_ID_TAG) || auctionEvent.id
export const getAuctionCoordinate = (auctionEvent: NostrEventLike): string => {
	const dTag = getAuctionTagValue(auctionEvent, 'd')
	return dTag ? `${AUCTION_KIND}:${auctionEvent.pubkey}:${dTag}` : ''
}

export const getAuctionExtensionRule = (auctionEvent: NostrEventLike): AuctionExtensionRule => {
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
export const auctionImmutableFieldsMatch = compareAuctionImmutableFields

export const compareAuctionPublishedOrderAscending = (left: NostrEventLike, right: NostrEventLike): number => {
	const createdAtDelta = (left.created_at || 0) - (right.created_at || 0)
	if (createdAtDelta !== 0) return createdAtDelta
	return left.id.localeCompare(right.id)
}

export const resolveAuctionVersionSet = (events: NostrEventLike[]): ResolvedAuctionVersionSet | null => {
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

export const compareAuctionBidChronologyAscending = (left: NostrEventLike, right: NostrEventLike): number => {
	const createdAtDelta = (left.created_at || 0) - (right.created_at || 0)
	if (createdAtDelta !== 0) return createdAtDelta
	return left.id.localeCompare(right.id)
}

export const getAuctionEffectiveEndAt = (auctionEvent: NostrEventLike, bids: NostrEventLike[]): number => {
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

export const getAuctionBidAcceptanceEndAt = (auctionEvent: NostrEventLike, bids: NostrEventLike[]): number => {
	const extensionRule = getAuctionExtensionRule(auctionEvent)

	if (extensionRule.kind === 'anti_sniping') {
		return getAuctionEffectiveEndAt(auctionEvent, bids)
	}

	return getAuctionBiddingCutoffAt(auctionEvent)
}

export const getAuctionWindowValidBids = (auctionEvent: NostrEventLike, bids: NostrEventLike[]): NostrEventLike[] => {
	const auctionRootEventId = getAuctionRootEventId(auctionEvent)
	const startAt = getAuctionStartAt(auctionEvent)
	const acceptanceEndAt = getAuctionBidAcceptanceEndAt(auctionEvent, bids)

	return [...bids].sort(compareAuctionBidChronologyAscending).filter((bid) => {
		if (!ACTIVE_AUCTION_BID_STATUSES.has(getAuctionBidStatus(bid))) return false
		if (getAuctionTagValue(bid, 'e') !== auctionRootEventId) return false

		const bidCreatedAt = bid.created_at || 0
		return bidCreatedAt >= startAt && bidCreatedAt <= acceptanceEndAt
	})
}

export const getAuctionCurrentPrice = (auctionEvent: NostrEventLike, bids: NostrEventLike[], startingBid: number = 0): number =>
	getAuctionWindowValidBids(auctionEvent, bids).reduce((currentPrice, bid) => Math.max(currentPrice, getAuctionBidAmount(bid)), startingBid)

export const collectAuctionBidChain = (latestBid: NostrEventLike, bidById: Map<string, NostrEventLike>): NostrEventLike[] => {
	const chain: NostrEventLike[] = []
	const seen = new Set<string>()
	let current: NostrEventLike | undefined = latestBid

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

export const buildActiveAuctionBidChains = (bids: NostrEventLike[]): AuctionBidChainGroup[] => {
	const latestByBidder = new Map<string, NostrEventLike>()

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
