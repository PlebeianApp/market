import type { ParsedAuctionEvent, ParsedBidEvent } from '../../lib/auction/events'
import type { NostrEvent } from 'nostr-tools'
import type { PendingBufferLimits } from './pendingBuffer'

export interface BidSpamPolicy {
	/** Maximum accepted bids from one bidder during the rolling window. */
	maxBidsPerWindow: number
	/** Rolling window length in seconds. */
	rateWindowSec: number
	/** Maximum tracked bids from one bidder in one auction. */
	maxActiveBidsPerAuction: number
	/**
	 * Maximum number of events retained per key in a pending buffer —
	 * bids per unknown auction, path releases per unknown bid,
	 * settlements per unknown auction.
	 */
	maxPendingEventsPerKey: number
	/**
	 * Maximum number of distinct keys retained by each pending buffer.
	 * Buffered keys are attacker-chosen ids (review 5645059400 finding
	 * 1), so a per-key cap alone would let an attacker mint a fresh
	 * budget per invented id.
	 */
	maxPendingKeys: number
	/** Maximum number of buffered events retained across each pending buffer. */
	maxPendingEvents: number
	/**
	 * Seconds after which a pending key that never resolved is evicted.
	 * Measured from first sight of the key so a trickle of events
	 * cannot pin it forever.
	 */
	pendingTtlSec: number
	/** Maximum number of event ids retained for cross-relay deduplication. */
	maxSeenEventIds: number
	/** Maximum serialized raw event size accepted by the auction path. */
	maxEventBytes: number
	/** Maximum number of tags accepted by the auction path. */
	maxTagCount: number
	/** Maximum bid nonce length. */
	maxNonceLength: number
	/** Maximum number of proof metadata pairs in a bid. */
	maxProofCount: number
	/** Maximum raw content length in a bid. */
	maxContentBytes: number
}

export const DEFAULT_BID_SPAM_POLICY: Readonly<BidSpamPolicy> = {
	maxBidsPerWindow: 20,
	rateWindowSec: 60,
	maxActiveBidsPerAuction: 100,
	maxPendingEventsPerKey: 256,
	// Worst case per buffer: maxPendingEvents × maxEventBytes
	// (1024 × 64 KB = 64 MB) and in practice ~1 MB, since buffering only
	// happens in the ordering gap between an event and its parent.
	maxPendingKeys: 512,
	maxPendingEvents: 1_024,
	// Two hours: far longer than any relay ordering gap that can still
	// produce a usable verdict, and long enough that an auction event
	// arriving after its bids is never dropped for age.
	pendingTtlSec: 7_200,
	maxSeenEventIds: 10_000,
	maxEventBytes: 64 * 1024,
	maxTagCount: 128,
	maxNonceLength: 256,
	maxProofCount: 64,
	maxContentBytes: 16 * 1024,
}

/**
 * Project the operator policy onto the bounds enforced by
 * {@link createPendingBuffer}. Kept here so every pending buffer in the
 * subscriber is bounded by the same resolved policy.
 */
export const resolvePendingBufferLimits = (policy?: Partial<BidSpamPolicy>): PendingBufferLimits => {
	const resolved = { ...DEFAULT_BID_SPAM_POLICY, ...policy }
	return {
		maxPendingKeys: resolved.maxPendingKeys,
		maxPendingEventsPerKey: resolved.maxPendingEventsPerKey,
		maxPendingEvents: resolved.maxPendingEvents,
		pendingTtlSec: resolved.pendingTtlSec,
	}
}

export interface BidSpamState {
	seenEventIds: Set<string>
	nonceOwners: Map<string, string>
	bidderBidTimes: Map<string, number[]>
}

export const createBidSpamState = (): BidSpamState => ({
	seenEventIds: new Set(),
	nonceOwners: new Map(),
	bidderBidTimes: new Map(),
})

export type BidSpamDecision =
	| { ok: true }
	| {
			ok: false
			reason:
				| 'duplicate_event'
				| 'duplicate_bid_nonce'
				| 'rate_limited'
				| 'too_many_active_bids'
				| 'invalid_bid_nonce'
				| 'too_many_lock_secrets'
				| 'bid_payload_too_large'
			detail: string
	  }

export type BidEnvelopeDecision = { ok: true } | { ok: false; reason: 'event_too_large' | 'too_many_tags'; detail: string }

export const checkBidEnvelope = (event: NostrEvent, policy?: Partial<BidSpamPolicy>): BidEnvelopeDecision => {
	const resolved = { ...DEFAULT_BID_SPAM_POLICY, ...policy }
	const eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
	if (eventBytes > resolved.maxEventBytes) {
		return { ok: false, reason: 'event_too_large', detail: `event size ${eventBytes} exceeds max_event_bytes=${resolved.maxEventBytes}` }
	}
	if (event.tags.length > resolved.maxTagCount) {
		return { ok: false, reason: 'too_many_tags', detail: `tag count exceeds max_tag_count=${resolved.maxTagCount}` }
	}
	return { ok: true }
}

