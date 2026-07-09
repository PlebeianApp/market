/**
 * Zod schema + parser for kind-30408 auction listing events under
 * `cashu_p2pk_bidder_path_v1`. See AUCTIONS.md §4.1.
 *
 * Two layers:
 *
 * 1. {@link AuctionEventSchema} — a Zod object validating the
 *    extracted-tag intermediate form. Useful when you already have
 *    a structured intermediate (e.g. when you're constructing rather
 *    than parsing).
 *
 * 2. {@link parseAuctionEvent} — takes a raw `NDKEvent`, runs the tag
 *    extraction, and returns a `ParsedAuctionEvent` or a structured
 *    Zod error. This is what callers will use 99% of the time.
 *
 * The parser is intentionally tolerant of the optional / display tags
 * (summary, images, specs, etc.) — they don't affect protocol safety
 * and a stale/legacy event with unusual auxiliary data should still
 * be readable. It is strict on the safety-critical tags (lock policy,
 * key scheme, auditors, timing invariants).
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { z } from 'zod'
import {
	AUCTION_KEY_SCHEME,
	AUCTION_KIND,
	AUCTION_SETTLEMENT_POLICY,
	AUCTION_TYPE_ENGLISH,
	DEFAULT_AUDITOR_QUORUM,
	DEFAULT_MAX_SKEW_SECONDS,
	FALLBACK_DELAY_DENOMINATOR,
	FALLBACK_DELAY_NUMERATOR,
} from '../../auction/constants'
import type { MinBidCurve, MinBidCurveShape, ParsedAuctionEvent } from '../../auction/events'
import { addressableCoordinate, nostrEventIdHex, nostrPubkeyHex, nonNegativeInt, positiveInt, unixSeconds } from './common'
import { readIntegerTag, readMultiTag, readSingleTag } from './tagAccess'

// ----------------------------------------------------------------------------
// Min-bid-curve parser — extracted for testability
// ----------------------------------------------------------------------------

const MIN_BID_CURVE_MIN_PEAK = 1
const MIN_BID_CURVE_MAX_PEAK = 100

const parseMinBidCurve = (raw: string | undefined): MinBidCurve => {
	if (!raw) return { shape: 'none', peakMultiplier: 1, raw: '' }
	const [shape, peakRaw] = raw.split(':')
	const shapeNarrowed: MinBidCurveShape = shape === 'linear' || shape === 'exponential' ? shape : 'none'
	if (shapeNarrowed === 'none') return { shape: 'none', peakMultiplier: 1, raw }
	const peakParsed = Number.parseFloat(peakRaw ?? '')
	const peak = !Number.isFinite(peakParsed)
		? MIN_BID_CURVE_MIN_PEAK
		: Math.min(MIN_BID_CURVE_MAX_PEAK, Math.max(MIN_BID_CURVE_MIN_PEAK, peakParsed))
	return { shape: shapeNarrowed, peakMultiplier: peak, raw }
}

// ----------------------------------------------------------------------------
// Intermediate Zod schema
// ----------------------------------------------------------------------------

/**
 * Structured intermediate the parser produces from `event.tags` before
 * handing off to Zod. Exposing it as a schema lets tests build fixtures
 * by hand and lets future code (e.g. wallet form validators) reuse the
 * same shape constraints without constructing a full NDKEvent.
 */
export const AuctionEventSchema = z
	.object({
		dTag: z.string().min(1, 'auction `d` tag is required'),
		sellerPubkey: nostrPubkeyHex,
		coordinate: addressableCoordinate,
		rootEventId: nostrEventIdHex,
		title: z.string().min(1, 'auction title required'),
		summary: z.string().optional(),
		content: z.string().default(''),
		auctionType: z.literal(AUCTION_TYPE_ENGLISH, { message: `auction_type must equal "${AUCTION_TYPE_ENGLISH}"` }),
		startAt: unixSeconds,
		endAt: unixSeconds,
		maxEndAt: unixSeconds,
		settlementGrace: positiveInt,
		currency: z.literal('SAT', { message: 'currency must be SAT' }),
		reserve: nonNegativeInt,
		startingBid: nonNegativeInt,
		bidIncrement: positiveInt,
		minBidCurve: z.custom<MinBidCurve>(),
		settlementPolicy: z.literal(AUCTION_SETTLEMENT_POLICY, {
			message: `settlement_policy must equal "${AUCTION_SETTLEMENT_POLICY}"`,
		}),
		keyScheme: z.literal(AUCTION_KEY_SCHEME, { message: `key_scheme must equal "${AUCTION_KEY_SCHEME}"` }),
		mints: z.array(z.string().url()).min(1, 'at least one mint required'),
		p2pkXpub: z.string().min(1, 'p2pk_xpub required'),
		auditors: z.array(nostrPubkeyHex).min(1, 'at least one auditor required'),
		auditorQuorum: positiveInt,
		maxSkewSec: positiveInt,
		fallbackDelaySec: nonNegativeInt,
		vadiumRatioBps: nonNegativeInt,
		schema: z.string().default('auction_v1'),
	})
	.refine((value) => value.endAt >= value.startAt, { message: 'end_at must be ≥ start_at', path: ['endAt'] })
	.refine((value) => value.maxEndAt >= value.endAt, { message: 'max_end_at must be ≥ end_at', path: ['maxEndAt'] })
	.refine((value) => value.auditorQuorum <= value.auditors.length, {
		message: 'auditor_quorum cannot exceed the number of listed auditors',
		path: ['auditorQuorum'],
	})

