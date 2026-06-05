/**
 * Tag-array builders for every kind in the bidder-held-path auction
 * protocol. Centralised so call sites (bidder client, seller client,
 * validator service) don't hand-roll tag arrays.
 *
 * Every builder returns a plain `string[][]` ready to drop onto an
 * `NDKEvent.tags` field. Optional fields are intentionally omitted
 * when undefined — Nostr indexers treat repeated/empty tags as live
 * tags, so we never emit `["foo", ""]`.
 *
 * The corresponding parse layer lives in
 * `src/lib/schemas/auction/*.ts` (Zod schemas converting raw events
 * back into the {@link "@/lib/auction/events"} parsed types).
 */

import {
	AUCTION_CURRENCY_SAT,
	AUCTION_KEY_SCHEME,
	AUCTION_SCHEMA_TAG,
	AUCTION_SETTLEMENT_POLICY,
	AUCTION_TYPE_ENGLISH,
	DEFAULT_AUDITOR_QUORUM,
	DEFAULT_MAX_SKEW_SECONDS,
	VALIDATOR_POLICY_SCHEMA_TYPE,
	VALIDATOR_POLICY_D_PREFIX,
	BIDDER_AGGREGATE_SCHEMA_TYPE,
	type AuctionSettlementStatus,
	type PathReleaseReason,
	type ValidatorClaim,
} from './constants'
import type { AuctionFallbackChainEntry, MinBidCurve, ValidatorPolicyDocument, BidderAggregateReputationDocument } from './events'
import type { Nut7ProofState } from './constants'

// =========================================================================
// kind 30408 — Auction event tags
// =========================================================================

export interface AuctionEventTagsInput {
	dTag: string
	title: string
	startAt: number
	endAt: number
	maxEndAt: number
	settlementGrace: number
	reserve: number
	startingBid?: number
	bidIncrement: number
	mints: string[]
	p2pkXpub: string
	auditors: string[]
	auditorQuorum?: number
	maxSkewSec?: number
	fallbackDelaySec?: number
	minBidCurve?: MinBidCurve
	// product-shaped optionals
	summary?: string
	images?: Array<{ url: string; dimensions?: string; order?: number }>
	specs?: Array<{ key: string; value: string }>
	categories?: string[]
	locationGeohash?: string
	shippingOptions?: Array<{ coordinate: string; sats: number }>
	// bookkeeping
	vadiumRatioBps?: number
}

export const buildAuctionEventTags = (input: AuctionEventTagsInput): string[][] => {
	if (!input.dTag) throw new Error('buildAuctionEventTags: dTag required')
	if (!input.title) throw new Error('buildAuctionEventTags: title required')
	if (!input.mints.length) throw new Error('buildAuctionEventTags: at least one mint required')
	if (!input.auditors.length) throw new Error('buildAuctionEventTags: at least one auditor required')
	if (!input.p2pkXpub) throw new Error('buildAuctionEventTags: p2pk_xpub required')

	const tags: string[][] = [
		['d', input.dTag],
		['title', input.title],
		['auction_type', AUCTION_TYPE_ENGLISH],
		['start_at', String(input.startAt)],
		['end_at', String(input.endAt)],
		['max_end_at', String(input.maxEndAt)],
		['settlement_grace', String(input.settlementGrace)],
		['currency', AUCTION_CURRENCY_SAT],
		['reserve', String(input.reserve)],
		['bid_increment', String(input.bidIncrement)],
		['settlement_policy', AUCTION_SETTLEMENT_POLICY],
		['key_scheme', AUCTION_KEY_SCHEME],
		['p2pk_xpub', input.p2pkXpub],
		['schema', AUCTION_SCHEMA_TAG],
	]

	if (input.startingBid !== undefined) tags.push(['starting_bid', String(input.startingBid)])

	for (const mint of input.mints) tags.push(['mint', mint])
	for (const auditor of input.auditors) tags.push(['auditors', auditor])

	const quorum = input.auditorQuorum ?? DEFAULT_AUDITOR_QUORUM
	tags.push(['auditor_quorum', String(quorum)])

	const skew = input.maxSkewSec ?? DEFAULT_MAX_SKEW_SECONDS
	tags.push(['max_skew_sec', String(skew)])

	if (input.fallbackDelaySec !== undefined) tags.push(['fallback_delay_sec', String(input.fallbackDelaySec)])

	if (input.minBidCurve && input.minBidCurve.shape !== 'none') {
		tags.push(['min_bid_curve', `${input.minBidCurve.shape}:${input.minBidCurve.peakMultiplier}`])
	}

	if (input.vadiumRatioBps !== undefined) tags.push(['vadium_ratio_bps', String(input.vadiumRatioBps)])
	if (input.summary) tags.push(['summary', input.summary])

	for (const image of input.images ?? []) {
		const tag = ['image', image.url]
		if (image.dimensions) tag.push(image.dimensions)
		if (image.order !== undefined) tag.push(String(image.order))
		tags.push(tag)
	}
	for (const spec of input.specs ?? []) tags.push(['spec', spec.key, spec.value])
	for (const category of input.categories ?? []) tags.push(['t', category])
	if (input.locationGeohash) tags.push(['g', input.locationGeohash])
	for (const option of input.shippingOptions ?? []) {
		tags.push(['shipping_option', option.coordinate, String(option.sats)])
	}

	return tags
}