const bidderAuctionKey = (auctionRootEventId: string, bidderPubkey: string): string =>
	`${auctionRootEventId.toLowerCase()}:${bidderPubkey.toLowerCase()}`

const nonceKey = (auctionRootEventId: string, bidderPubkey: string, bidNonce: string): string =>
	`${bidderAuctionKey(auctionRootEventId, bidderPubkey)}:${bidNonce}`

const pruneTimes = (times: number[], now: number, windowSec: number): number[] => times.filter((timestamp) => timestamp > now - windowSec)

export const checkBidSpamPolicy = (input: {
	auction: ParsedAuctionEvent
	bid: ParsedBidEvent
	now: number
	state: BidSpamState
	policy?: Partial<BidSpamPolicy>
	activeBidCount: number
}): BidSpamDecision => {
	const policy = { ...DEFAULT_BID_SPAM_POLICY, ...input.policy }
	const eventId = input.bid.id.toLowerCase()
	if (input.bid.bidNonce.length > policy.maxNonceLength) {
		return { ok: false, reason: 'invalid_bid_nonce', detail: `bid_nonce exceeds max_nonce_length=${policy.maxNonceLength}` }
	}
	if (input.bid.lockSecrets.length > policy.maxProofCount || input.bid.proofYs.length > policy.maxProofCount) {
		return { ok: false, reason: 'too_many_lock_secrets', detail: `proof metadata exceeds max_proof_count=${policy.maxProofCount}` }
	}
	if (Buffer.byteLength(input.bid.rawEvent.content, 'utf8') > policy.maxContentBytes) {
		return { ok: false, reason: 'bid_payload_too_large', detail: `bid content exceeds max_content_bytes=${policy.maxContentBytes}` }
	}
	if (input.state.seenEventIds.has(eventId)) {
		return { ok: false, reason: 'duplicate_event', detail: `bid event ${input.bid.id} was already observed` }
	}

	const nonceOwner = input.state.nonceOwners.get(nonceKey(input.auction.rootEventId, input.bid.bidderPubkey, input.bid.bidNonce))
	if (nonceOwner !== undefined && nonceOwner !== eventId) {
		return { ok: false, reason: 'duplicate_bid_nonce', detail: `bid_nonce ${input.bid.bidNonce} is already bound to another event` }
	}

	if (input.activeBidCount >= policy.maxActiveBidsPerAuction) {
		return {
			ok: false,
			reason: 'too_many_active_bids',
			detail: `bidder has reached max_active_bids_per_auction=${policy.maxActiveBidsPerAuction}`,
		}
	}

	const key = bidderAuctionKey(input.auction.rootEventId, input.bid.bidderPubkey)
	const recent = pruneTimes(input.state.bidderBidTimes.get(key) ?? [], input.now, policy.rateWindowSec)
	if (recent.length >= policy.maxBidsPerWindow) {
		return {
			ok: false,
			reason: 'rate_limited',
			detail: `bidder exceeded max_bids_per_window=${policy.maxBidsPerWindow} in ${policy.rateWindowSec}s`,
		}
	}

	return { ok: true }
}

export const recordAcceptedBid = (input: {
	auction: ParsedAuctionEvent
	bid: ParsedBidEvent
	now: number
	state: BidSpamState
	policy?: Partial<BidSpamPolicy>
}): void => {
	const policy = { ...DEFAULT_BID_SPAM_POLICY, ...input.policy }
	const eventId = input.bid.id.toLowerCase()
	const bidderKey = bidderAuctionKey(input.auction.rootEventId, input.bid.bidderPubkey)
	const nonce = nonceKey(input.auction.rootEventId, input.bid.bidderPubkey, input.bid.bidNonce)
	const recent = pruneTimes(input.state.bidderBidTimes.get(bidderKey) ?? [], input.now, policy.rateWindowSec)

	while (input.state.seenEventIds.size >= policy.maxSeenEventIds) {
		const oldest = input.state.seenEventIds.values().next().value
		if (oldest === undefined) break
		input.state.seenEventIds.delete(oldest)
	}
	input.state.seenEventIds.add(eventId)
	while (input.state.nonceOwners.size >= policy.maxSeenEventIds) {
		const oldest = input.state.nonceOwners.keys().next().value
		if (oldest === undefined) break
		input.state.nonceOwners.delete(oldest)
	}
	while (input.state.bidderBidTimes.size >= policy.maxSeenEventIds) {
		const oldest = input.state.bidderBidTimes.keys().next().value
		if (oldest === undefined) break
		input.state.bidderBidTimes.delete(oldest)
	}
	input.state.nonceOwners.set(nonce, eventId)
	input.state.bidderBidTimes.set(bidderKey, [...recent, input.now])
}
