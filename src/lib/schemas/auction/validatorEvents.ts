/**
 * Zod schemas + parsers for the three validator/reputation events:
 *
 * - kind 30440 — per-bid verdict (parameterized replaceable, §4.4.1).
 *   The bread-and-butter event: validators publish one of these per
 *   (validator, bidder, auction, bid) — per-bid addressability, ADR-0003
 *   §4.4.1 amendment — and update it as the bid's state changes.
 *
 * - kind 30441 — validator policy declaration (parameterized
 *   replaceable, §4.4.2). What a validator will and won't accept.
 *
 * - kind 30442 — bidder aggregate reputation (parameterized
 *   replaceable, optional, §4.4.4). Running counts per bidder so
 *   clients can gate at the relationship level rather than per-bid.
 */

import { z } from 'zod'
import {
	AUCTION_LEVEL_VALIDATOR_CLAIMS,
	AUCTION_POLICY_VERDICT_SCHEMA_TYPE,
	AUCTION_VERDICT_D_PREFIX,
	BIDDER_AGGREGATE_REPUTATION_KIND,
	BIDDER_AGGREGATE_SCHEMA_TYPE,
	VALIDATOR_CLAIMS,
	VALIDATOR_POLICY_KIND,
	VALIDATOR_POLICY_SCHEMA_TYPE,
	VALIDATOR_VERDICT_KIND,
	type Nut7ProofState,
	type ValidatorClaim,
} from '../../auction/constants'
import { AUCTION_VALIDATOR_RULESET_MAX_VALIDATORS } from '../../auction/auctionValidatorPolicy'
import type {
	AuctionPolicyVerdictDocument,
	BidderAggregateReputationDocument,
	ParsedAuctionPolicyVerdictEvent,
	ParsedBidderAggregateReputationEvent,
	ParsedValidatorPolicyEvent,
	ParsedValidatorVerdictEvent,
	ValidatorPolicyDocument,
} from '../../auction/events'
import type { NostrEventLike } from '../../nostr/eventLike'
import { addressableCoordinate, nostrEventIdHex, nostrPubkeyHex, unixSeconds } from './common'
import { readSingleTag } from './tagAccess'

// =========================================================================
// kind 30440 — Validator verdict
// =========================================================================

const validatorClaimSchema = z.enum(VALIDATOR_CLAIMS, {
	message: `claim must be one of: ${VALIDATOR_CLAIMS.join(', ')}`,
}) satisfies z.ZodType<ValidatorClaim>

const nut7StateSchema = z.enum(['unspent', 'pending', 'spent', 'missing', 'unknown']) satisfies z.ZodType<Nut7ProofState>

export const ValidatorVerdictEventSchema = z
	.object({
		id: nostrEventIdHex,
		validatorPubkey: nostrPubkeyHex,
		createdAt: unixSeconds,
		dTag: z.string().min(1, 'd tag required'),
		bidderPubkey: nostrPubkeyHex,
		auctionRootEventId: nostrEventIdHex,
		auctionCoordinate: addressableCoordinate,
		bidEventId: nostrEventIdHex,
		claim: validatorClaimSchema,
		observedAt: unixSeconds,
		// Reason is a free-form string so validators can emit codes we don't
		// yet enumerate; the @constants validators-reasons list is advisory.
		reason: z.string().optional(),
		nut7State: nut7StateSchema.optional(),
		nut7ObservedAt: unixSeconds.optional(),
		contentJson: z.unknown().optional(),
	})
	.refine((value) => value.dTag === `${value.bidderPubkey}:${value.auctionRootEventId}:${value.bidEventId}`, {
		message: 'd tag must equal "<bidder_pubkey>:<auction_root_event_id>:<bid_event_id>"',
		path: ['dTag'],
	})

export type ValidatorVerdictEventInput = z.infer<typeof ValidatorVerdictEventSchema>

export type ParseValidatorVerdictResult =
	| { ok: true; value: ParsedValidatorVerdictEvent }
	| { ok: false; error: z.ZodError | { message: string; code: string } }

