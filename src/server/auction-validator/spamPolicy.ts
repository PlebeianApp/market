import type { ParsedAuctionEvent, ParsedBidEvent } from '../../lib/auction/events'
import type { NostrEvent } from 'nostr-tools'
import type { PendingBufferLimits } from './pendingBuffer'

export interface BidSpamPolicy {
	/** Maximum accepted bids from one bidder during the rolling window. */
	maxBidsPerWindow: number
	/** Rolling window length in seconds. */
	rateWindowSec: number
	/** Maximum tracked bids from one bidder in one auction. */
	/** LIFETIME cap per (auction, bidder) — bids are append-only and the
	 *  count includes bids that later became invalid. See subscriber.ts
	 *  (review 5645059400 finding 2). */
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
 * Environment prefix for operator-supplied admission limits, plus a
 * whole-policy JSON override. Before this existed the limits were
 * declared as deps (`spamPolicy`) that no production call site ever
 * supplied, so the effective policy was always an un-configurable
 * hard-coded default (review 5645059400 required change 3).
 *
 * One variable per field: `AUCTION_VALIDATOR_<FIELD_IN_SNAKE_CASE>`,
 * e.g. `AUCTION_VALIDATOR_MAX_PENDING_KEYS=64`.
 */
export const BID_SPAM_POLICY_ENV_PREFIX = 'AUCTION_VALIDATOR_'

/** Whole-policy JSON override, e.g. `AUCTION_VALIDATOR_SPAM_POLICY={"maxPendingKeys":64}`. */
export const BID_SPAM_POLICY_ENV_JSON = `${BID_SPAM_POLICY_ENV_PREFIX}SPAM_POLICY`

/**
 * Per-field environment variable name and accepted range. Every bound
 * is `[1, max]`: an admission limit of 0 (or NaN, or Infinity) would
 * either disable the gate entirely or mean "unbounded", which is
 * exactly the failure mode this validation exists to prevent.
 */
const BID_SPAM_POLICY_ENV_FIELDS: Record<keyof BidSpamPolicy, { env: string; max: number }> = {
	maxBidsPerWindow: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_BIDS_PER_WINDOW`, max: 10_000 },
	rateWindowSec: { env: `${BID_SPAM_POLICY_ENV_PREFIX}RATE_WINDOW_SEC`, max: 86_400 },
	maxActiveBidsPerAuction: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_ACTIVE_BIDS_PER_AUCTION`, max: 100_000 },
	maxPendingEventsPerKey: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_PENDING_EVENTS_PER_KEY`, max: 10_000 },
	maxPendingKeys: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_PENDING_KEYS`, max: 10_000 },
	maxPendingEvents: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_PENDING_EVENTS`, max: 100_000 },
	pendingTtlSec: { env: `${BID_SPAM_POLICY_ENV_PREFIX}PENDING_TTL_SEC`, max: 604_800 },
	maxSeenEventIds: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_SEEN_EVENT_IDS`, max: 1_000_000 },
	maxEventBytes: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_EVENT_BYTES`, max: 4 * 1024 * 1024 },
	maxTagCount: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_TAG_COUNT`, max: 1_024 },
	maxNonceLength: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_NONCE_LENGTH`, max: 4_096 },
	maxProofCount: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_PROOF_COUNT`, max: 1_024 },
	maxContentBytes: { env: `${BID_SPAM_POLICY_ENV_PREFIX}MAX_CONTENT_BYTES`, max: 1024 * 1024 },
}

const BID_SPAM_POLICY_FIELDS = Object.keys(DEFAULT_BID_SPAM_POLICY) as Array<keyof BidSpamPolicy>

export interface BidSpamPolicyLogger {
	warn: (...args: unknown[]) => void
}

/**
 * Parse a raw env string as a non-negative integer literal. Anything
 * that is not a plain run of digits (`"abc"`, `"-1"`, `"0x10"`,
 * `"1.5"`, `""`, `"Infinity"`) is rejected so it falls back rather
 * than reaching the buffer as NaN.
 */
const parsePolicyEnvNumber = (raw: string): number | undefined => {
	const trimmed = raw.trim()
	if (!/^\d+$/.test(trimmed)) return undefined
	const value = Number(trimmed)
	return Number.isSafeInteger(value) ? value : undefined
}

/**
 * Resolve the effective admission policy from, in descending priority:
 * explicit options, individual `AUCTION_VALIDATOR_*` env vars, the
 * `AUCTION_VALIDATOR_SPAM_POLICY` JSON blob, then
 * {@link DEFAULT_BID_SPAM_POLICY}.
 *
 * Invalid values (non-numeric, non-integer, non-finite, out of
 * `[1, field max]`) are never applied: the default is kept and a
 * warning naming the offending variable is logged, so a typo cannot
 * silently widen — or zero — a bound. Returns the fully resolved
 * policy so callers can log and expose exactly what is in force.
 */
export const resolveBidSpamPolicyFromEnv = (
	explicit?: Partial<BidSpamPolicy>,
	env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
	logger: BidSpamPolicyLogger = console,
): BidSpamPolicy => {
	const resolved: BidSpamPolicy = { ...DEFAULT_BID_SPAM_POLICY }
	const numbers = resolved as unknown as Record<string, number>

	const apply = (field: keyof BidSpamPolicy, value: unknown, source: string): void => {
		const { max } = BID_SPAM_POLICY_ENV_FIELDS[field]
		if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > max) {
			logger.warn(
				`[validator] ignoring invalid admission limit ${field}=${String(value)} from ${source}; keeping ${DEFAULT_BID_SPAM_POLICY[field]}`,
			)
			return
		}
		numbers[field] = value
	}

	// Whole-policy JSON blob first, so individual vars below win over it.
	const blob = env[BID_SPAM_POLICY_ENV_JSON]
	if (blob !== undefined && blob.trim() !== '') {
		try {
			const parsed: unknown = JSON.parse(blob)
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('expected a JSON object')
			const record = parsed as Record<string, unknown>
			for (const field of BID_SPAM_POLICY_FIELDS) {
				if (record[field] !== undefined) apply(field, record[field], BID_SPAM_POLICY_ENV_JSON)
			}
		} catch (err) {
			logger.warn(`[validator] ignoring malformed ${BID_SPAM_POLICY_ENV_JSON}:`, err instanceof Error ? err.message : err)
		}
	}

	for (const field of BID_SPAM_POLICY_FIELDS) {
		const { env: envName } = BID_SPAM_POLICY_ENV_FIELDS[field]
		const raw = env[envName]
		if (raw === undefined) continue
		const value = parsePolicyEnvNumber(raw)
		if (value === undefined) {
			logger.warn(`[validator] ignoring non-numeric ${envName}=${JSON.stringify(raw)}; keeping ${DEFAULT_BID_SPAM_POLICY[field]}`)
			continue
		}
		apply(field, value, envName)
	}

	for (const field of BID_SPAM_POLICY_FIELDS) {
		const value = explicit?.[field]
		if (value !== undefined) apply(field, value, 'options.spamPolicy')
	}

	return resolved
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

export type EventEnvelopeDecision = { ok: true } | { ok: false; reason: 'event_too_large' | 'too_many_tags'; detail: string }

/**
 * Size/shape gate for a relay-fed event. Kind-agnostic on purpose: all
 * four auction ingestion paths (30408, 1023, 1024, 1025) are
 * attacker-fed and feed the same state, so the same envelope applies to
 * each (review 5645059400 finding 3). Parsing is what is kind-specific.
 */
export const checkEventEnvelope = (event: NostrEvent, policy?: Partial<BidSpamPolicy>): EventEnvelopeDecision => {
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
