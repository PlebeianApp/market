import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	AUCTION_BID_KIND,
	AUCTION_IMMUTABLE_MULTI_TAGS,
	AUCTION_IMMUTABLE_SINGLE_TAGS,
	AUCTION_KIND,
	AUCTION_ROOT_EVENT_ID_TAG,
	AUCTION_SETTLEMENT_KIND,
	AUCTION_SETTLEMENT_POLICY,
	ACTIVE_AUCTION_BID_STATUSES,
	type PathReleaseReason,
} from './auction/constants'
import { getBuyerPubkey, getSellerPubkey, type OrderWithRelatedEvents } from '@/queries/orders'
import { deriveAuctionChildP2pkPubkeyFromXpub, auctionP2pkPubkeysMatch } from './auctionP2pk'
import { parsePathReleaseEvent, parseSettlementEvent } from './schemas/auction/settlementEvents'
import { parseBidEvent } from './schemas/auction/bidEvent'
import { parseAuctionEvent } from './schemas/auction/auctionEvent'

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
	latestBid: NDKEvent
	chain: NDKEvent[]
}

export interface ResolvedAuctionVersionSet {
	rootEvent: NDKEvent
	displayEvent: NDKEvent
	rootEventId: string
	rejectedEventIds: string[]
}

/**
 * Validation states for auction settlement
 */
export type AuctionSettlementValidationState =
	| 'no_observed_event'
	| 'observed_unverified'
	| 'validated_buyer_path_release'
	| 'validated_seller_settlement'
	| 'fully_validated_settled'

/**
 * Validation result for auction settlement events
 */
export interface AuctionSettlementValidationResult {
	state: AuctionSettlementValidationState
	hasPathRelease: boolean
	hasSettlement: boolean
	pathReleaseValid: boolean
	settlementValid: boolean
	validations: {
		auctionCoordinate: boolean
		buyerAuthor: boolean
		sellerAuthor: boolean
		participantTags: boolean
		amountShape: boolean
	}
	detailedErrors: {
		pathRelease?: string[]
		settlement?: string[]
		cryptographic?: string[]
		crossReference?: string[]
	}
	errors: string[]
}

