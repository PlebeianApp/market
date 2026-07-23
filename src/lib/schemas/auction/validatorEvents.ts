/**
 * Zod schemas + parsers for the three validator/reputation events:
 *
 * - kind 30440 — per-bid verdict (parameterized replaceable, §4.4.1).
 *   The bread-and-butter event: validators publish one of these per
 *   (validator, bidder, auction) and update it as the bid's state
 *   changes.
 *
 * - kind 30441 — validator policy declaration (parameterized
 *   replaceable, §4.4.2). What a validator will and won't accept.
 *
 * - kind 30442 — bidder aggregate reputation (parameterized
 *   replaceable, optional, §4.4.4). Running counts per bidder so
 *   clients can gate at the relationship level rather than per-bid.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { z } from 'zod'
import {
	BIDDER_AGGREGATE_REPUTATION_KIND,
	BIDDER_AGGREGATE_SCHEMA_TYPE,
	VALIDATOR_CLAIMS,
	VALIDATOR_POLICY_KIND,
	VALIDATOR_POLICY_SCHEMA_TYPE,
	VALIDATOR_VERDICT_KIND,
	type Nut7ProofState,
	type ValidatorClaim,
} from '../../auction/constants'
import type {
	BidderAggregateReputationDocument,
	ParsedBidderAggregateReputationEvent,
	ParsedValidatorPolicyEvent,
	ParsedValidatorVerdictEvent,
	ValidatorPolicyDocument,
} from '../../auction/events'
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
	.refine((value) => value.dTag === `${value.bidderPubkey}:${value.auctionRootEventId}`, {
		message: 'd tag must equal "<bidder_pubkey>:<auction_root_event_id>"',
		path: ['dTag'],
	})

export type ValidatorVerdictEventInput = z.infer<typeof ValidatorVerdictEventSchema>

export type ParseValidatorVerdictResult =
	| { ok: true; value: ParsedValidatorVerdictEvent }
	| { ok: false; error: z.ZodError | { message: string; code: string } }

export const parseValidatorVerdictEvent = (event: NDKEvent): ParseValidatorVerdictResult => {
	if (event.kind !== VALIDATOR_VERDICT_KIND) {
		return {
			ok: false,
			error: { code: 'wrong_kind', message: `expected kind ${VALIDATOR_VERDICT_KIND}, got ${event.kind}` },
		}
	}

	const dTag = readSingleTag(event, 'd') ?? ''
	const [bidderPubkey = '', auctionRootEventId = ''] = dTag.split(':')

	let contentJson: unknown = undefined
	if (event.content) {
		try {
			contentJson = JSON.parse(event.content)
		} catch {
			contentJson = event.content // fall through as raw string — schema accepts unknown
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
		bidEventId: readSingleTag(event, 'bid') ?? '',
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
	griefingDecayDays: z.number().int().nonnegative().optional(),
	notes: z.string().optional(),
}) satisfies z.ZodType<ValidatorPolicyDocument>

export type ParseValidatorPolicyResult =
	| { ok: true; value: ParsedValidatorPolicyEvent }
	| { ok: false; error: z.ZodError | { message: string; code: string } }

export const parseValidatorPolicyEvent = (event: NDKEvent): ParseValidatorPolicyResult => {
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

export const parseBidderAggregateEvent = (event: NDKEvent): ParseBidderAggregateResult => {
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