export const parseValidatorVerdictEvent = (event: NostrEventLike): ParseValidatorVerdictResult => {
	if (event.kind !== VALIDATOR_VERDICT_KIND) {
		return {
			ok: false,
			error: { code: 'wrong_kind', message: `expected kind ${VALIDATOR_VERDICT_KIND}, got ${event.kind}` },
		}
	}

	// Read the canonical fields from their explicit tags rather than
	// splitting the d-tag. The d-tag is `bidder:auction:bid` (ADR-0003 §4.4.1
	// amendment) and is validated by the schema refine below; the `p`, `e`,
	// and `bid` tags are the authoritative sources a client indexes on.
	const bidderPubkey = readSingleTag(event, 'p') ?? ''
	const auctionRootEventId = readSingleTag(event, 'e') ?? ''
	const bidEventId = readSingleTag(event, 'bid') ?? ''
	const dTag = readSingleTag(event, 'd') ?? ''

	let contentJson: unknown = undefined
	if (event.content) {
		try {
			contentJson = JSON.parse(event.content)
		} catch {
			contentJson = event.content // fall through as raw string — schema accepts unknown
		}
	}

	// An auction-level claim (e.g. `auction_policy_invalid`) is a verdict about the auction
	// ROOT, not about a bid: it has no bidder and no bid id, and counting it as a bid
	// condemnation would invalidate every bid in the auction. Refused here rather than
	// tolerated downstream — see `parseAuctionPolicyVerdictEvent` for the shape that owns it.
	const rawClaim = readSingleTag(event, 'claim') ?? ''
	if ((AUCTION_LEVEL_VALIDATOR_CLAIMS as readonly string[]).includes(rawClaim)) {
		return {
			ok: false,
			error: {
				code: 'auction_level_claim',
				message: `claim "${rawClaim}" addresses the auction root, not a bid — parse it with parseAuctionPolicyVerdictEvent`,
			},
		}
	}
	if ((readSingleTag(event, 'd') ?? '').startsWith(AUCTION_VERDICT_D_PREFIX)) {
		return {
			ok: false,
			error: {
				code: 'auction_level_claim',
				message: `d tag prefix "${AUCTION_VERDICT_D_PREFIX}" marks an auction-level verdict, not a per-bid one`,
			},
		}
	}

	const intermediate = {
		id: event.id,
		validatorPubkey: event.pubkey,
		createdAt: event.created_at ?? 0,
		dTag,
		bidderPubkey,
		auctionRootEventId,
		auctionCoordinate: readSingleTag(event, 'a') ?? '',
		bidEventId,
		claim: (readSingleTag(event, 'claim') ?? '') as ValidatorClaim,
		observedAt: Number.parseInt(readSingleTag(event, 'observed_at') ?? '0', 10) || 0,
		reason: readSingleTag(event, 'reason'),
		nut7State: readSingleTag(event, 'nut7_state') as Nut7ProofState | undefined,
		nut7ObservedAt: readSingleTag(event, 'nut7_observed_at')
			? Number.parseInt(readSingleTag(event, 'nut7_observed_at') ?? '0', 10)
			: undefined,
		contentJson,
	}

	const parsed = ValidatorVerdictEventSchema.safeParse(intermediate)
	if (!parsed.success) return { ok: false, error: parsed.error }

	return {
		ok: true,
		value: { rawEvent: event, ...parsed.data } as ParsedValidatorVerdictEvent,
	}
}

// =========================================================================
// kind 30440 — Auction-level verdict (claim = auction_policy_invalid)
// =========================================================================

export const AuctionPolicyVerdictDocumentSchema = z.object({
	type: z.literal(AUCTION_POLICY_VERDICT_SCHEMA_TYPE),
	pool_size: z.number().int().nonnegative(),
	declared_quorum: z.number().int().nonnegative(),
	required_quorum: z.number().int().nonnegative(),
	issues: z
		.array(
			z.object({
				code: z.string().min(1),
				detail: z.string(),
			}),
		)
		.min(1, 'an auction-level verdict must name at least one issue'),
}) satisfies z.ZodType<AuctionPolicyVerdictDocument>

export const AuctionPolicyVerdictEventSchema = z
	.object({
		id: nostrEventIdHex,
		validatorPubkey: nostrPubkeyHex,
		createdAt: unixSeconds,
		dTag: z.string().min(1),
		auctionRootEventId: nostrEventIdHex,
		auctionCoordinate: addressableCoordinate,
		claim: z.enum(AUCTION_LEVEL_VALIDATOR_CLAIMS),
		observedAt: unixSeconds,
		reason: z.string().optional(),
		document: AuctionPolicyVerdictDocumentSchema,
	})
	.refine((value) => value.dTag === `${AUCTION_VERDICT_D_PREFIX}${value.auctionRootEventId}`, {
		message: `d tag must equal "${AUCTION_VERDICT_D_PREFIX}<auction_root_event_id>"`,
		path: ['dTag'],
	})