// =========================================================================
// kind 1023 — Bid event tags
// =========================================================================

export interface BidEventTagsInput {
	auctionRootEventId: string
	auctionCoordinate: string
	sellerPubkey: string
	amount: number
	mint: string
	locktime: number
	refundPubkey: string
	childPubkey: string
	lockSecret: string
	proofY: string
	createdForEndAt: number
	bidNonce: string
	prevBidId?: string
	note?: string
}

export const buildBidEventTags = (input: BidEventTagsInput): string[][] => {
	if (!input.auctionRootEventId) throw new Error('buildBidEventTags: auctionRootEventId required')
	if (!input.auctionCoordinate) throw new Error('buildBidEventTags: auctionCoordinate required')
	if (!input.sellerPubkey) throw new Error('buildBidEventTags: sellerPubkey required')
	if (!input.lockSecret) throw new Error('buildBidEventTags: lockSecret required')
	if (!input.proofY) throw new Error('buildBidEventTags: proofY required')
	if (!input.childPubkey) throw new Error('buildBidEventTags: childPubkey required')

	const tags: string[][] = [
		['e', input.auctionRootEventId],
		['a', input.auctionCoordinate],
		['p', input.sellerPubkey],
		['amount', String(input.amount)],
		['currency', AUCTION_CURRENCY_SAT],
		['mint', input.mint],
		['locktime', String(input.locktime)],
		['refund_pubkey', input.refundPubkey],
		['child_pubkey', input.childPubkey],
		['lock_secret', input.lockSecret],
		['proof_y', input.proofY],
		['created_for_end_at', String(input.createdForEndAt)],
		['bid_nonce', input.bidNonce],
		['key_scheme', AUCTION_KEY_SCHEME],
		['status', 'locked'],
	]

	if (input.prevBidId) tags.push(['prev_bid', input.prevBidId])
	if (input.note) tags.push(['note', input.note])
	return tags
}

// =========================================================================
// kind 1025 — Path release tags
// =========================================================================

export interface PathReleaseTagsInput {
	bidEventId: string
	auctionCoordinate: string
	sellerPubkey: string
	derivationPath: string
	childPubkey: string
	releaseReason: PathReleaseReason
	auditorRefs?: string[]
	fallbackOfferId?: string
}

export const buildPathReleaseTags = (input: PathReleaseTagsInput): string[][] => {
	if (!input.bidEventId) throw new Error('buildPathReleaseTags: bidEventId required')
	if (!input.derivationPath) throw new Error('buildPathReleaseTags: derivationPath required')
	if (!input.childPubkey) throw new Error('buildPathReleaseTags: childPubkey required')

	const tags: string[][] = [
		['e', input.bidEventId],
		['a', input.auctionCoordinate],
		['p', input.sellerPubkey],
		['derivation_path', input.derivationPath],
		['child_pubkey', input.childPubkey],
		['release_reason', input.releaseReason],
	]

	for (const ref of input.auditorRefs ?? []) tags.push(['auditor_ref', ref])
	if (input.fallbackOfferId) tags.push(['fallback_offer', input.fallbackOfferId])

	return tags
}

