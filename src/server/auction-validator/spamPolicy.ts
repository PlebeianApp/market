import type { ParsedAuctionEvent, ParsedBidEvent } from '../../lib/auction/events'
import type { NostrEvent } from 'nostr-tools'
import type { PendingBufferLimits } from './pendingBuffer'

export interface BidSpamPolicy {
	/**
	 * Master switch for the relay-facing admission layer. `true` (default)
	 * enforces every admission gate and publishes `admission.enabled=true`
	 * in kind-30441. `false` declares and applies **no admission limits**
	 * — the envelope gate, the spam policy and the pending-buffer caps all
	 * pass unconditionally — and publishes `{ enabled: false }` so the
	 * declaration matches the behaviour (review 5242945675 Required 3).
	 * The child-subscription fan-out cap is a validator-resource bound,
	 * not an admission rule, and stays in force either way.
	 */
	admissionEnabled: boolean
	/** Maximum accepted bids from one bidder during the rolling window. */
	maxBidsPerWindow: number
	/** Rolling window length in seconds. */
	rateWindowSec: number
	/** Maximum live per-auction child subscriptions kept open at once. */
	maxTrackedChildSubscriptions: number
	/** Historical replay lookback applied to child subscriptions. */
	childReplayLookbackSec: number
	/**
	 * Bounded lifetime, in seconds, for a child REQ's historical replay.
	 * The REQ is closed on EOSE **or** after this long, whichever fires
	 * first (review 5242945675 Required 2): `@contextvm/sdk` only surfaces
	 * the relay's own EOSE, and this repo documents that a relay may never
	 * reach it (`src/lib/nostr/io.ts`, `observedAtRecovery.ts`). Without
	 * the timeout a never-EOSE relay leaves the replay open for the
	 * process lifetime.
	 */
	childReplayCompletionTimeoutSec: number
	/**
	 * How long past the auction's own settlement window
	 * (`max_end_at + max(max_skew_sec, settlement_grace)`) the validator
	 * keeps observing that auction's children. AUCTIONS.md §8.4 keeps
	 * `settled_late` reachable for a voluntary release published after
	 * `settlement_grace`, so the ingestion window must outlive the window
	 * the verdict layer reasons about; this is the stated arrival bound
	 * (review 5242945675 Required 1). A release observed after it is not
	 * seen at all, and the auction's terminal verdict stands.
	 */
	lateSettlementObservationSec: number
	/** LIFETIME cap per (auction, bidder) — bids are append-only and the
	 *  count includes bids that later became invalid. See subscriber.ts
	 *  (review 5645059400 finding 2). */
	maxTrackedBidsPerAuction: number
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
	admissionEnabled: true,
	maxBidsPerWindow: 20,
	rateWindowSec: 60,
	maxTrackedChildSubscriptions: 512,
	childReplayLookbackSec: 60 * 60 * 24 * 30,
	// 30 s: comfortably inside the default `max_skew_sec` (120 s), so a
	// child delivered live during the replay window can never be pushed
	// past the skew bound by the replay's own duration.
	childReplayCompletionTimeoutSec: 30,
	// 1 h past the settlement window. AUCTIONS.md §8.4 allows a voluntary
	// late release at any point before the bidder refunds, which the
	// protocol does not bound — so the validator declares its own bound.
	lateSettlementObservationSec: 60 * 60,
	maxTrackedBidsPerAuction: 100,
	maxPendingEventsPerKey: 256,
	// Worst case across all three pending buffers combined:
	// maxPendingEvents × maxEventBytes (1024 × 64 KB = 64 MB).
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

export const resolveBidSpamPolicy = (policy?: Partial<BidSpamPolicy>): BidSpamPolicy => ({
	...DEFAULT_BID_SPAM_POLICY,
	...policy,
})

const readNonNegativeIntegerEnv = (env: NodeJS.ProcessEnv, name: string): number | undefined => {
	const raw = env[name]?.trim()
	if (!raw) return undefined
	const parsed = Number.parseInt(raw, 10)
	if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== raw) {
		throw new Error(`${name} must be a non-negative integer, got ${raw}`)
	}
	return parsed
}

/**
 * Boolean reader for the admission master switch. Fails loudly on a
 * malformed value for the same reason the integer reader does: a
 * mistyped security control must not silently fall back to a default.
 */