export type AuctionPolicyVerdictEventInput = z.infer<typeof AuctionPolicyVerdictEventSchema>

export type ParseAuctionPolicyVerdictResult =
	| { ok: true; value: ParsedAuctionPolicyVerdictEvent }
	| { ok: false; error: z.ZodError | { message: string; code: string } }

/**
 * Parse an auction-level verdict (kind 30440 whose `claim` is an auction-level claim).
 *
 * Separate from `parseValidatorVerdictEvent` on purpose: the two shapes differ in what they
 * address (a bid vs the auction root), and the quorum screen must never see these.
 */
export const parseAuctionPolicyVerdictEvent = (event: NostrEventLike): ParseAuctionPolicyVerdictResult => {
	if (event.kind !== VALIDATOR_VERDICT_KIND) {
		return {
			ok: false,
			error: { code: 'wrong_kind', message: `expected kind ${VALIDATOR_VERDICT_KIND}, got ${event.kind}` },
		}
	}

	const claim = readSingleTag(event, 'claim') ?? ''
	if (!(AUCTION_LEVEL_VALIDATOR_CLAIMS as readonly string[]).includes(claim)) {
		return {
			ok: false,
			error: {
				code: 'not_auction_level_claim',
				message: `claim "${claim}" is a per-bid claim, not an auction-level one`,
			},
		}
	}

	let documentJson: unknown = undefined
	try {
		documentJson = JSON.parse(event.content || '{}')
	} catch (err) {
		return {
			ok: false,
			error: { code: 'invalid_json', message: `auction-level verdict content must be JSON: ${(err as Error).message}` },
		}
	}

	const parsed = AuctionPolicyVerdictEventSchema.safeParse({
		id: event.id,
		validatorPubkey: event.pubkey,
		createdAt: event.created_at ?? 0,
		dTag: readSingleTag(event, 'd') ?? '',
		auctionRootEventId: readSingleTag(event, 'e') ?? '',
		auctionCoordinate: readSingleTag(event, 'a') ?? '',
		claim,
		observedAt: Number.parseInt(readSingleTag(event, 'observed_at') ?? '0', 10) || 0,
		reason: readSingleTag(event, 'reason'),
		document: documentJson,
	})
	if (!parsed.success) return { ok: false, error: parsed.error }

	return { ok: true, value: { rawEvent: event, ...parsed.data } as ParsedAuctionPolicyVerdictEvent }
}

// =========================================================================
// kind 30441 — Validator policy
// =========================================================================

export const ValidatorPolicyDocumentSchema = z.object({
	type: z.literal(VALIDATOR_POLICY_SCHEMA_TYPE),
	relatrMinScore: z.number().optional(),
	requireNip05: z.boolean().optional(),
	minAccountAgeDays: z.number().int().nonnegative().optional(),
	blacklist: z.array(nostrPubkeyHex).optional(),
	blacklistRefs: z.array(nostrEventIdHex).optional(),
	requiredAttestors: z.array(nostrPubkeyHex).optional(),
	categoryAllowlist: z.array(z.string()).optional(),
	categoryDenylist: z.array(z.string()).optional(),
	maxAcceptableSkewSec: z.number().int().nonnegative().optional(),
	admission: z
		.discriminatedUnion('enabled', [
			z.object({ enabled: z.literal(false) }),
			z.object({
				enabled: z.literal(true),
				maxBidsPerWindow: z.number().int().nonnegative(),
				rateWindowSec: z.number().int().nonnegative(),
				maxTrackedChildSubscriptions: z.number().int().nonnegative(),
				childReplayLookbackSec: z.number().int().nonnegative(),
				lateSettlementObservationSec: z.number().int().nonnegative().optional(),
				maxTrackedBidsPerAuction: z.number().int().nonnegative(),
				maxSeenEventIds: z.number().int().nonnegative(),
				maxPendingEventsPerKey: z.number().int().nonnegative(),
				maxPendingKeys: z.number().int().nonnegative(),
				maxPendingEvents: z.number().int().nonnegative(),
				pendingTtlSec: z.number().int().nonnegative(),
				maxEventBytes: z.number().int().nonnegative(),
				maxTagCount: z.number().int().nonnegative(),
				maxNonceLength: z.number().int().nonnegative(),
				maxProofCount: z.number().int().nonnegative(),
				maxContentBytes: z.number().int().nonnegative(),
			}),
		])
		.optional(),
	griefingDecayDays: z.number().int().nonnegative().optional(),
	// The validator's ruleset — what it demands of the auctions it audits. Declared in
	// `ValidatorPolicyDocument` since the ruleset amendment, but absent from this schema,
	// which meant Zod silently stripped both fields and the declared ruleset was
	// unreadable on the wire: a client could see a validator's fee and name but never the
	// pool and quorum it requires. Bounds mirror `sanitizeAuctionValidatorRuleset`, which
	// remains the authority at the point of use (a ruleset is untrusted data).
	minValidators: z.number().int().positive().max(AUCTION_VALIDATOR_RULESET_MAX_VALIDATORS).optional(),
	minQuorumPercent: z.number().int().positive().max(100).optional(),
	notes: z.string().optional(),
}) satisfies z.ZodType<ValidatorPolicyDocument>