export type AuctionEventInput = z.infer<typeof AuctionEventSchema>

// ----------------------------------------------------------------------------
// NDKEvent → ParsedAuctionEvent
// ----------------------------------------------------------------------------

/**
 * Discriminated result. We don't throw because validators / clients
 * often iterate over many events and want to skip individual bad ones
 * without try/catch.
 */
export type ParseAuctionEventResult =
	{ ok: true; value: ParsedAuctionEvent } | { ok: false; error: z.ZodError | { message: string; code: string } }

/**
 * Parse a raw kind-30408 NDKEvent into a {@link ParsedAuctionEvent}.
 *
 * Failure modes:
 *   - Wrong kind on the event → `wrong_kind`
 *   - Missing required tag → ZodError with field path
 *   - Tag value fails format / range constraint → ZodError
 */
export const parseAuctionEvent = (event: NDKEvent): ParseAuctionEventResult => {
	if (event.kind !== AUCTION_KIND) {
		return { ok: false, error: { code: 'wrong_kind', message: `expected kind ${AUCTION_KIND}, got ${event.kind}` } }
	}

	const dTag = readSingleTag(event, 'd') ?? ''
	const sellerPubkey = event.pubkey
	const coordinate = dTag ? `${AUCTION_KIND}:${sellerPubkey}:${dTag}` : ''
	const rootEventId = readSingleTag(event, 'auction_root_event_id') ?? event.id

	const auctionType = readSingleTag(event, 'auction_type') ?? ''
	const currency = readSingleTag(event, 'currency') ?? ''
	const settlementPolicy = readSingleTag(event, 'settlement_policy') ?? ''
	const keyScheme = readSingleTag(event, 'key_scheme') ?? ''

	const startAt = readIntegerTag(event, 'start_at') ?? 0
	const endAt = readIntegerTag(event, 'end_at') ?? 0
	const maxEndAt = readIntegerTag(event, 'max_end_at') ?? endAt
	const settlementGrace = readIntegerTag(event, 'settlement_grace') ?? 0
	const reserve = readIntegerTag(event, 'reserve') ?? 0
	const startingBid = readIntegerTag(event, 'starting_bid') ?? 0
	const bidIncrement = readIntegerTag(event, 'bid_increment') ?? 0

	const minBidCurve = parseMinBidCurve(readSingleTag(event, 'min_bid_curve'))

	const mints = readMultiTag(event, 'mint')
	const auditors = readMultiTag(event, 'auditors')
	const auditorQuorum = readIntegerTag(event, 'auditor_quorum') ?? DEFAULT_AUDITOR_QUORUM
	const maxSkewSec = readIntegerTag(event, 'max_skew_sec') ?? DEFAULT_MAX_SKEW_SECONDS
	const fallbackDelaySec =
		readIntegerTag(event, 'fallback_delay_sec') ?? Math.floor((settlementGrace * FALLBACK_DELAY_NUMERATOR) / FALLBACK_DELAY_DENOMINATOR)
	const vadiumRatioBps = readIntegerTag(event, 'vadium_ratio_bps') ?? 10_000

	const title = readSingleTag(event, 'title') ?? ''
	const summary = readSingleTag(event, 'summary')
	const p2pkXpub = readSingleTag(event, 'p2pk_xpub') ?? ''
	const schema = readSingleTag(event, 'schema') ?? 'auction_v1'

	const parsed = AuctionEventSchema.safeParse({
		dTag,
		sellerPubkey,
		coordinate,
		rootEventId,
		title,
		summary,
		content: event.content ?? '',
		auctionType,
		startAt,
		endAt,
		maxEndAt,
		settlementGrace,
		currency,
		reserve,
		startingBid,
		bidIncrement,
		minBidCurve,
		settlementPolicy,
		keyScheme,
		mints,
		p2pkXpub,
		auditors,
		auditorQuorum,
		maxSkewSec,
		fallbackDelaySec,
		vadiumRatioBps,
		schema,
	})

	if (!parsed.success) return { ok: false, error: parsed.error }

	return {
		ok: true,
		value: {
			rawEvent: event,
			...parsed.data,
		} as ParsedAuctionEvent,
	}
}