// =========================================================================
// kind 1024 — Settlement tags
// =========================================================================

export interface SettlementTagsInput {
	auctionRootEventId: string
	auctionCoordinate: string
	status: AuctionSettlementStatus
	closeAt: number
	finalAmount: number
	winningBidId?: string
	winnerPubkey?: string
	pathReleaseEventId?: string
	fallbackChain?: AuctionFallbackChainEntry[]
	reason?: string
	payouts?: Array<{ bidEventId: string; amount: number; status: string }>
}

export const buildSettlementTags = (input: SettlementTagsInput): string[][] => {
	const tags: string[][] = [
		['e', input.auctionRootEventId],
		['a', input.auctionCoordinate],
		['status', input.status],
		['close_at', String(input.closeAt)],
		['final_amount', String(input.finalAmount)],
	]
	if (input.winningBidId) tags.push(['winning_bid', input.winningBidId])
	if (input.winnerPubkey) tags.push(['winner', input.winnerPubkey])
	if (input.pathReleaseEventId) tags.push(['path_release', input.pathReleaseEventId])
	for (const entry of input.fallbackChain ?? []) {
		tags.push(['fallback_chain', entry.bidEventId, entry.status])
	}
	for (const payout of input.payouts ?? []) {
		tags.push(['payout', payout.bidEventId, String(payout.amount), payout.status])
	}
	if (input.reason) tags.push(['reason', input.reason])
	return tags
}

// =========================================================================
// kind 1026 — Fallback offer tags
// =========================================================================

export interface FallbackOfferTagsInput {
	auctionCoordinate: string
	bidEventId: string
	offeredToPubkey: string
	deadline: number
}

export const buildFallbackOfferTags = (input: FallbackOfferTagsInput): string[][] => {
	return [
		['a', input.auctionCoordinate],
		['e', input.bidEventId],
		['p', input.offeredToPubkey],
		['deadline', String(input.deadline)],
	]
}

// =========================================================================
// kind 30440 — Validator verdict tags
// =========================================================================

export interface ValidatorVerdictTagsInput {
	bidderPubkey: string
	auctionRootEventId: string
	auctionCoordinate: string
	bidEventId: string
	claim: ValidatorClaim
	observedAt: number
	reason?: string
	nut7State?: Nut7ProofState
	nut7ObservedAt?: number
}

export const buildValidatorVerdictTags = (input: ValidatorVerdictTagsInput): string[][] => {
	const dTag = `${input.bidderPubkey}:${input.auctionRootEventId}`
	const tags: string[][] = [
		['d', dTag],
		['p', input.bidderPubkey],
		['a', input.auctionCoordinate],
		['e', input.auctionRootEventId],
		['bid', input.bidEventId],
		['claim', input.claim],
		['observed_at', String(input.observedAt)],
	]
	if (input.reason) tags.push(['reason', input.reason])
	if (input.nut7State) tags.push(['nut7_state', input.nut7State])
	if (input.nut7ObservedAt !== undefined) tags.push(['nut7_observed_at', String(input.nut7ObservedAt)])
	return tags
}

// =========================================================================
// kind 30441 — Validator policy declaration
// =========================================================================

export interface ValidatorPolicyTagsInput {
	name: string
	scope?: string
}

export const buildValidatorPolicyTags = (input: ValidatorPolicyTagsInput): string[][] => {
	const dTag = input.scope ? `${VALIDATOR_POLICY_D_PREFIX}:${input.scope}` : `${VALIDATOR_POLICY_D_PREFIX}:v1`
	return [
		['d', dTag],
		['name', input.name],
	]
}

export const buildValidatorPolicyContent = (policy: Partial<ValidatorPolicyDocument>): string => {
	return JSON.stringify({ type: VALIDATOR_POLICY_SCHEMA_TYPE, ...policy })
}

// =========================================================================
// kind 30442 — Bidder aggregate reputation
// =========================================================================

export const buildBidderAggregateTags = (bidderPubkey: string): string[][] => {
	return [
		['d', bidderPubkey],
		['p', bidderPubkey],
	]
}

export const buildBidderAggregateContent = (doc: Omit<BidderAggregateReputationDocument, 'type'>): string => {
	return JSON.stringify({ type: BIDDER_AGGREGATE_SCHEMA_TYPE, ...doc })
}