export type ParseValidatorPolicyResult =
	| { ok: true; value: ParsedValidatorPolicyEvent }
	| { ok: false; error: z.ZodError | { message: string; code: string } }

export const parseValidatorPolicyEvent = (event: NostrEventLike): ParseValidatorPolicyResult => {
	if (event.kind !== VALIDATOR_POLICY_KIND) {
		return {
			ok: false,
			error: { code: 'wrong_kind', message: `expected kind ${VALIDATOR_POLICY_KIND}, got ${event.kind}` },
		}
	}

	const dTag = readSingleTag(event, 'd') ?? ''
	if (!dTag) {
		return { ok: false, error: { code: 'missing_d', message: 'validator policy must have a d tag' } }
	}
	const name = readSingleTag(event, 'name') ?? ''
	if (!name) {
		return { ok: false, error: { code: 'missing_name', message: 'validator policy must have a name tag' } }
	}

	let policyJson: unknown = undefined
	try {
		policyJson = JSON.parse(event.content || '{}')
	} catch (err) {
		return {
			ok: false,
			error: { code: 'invalid_json', message: `validator policy content must be JSON: ${(err as Error).message}` },
		}
	}

	const parsed = ValidatorPolicyDocumentSchema.safeParse(policyJson)
	if (!parsed.success) return { ok: false, error: parsed.error }

	return {
		ok: true,
		value: {
			rawEvent: event,
			id: event.id,
			validatorPubkey: event.pubkey,
			createdAt: event.created_at ?? 0,
			dTag,
			name,
			policy: parsed.data,
		} satisfies ParsedValidatorPolicyEvent,
	}
}

// =========================================================================
// kind 30442 — Bidder aggregate reputation (optional)
// =========================================================================

export const BidderAggregateDocumentSchema = z.object({
	type: z.literal(BIDDER_AGGREGATE_SCHEMA_TYPE),
	windowDays: z.number().int().positive(),
	bids_valid: z.number().int().nonnegative(),
	bids_invalid: z.number().int().nonnegative(),
	wins_settled: z.number().int().nonnegative(),
	wins_griefed: z.number().int().nonnegative(),
	wins_fraudulent: z.number().int().nonnegative(),
	updatedAt: unixSeconds,
}) satisfies z.ZodType<BidderAggregateReputationDocument>

export type ParseBidderAggregateResult =
	| { ok: true; value: ParsedBidderAggregateReputationEvent }
	| { ok: false; error: z.ZodError | { message: string; code: string } }

export const parseBidderAggregateEvent = (event: NostrEventLike): ParseBidderAggregateResult => {
	if (event.kind !== BIDDER_AGGREGATE_REPUTATION_KIND) {
		return {
			ok: false,
			error: { code: 'wrong_kind', message: `expected kind ${BIDDER_AGGREGATE_REPUTATION_KIND}, got ${event.kind}` },
		}
	}

	const dTag = readSingleTag(event, 'd') ?? ''
	if (!dTag) {
		return { ok: false, error: { code: 'missing_d', message: 'bidder aggregate must have a d tag (bidder pubkey)' } }
	}

	let docJson: unknown = undefined
	try {
		docJson = JSON.parse(event.content || '{}')
	} catch (err) {
		return {
			ok: false,
			error: { code: 'invalid_json', message: `bidder aggregate content must be JSON: ${(err as Error).message}` },
		}
	}

	const parsed = BidderAggregateDocumentSchema.safeParse(docJson)
	if (!parsed.success) return { ok: false, error: parsed.error }

	return {
		ok: true,
		value: {
			rawEvent: event,
			id: event.id,
			validatorPubkey: event.pubkey,
			createdAt: event.created_at ?? 0,
			dTag,
			bidderPubkey: dTag,
			aggregate: parsed.data,
		} satisfies ParsedBidderAggregateReputationEvent,
	}
}