// `AuctionSettlementWinnerToken` and `AuctionSettlementPlanResponse`
// belonged to the v1 path-oracle settlement RPC and are gone. The
// bidder-held-path scheme settles directly on-mint after the bidder
// publishes kind-1025; there's no plan envelope to type.

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
export const getAuctionBiddingCutoffAt = (auctionEvent: NDKEvent): number => {
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
export const computeAuctionBidFloor = (auctionEvent: NDKEvent, topBid: number, atSeconds: number): number => {
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

export const getAuctionBidAcceptanceEndAt = (auctionEvent: NDKEvent, bids: NDKEvent[]): number => {
	const extensionRule = getAuctionExtensionRule(auctionEvent)

	if (extensionRule.kind === 'anti_sniping') {
		return getAuctionEffectiveEndAt(auctionEvent, bids)
	}

	return getAuctionBiddingCutoffAt(auctionEvent)
}

export const getAuctionWindowValidBids = (auctionEvent: NDKEvent, bids: NDKEvent[]): NDKEvent[] => {
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

/**
 * Enhanced validation for auction settlement events
 * Addresses all critical flaws identified in PR review
 */
export function validateAuctionSettlementEvents(
	settlements: NDKEvent[],
	pathReleases: NDKEvent[],
	auctionCoordinates: string,
	order: OrderWithRelatedEvents,
	// Additional parameters for comprehensive validation
	auctionEvent?: NDKEvent,
	bidEvents?: NDKEvent[],
): AuctionSettlementValidationResult {
	const result: AuctionSettlementValidationResult = {
		state: 'no_observed_event',
		hasPathRelease: pathReleases.length > 0,
		hasSettlement: settlements.length > 0,
		pathReleaseValid: false,
		settlementValid: false,
		validations: {
			auctionCoordinate: false,
			buyerAuthor: false,
			sellerAuthor: false,
			participantTags: false,
			amountShape: false,
		},
		errors: [],
		detailedErrors: {
			pathRelease: [],
			settlement: [],
			cryptographic: [],
			crossReference: [],
		},
	}

	const buyerPubkey = getBuyerPubkey(order.order)
	const sellerPubkey = getSellerPubkey(order.order)

	// Validate path release events
	if (pathReleases.length > 0) {
		const pathRelease = pathReleases[0]

		// Parse the path release event using the schema
		const parsedPathRelease = parsePathReleaseEvent(pathRelease)
		if (!parsedPathRelease.ok) {
			result.detailedErrors.pathRelease?.push(`Path release schema validation failed: ${parsedPathRelease.error.message}`)
			result.state = 'observed_unverified'
			return result
		}

		const pathReleaseData = parsedPathRelease.value

		// 1. Validate auction coordinate
		const hasCorrectCoordinate = pathRelease.tags.some((tag) => tag[0] === 'a' && tag[1] === auctionCoordinates)
		if (!hasCorrectCoordinate) {
			result.errors.push('Path release missing correct auction coordinate')
			result.detailedErrors.pathRelease?.push('Missing or incorrect auction coordinate')
		}
		result.validations.auctionCoordinate = hasCorrectCoordinate

		// 2. Validate buyer is the author
		const isBuyerAuthor = pathRelease.pubkey === buyerPubkey
		if (!isBuyerAuthor) {
			result.errors.push('Path release not authored by buyer')
			result.detailedErrors.pathRelease?.push('Path release not authored by the order buyer')
		}
		result.validations.buyerAuthor = isBuyerAuthor

		// 3. Validate p tag points to seller
		const hasCorrectRecipient = pathRelease.tags.some((tag) => tag[0] === 'p' && tag[1] === sellerPubkey)
		if (!hasCorrectRecipient) {
			result.errors.push('Path release missing correct recipient')
			result.detailedErrors.pathRelease?.push('Missing or incorrect seller recipient tag')
		}
		result.validations.participantTags = hasCorrectRecipient

		// 4. Validate mandatory tags presence and format
		const derivationPath = pathRelease.tags.find((tag) => tag[0] === 'derivation_path')?.[1]
		if (!derivationPath) {
			result.errors.push('Path release missing derivation_path tag')
			result.detailedErrors.pathRelease?.push('Missing required derivation_path tag')
		} else if (!/^m\/(\d+\/){4}\d+$/.test(derivationPath)) {
			result.detailedErrors.pathRelease?.push('Invalid derivation path format')
		}

		const childPubkey = pathRelease.tags.find((tag) => tag[0] === 'child_pubkey')?.[1]
		if (!childPubkey) {
			result.errors.push('Path release missing child_pubkey tag')
			result.detailedErrors.pathRelease?.push('Missing required child_pubkey tag')
		}

		const releaseReason = pathRelease.tags.find((tag) => tag[0] === 'release_reason')?.[1] as PathReleaseReason | undefined
		const validReasons: PathReleaseReason[] = ['settlement', 'fallback_settlement', 'voluntary_late']
		if (releaseReason && !validReasons.includes(releaseReason)) {
			result.detailedErrors.pathRelease?.push('Invalid release_reason value')
		}

		// 5. Cryptographic validation - verify derivation path produces child pubkey
		if (derivationPath && childPubkey && auctionEvent) {
			const parsedAuction = parseAuctionEvent(auctionEvent)
			if (parsedAuction.ok) {
				const p2pkXpub = parsedAuction.value.p2pkXpub
				if (p2pkXpub) {
					try {
						const derivedPubkey = deriveAuctionChildP2pkPubkeyFromXpub(p2pkXpub, derivationPath)
						if (!auctionP2pkPubkeysMatch(derivedPubkey, childPubkey)) {
							result.errors.push('Derived pubkey does not match child_pubkey')
							result.detailedErrors.cryptographic?.push('Path derivation failed to match child pubkey')
						}
					} catch (error) {
						result.detailedErrors.cryptographic?.push(`Path derivation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
					}
				}
			}
		}

		// 6. Validate referenced bid event exists and belongs to auction
		const bidEventId = pathRelease.tags.find((tag) => tag[0] === 'e')?.[1]
		let bidEvent: NDKEvent | undefined
		if (bidEventId && bidEvents) {
			bidEvent = bidEvents.find((bid) => bid.id === bidEventId)
			if (!bidEvent) {
				result.errors.push('Referenced bid event not found')
				result.detailedErrors.crossReference?.push('Path release references non-existent bid event')
			} else {
				// Validate bid belongs to this auction
				const bidAuctionCoord = bidEvent.tags.find((tag) => tag[0] === 'a')?.[1]
				if (bidAuctionCoord !== auctionCoordinates) {
					result.detailedErrors.crossReference?.push('Referenced bid does not belong to this auction')
				}

				// Parse bid event for additional validation
				const parsedBid = parseBidEvent(bidEvent)
				if (!parsedBid.ok) {
					result.detailedErrors.crossReference?.push(`Referenced bid validation failed: ${parsedBid.error.message}`)
				}
			}
		}

		result.pathReleaseValid =
			(hasCorrectCoordinate && isBuyerAuthor && hasCorrectRecipient && !!derivationPath && !!childPubkey && result.errors.length === 0) ??
			false

		if (result.pathReleaseValid) {
			result.state = 'validated_buyer_path_release'
		} else {
			result.state = 'observed_unverified'
		}
	}

	// Validate settlement events
	if (settlements.length > 0) {
		const settlement = settlements[0]

		// Parse the settlement event using the schema
		const parsedSettlement = parseSettlementEvent(settlement)
		if (!parsedSettlement.ok) {
			result.detailedErrors.settlement?.push(`Settlement schema validation failed: ${parsedSettlement.error.message}`)
			result.state = 'observed_unverified'
			return result
		}

		const settlementData = parsedSettlement.value

		// Validate auction coordinate
		const hasCorrectCoordinate = settlement.tags.some((tag) => tag[0] === 'a' && tag[1] === auctionCoordinates)
		result.validations.auctionCoordinate = result.validations.auctionCoordinate || hasCorrectCoordinate

		if (!hasCorrectCoordinate) {
			result.errors.push('Settlement missing correct auction coordinate')
			result.detailedErrors.settlement?.push('Missing or incorrect auction coordinate')
		}

		// Validate seller is the author
		const isSellerAuthor = settlement.pubkey === sellerPubkey
		if (!isSellerAuthor) {
			result.errors.push('Settlement not authored by seller')
			result.detailedErrors.settlement?.push('Settlement not authored by the auction seller')
		}
		result.validations.sellerAuthor = isSellerAuthor

		// Validate winner tag matches buyer
		const winnerTag = settlement.tags.find((tag) => tag[0] === 'winner')
		const hasCorrectWinner = winnerTag && winnerTag[1] === buyerPubkey
		if (!hasCorrectWinner) {
			result.errors.push('Settlement missing correct winner')
			result.detailedErrors.settlement?.push('Settlement winner does not match order buyer')
		}
		result.validations.participantTags = (result.validations.participantTags || hasCorrectWinner) ?? false

		// Validate amount is present and properly formatted
		const finalAmountTag = settlement.tags.find((tag) => tag[0] === 'final_amount')
		const finalAmount = finalAmountTag ? parseInt(finalAmountTag[1]) : NaN
		const hasAmount = finalAmountTag && !isNaN(finalAmount) && finalAmount > 0
		if (!hasAmount) {
			result.errors.push('Settlement missing valid amount')
			result.detailedErrors.settlement?.push('Settlement missing or has invalid final_amount')
		}
		result.validations.amountShape = hasAmount ?? false

		// 7. Validate status is one of the allowed values
		const statusTag = settlement.tags.find((tag) => tag[0] === 'status')?.[1]
		const validStatuses = ['settled', 'reserve_not_met', 'cancelled', 'griefed_no_fallback']
		if (statusTag && !validStatuses.includes(statusTag)) {
			result.detailedErrors.settlement?.push('Invalid settlement status value')
		}

		// 8. Cross-check final amount against winning bid
		if (hasAmount && bidEvents && settlementData.winningBidId) {
			const winningBid = bidEvents.find((bid) => bid.id === settlementData.winningBidId)
			if (winningBid) {
				const parsedWinningBid = parseBidEvent(winningBid)
				if (parsedWinningBid.ok) {
					const bidAmount = parsedWinningBid.value.amount
					if (finalAmount !== bidAmount) {
						result.detailedErrors.crossReference?.push(`Settlement amount ${finalAmount} does not match bid amount ${bidAmount}`)
					}
				}
			}
		}

		// 9. Validate path_release tag when status is 'settled'
		if (statusTag === 'settled') {
			const pathReleaseId = settlement.tags.find((tag) => tag[0] === 'path_release')?.[1]
			if (!pathReleaseId) {
				result.detailedErrors.settlement?.push('Settlement with status=settled missing required path_release tag')
			}
		}

		result.settlementValid = (hasCorrectCoordinate && isSellerAuthor && hasCorrectWinner && hasAmount) ?? false

		if (result.settlementValid) {
			if (result.state === 'validated_buyer_path_release') {
				result.state = 'fully_validated_settled'
			} else {
				result.state = 'validated_seller_settlement'
			}
		} else if (result.state === 'no_observed_event') {
			result.state = 'observed_unverified'
		} else if (result.hasPathRelease || result.hasSettlement) {
			result.state = 'observed_unverified'
		}
	}

	if (!result.hasPathRelease && !result.hasSettlement) {
		result.state = 'no_observed_event'
	}

	return result
}