const readBooleanEnv = (env: NodeJS.ProcessEnv, name: string): boolean | undefined => {
	const raw = env[name]?.trim().toLowerCase()
	if (!raw) return undefined
	if (raw === 'true' || raw === '1') return true
	if (raw === 'false' || raw === '0') return false
	throw new Error(`${name} must be true or false, got ${raw}`)
}

export const readBidSpamPolicyFromEnv = (env: NodeJS.ProcessEnv = process.env): Partial<BidSpamPolicy> => {
	const entries: Array<[keyof BidSpamPolicy, string]> = [
		['childReplayCompletionTimeoutSec', 'AUCTION_VALIDATOR_CHILD_REPLAY_COMPLETION_TIMEOUT_SEC'],
		['lateSettlementObservationSec', 'AUCTION_VALIDATOR_LATE_SETTLEMENT_OBSERVATION_SEC'],
		['maxBidsPerWindow', 'AUCTION_VALIDATOR_MAX_BIDS_PER_WINDOW'],
		['rateWindowSec', 'AUCTION_VALIDATOR_RATE_WINDOW_SEC'],
		['maxTrackedChildSubscriptions', 'AUCTION_VALIDATOR_MAX_TRACKED_CHILD_SUBSCRIPTIONS'],
		['childReplayLookbackSec', 'AUCTION_VALIDATOR_CHILD_REPLAY_LOOKBACK_SEC'],
		['maxTrackedBidsPerAuction', 'AUCTION_VALIDATOR_MAX_TRACKED_BIDS_PER_AUCTION'],
		['maxPendingEventsPerKey', 'AUCTION_VALIDATOR_MAX_PENDING_EVENTS_PER_KEY'],
		['maxPendingKeys', 'AUCTION_VALIDATOR_MAX_PENDING_KEYS'],
		['maxPendingEvents', 'AUCTION_VALIDATOR_MAX_PENDING_EVENTS'],
		['pendingTtlSec', 'AUCTION_VALIDATOR_PENDING_TTL_SEC'],
		['maxSeenEventIds', 'AUCTION_VALIDATOR_MAX_SEEN_EVENT_IDS'],
		['maxEventBytes', 'AUCTION_VALIDATOR_MAX_EVENT_BYTES'],
		['maxTagCount', 'AUCTION_VALIDATOR_MAX_TAG_COUNT'],
		['maxNonceLength', 'AUCTION_VALIDATOR_MAX_NONCE_LENGTH'],
		['maxProofCount', 'AUCTION_VALIDATOR_MAX_PROOF_COUNT'],
		['maxContentBytes', 'AUCTION_VALIDATOR_MAX_CONTENT_BYTES'],
	]

	const policy: Partial<BidSpamPolicy> = {}
	const admissionEnabled = readBooleanEnv(env, 'AUCTION_VALIDATOR_ADMISSION_ENABLED')
	if (admissionEnabled !== undefined) policy.admissionEnabled = admissionEnabled
	const legacyTrackedBidCap = readNonNegativeIntegerEnv(env, 'AUCTION_VALIDATOR_MAX_ACTIVE_BIDS_PER_AUCTION')
	if (legacyTrackedBidCap !== undefined) policy.maxTrackedBidsPerAuction = legacyTrackedBidCap
	for (const [field, envName] of entries) {
		const value = readNonNegativeIntegerEnv(env, envName)
		if (value !== undefined) policy[field] = value as never
	}
	return policy
}

/**
 * Project the operator policy onto the bounds enforced by
 * {@link createPendingBuffer}. Kept here so every pending buffer in the
 * subscriber is bounded by the same resolved policy.
 */
export const resolvePendingBufferLimits = (policy?: Partial<BidSpamPolicy>): PendingBufferLimits => {
	const resolved = resolveBidSpamPolicy(policy)
	// Admission off means admission off: a declaration of "no limits"
	// that still enforced buffer caps would be a published lie
	// (review 5242945675 Required 3). Operators who disable admission
	// accept unbounded buffering; index.ts logs it at startup.
	if (!resolved.admissionEnabled) {
		return {
			maxPendingKeys: Number.MAX_SAFE_INTEGER,
			maxPendingEventsPerKey: Number.MAX_SAFE_INTEGER,
			maxPendingEvents: Number.MAX_SAFE_INTEGER,
			pendingTtlSec: Number.MAX_SAFE_INTEGER,
		}
	}
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
				| 'too_many_tracked_bids'
				| 'invalid_bid_nonce'
				| 'too_many_lock_secrets'
				| 'bid_payload_too_large'
			detail: string
	  }

export type EventEnvelopeDecision = { ok: true } | { ok: false; reason: 'event_too_large' | 'too_many_tags'; detail: string }

/**
 * Size/shape gate for a relay-fed event. Kind-agnostic on purpose: all
 * four auction ingestion paths (30408, 1023, 1024, 1025) are
 * attacker-fed and feed the same state, so the same envelope applies to
 * each (review 5645059400 finding 3). Parsing is what is kind-specific.
 */
export const checkEventEnvelope = (event: NostrEvent, policy?: Partial<BidSpamPolicy>): EventEnvelopeDecision => {
	const resolved = resolveBidSpamPolicy(policy)
	if (!resolved.admissionEnabled) return { ok: true }
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

const bidderKey = (bidderPubkey: string): string => bidderPubkey.toLowerCase()

const nonceKey = (auctionRootEventId: string, bidderPubkey: string, bidNonce: string): string =>
	`${bidderAuctionKey(auctionRootEventId, bidderPubkey)}:${bidNonce}`

const pruneTimes = (times: number[], now: number, windowSec: number): number[] => times.filter((timestamp) => timestamp > now - windowSec)

export const checkBidSpamPolicy = (input: {
	auction: ParsedAuctionEvent
	bid: ParsedBidEvent
	now: number
	state: BidSpamState
	policy?: Partial<BidSpamPolicy>
	trackedBidCount: number
}): BidSpamDecision => {
	const policy = resolveBidSpamPolicy(input.policy)
	// Declared-off admission passes everything. Resolved here rather
	// than at the call sites so no ingestion path can forget it.
	if (!policy.admissionEnabled) return { ok: true }
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

	if (input.trackedBidCount >= policy.maxTrackedBidsPerAuction) {
		return {
			ok: false,
			reason: 'too_many_tracked_bids',
			detail: `bidder has reached max_tracked_bids_per_auction=${policy.maxTrackedBidsPerAuction}`,
		}
	}

	const key = bidderKey(input.bid.bidderPubkey)
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
	const policy = resolveBidSpamPolicy(input.policy)
	const eventId = input.bid.id.toLowerCase()
	const bidRateKey = bidderKey(input.bid.bidderPubkey)
	const nonce = nonceKey(input.auction.rootEventId, input.bid.bidderPubkey, input.bid.bidNonce)
	const recent = pruneTimes(input.state.bidderBidTimes.get(bidRateKey) ?? [], input.now, policy.rateWindowSec)

	// `seenEventIds` is a freshness window for deduplication, not a
	// recency cache: the oldest-inserted id is the one whose replay
	// window has aged out, so FIFO eviction is the correct policy there.
	while (input.state.seenEventIds.size >= policy.maxSeenEventIds) {
		const oldest = input.state.seenEventIds.values().next().value
		if (oldest === undefined) break
		input.state.seenEventIds.delete(oldest)
	}
	input.state.seenEventIds.add(eventId)
	// The other two maps are LRU, not FIFO (review 5242945675,
	// non-blocking): `Map.set` on an existing key does not move it, so
	// oldest-inserted eviction would drop an ACTIVE bidder's rate history
	// first and reset the documented 20-per-60 s window once the map
	// filled. Re-inserting on write makes the retained entries the most
	// recently active ones.
	touchLru(input.state.nonceOwners, nonce, eventId, policy.maxSeenEventIds)
	touchLru(input.state.bidderBidTimes, bidRateKey, [...recent, input.now], policy.maxSeenEventIds)
}

/**
 * Insert `key`, treating it as the most recently used entry. The existing
 * entry (if any) is removed first so re-touching an active key neither
 * counts against the cap nor evicts the key being written, then the map is
 * trimmed to `cap` from the oldest end.
 */
const touchLru = <T>(map: Map<string, T>, key: string, value: T, cap: number): void => {
	map.delete(key)
	while (map.size >= cap) {
		const oldest = map.keys().next().value
		if (oldest === undefined) break
		map.delete(oldest)
	}
	map.set(key, value)
}
