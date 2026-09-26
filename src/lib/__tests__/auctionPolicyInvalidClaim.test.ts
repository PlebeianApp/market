import { describe, expect, test } from 'bun:test'
import {
	AUCTION_POLICY_INVALID_CLAIM,
	AUCTION_POLICY_VERDICT_SCHEMA_TYPE,
	AUCTION_VERDICT_D_PREFIX,
	VALIDATOR_VERDICT_KIND,
} from '@/lib/auction/constants'
import {
	assessAuctionPolicyClaim,
	buildAuctionPolicyInvalidClaimContent,
	buildAuctionPolicyInvalidClaimTags,
	verifyAuctionPolicyInvalidClaim,
	type AuctionPolicyClaimInput,
} from '@/lib/auction/auctionPolicyInvalidClaim'
import { parseAuctionPolicyVerdictEvent, parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from '@/lib/auction/multipartySchedule'

const ROOT = 'a'.repeat(64)
const BIDDER = 'b'.repeat(64)
const VALIDATOR = 'c'.repeat(64)
const BID = 'd'.repeat(64)
const COORDINATE = `30408:${'f'.repeat(64)}:listing-1`

/** Two auditors, both required — admissible under the multiparty rules. */
const healthyInput: AuctionPolicyClaimInput = {
	auctionRootEventId: ROOT,
	auctionCoordinate: COORDINATE,
	policy: {
		auditors: ['1'.repeat(64), '2'.repeat(64)],
		auditor_quorum: 2,
		settlement_policy: AUCTION_MULTIPARTY_SETTLEMENT_POLICY,
	},
	observedAt: 1_700_000_000,
}

/** One auditor: no corroboration at all, which the multiparty rules refuse. */
const singleValidatorInput: AuctionPolicyClaimInput = {
	...healthyInput,
	policy: { ...healthyInput.policy, auditors: ['1'.repeat(64)], auditor_quorum: 1 },
}

/** Declared quorum below the strict majority of the pool. */
const lowQuorumInput: AuctionPolicyClaimInput = {
	...healthyInput,
	policy: {
		auditors: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)],
		auditor_quorum: 1,
		settlement_policy: AUCTION_MULTIPARTY_SETTLEMENT_POLICY,
	},
}

const asRawEvent = (tags: string[][], content: string) => ({
	id: 'e'.repeat(64),
	pubkey: VALIDATOR,
	created_at: 1_700_000_100,
	kind: VALIDATOR_VERDICT_KIND as number,
	tags,
	content,
	sig: 'f'.repeat(128),
})

describe('assessAuctionPolicyClaim', () => {
	test('a healthy pool yields no claim', () => {
		const result = assessAuctionPolicyClaim(healthyInput)
		expect(result.broken).toBe(false)
		expect(result.claim).toBeUndefined()
	})

	test('one validator is broken, and the claim names the pool it saw', () => {
		const result = assessAuctionPolicyClaim(singleValidatorInput)
		expect(result.broken).toBe(true)
		expect(result.claim?.claim).toBe(AUCTION_POLICY_INVALID_CLAIM)
		expect(result.claim?.dTag).toBe(`${AUCTION_VERDICT_D_PREFIX}${ROOT}`)
		expect(result.claim?.document.type).toBe(AUCTION_POLICY_VERDICT_SCHEMA_TYPE)
		expect(result.claim?.document.pool_size).toBe(1)
		expect(result.claim?.document.issues.length).toBeGreaterThan(0)
		expect(result.claim?.document.issues.every((issue) => issue.code.length > 0)).toBe(true)
	})

	test('a declared quorum below the strict majority is broken', () => {
		const result = assessAuctionPolicyClaim(lowQuorumInput)
		expect(result.broken).toBe(true)
		expect(result.claim?.document.pool_size).toBe(4)
		expect(result.claim?.document.declared_quorum).toBe(1)
		// Four auditors need three: floor(4 / 2) + 1.
		expect(result.claim?.document.required_quorum).toBe(3)
	})

	test('duplicate auditors never inflate the pool', () => {
		const result = assessAuctionPolicyClaim({
			...singleValidatorInput,
			policy: { ...singleValidatorInput.policy, auditors: ['1'.repeat(64), '1'.repeat(64)] },
		})
		expect(result.claim?.document.pool_size ?? result.assessment.poolSize).toBe(1)
	})

	test('the claim is only built from invalid-severity issues', () => {
		const result = assessAuctionPolicyClaim(singleValidatorInput)
		const invalidCodes = result.assessment.issues.filter((issue) => issue.severity === 'invalid').map((issue) => issue.code)
		expect(result.claim?.document.issues.map((issue) => issue.code)).toEqual(invalidCodes)
	})
})

describe('auction-level verdict wire shape', () => {
	test('the d-tag space is disjoint from a per-bid verdict', () => {
		const claim = assessAuctionPolicyClaim(singleValidatorInput).claim!
		const tags = buildAuctionPolicyInvalidClaimTags(claim)
		const dTag = tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
		// A per-bid d-tag is `<bidder>:<root>:<bid>`; this one must never look like it.
		expect(dTag.split(':')).toHaveLength(2)
		expect(dTag).not.toContain(BIDDER)
		expect(tags.some((tag) => tag[0] === 'bid')).toBe(false)
		expect(tags.some((tag) => tag[0] === 'p')).toBe(false)
	})

	test('the tags carry the auction it addresses', () => {
		const claim = assessAuctionPolicyClaim(singleValidatorInput).claim!
		const tags = buildAuctionPolicyInvalidClaimTags(claim)
		expect(tags).toContainEqual(['e', ROOT])
		expect(tags).toContainEqual(['a', COORDINATE])
		expect(tags).toContainEqual(['claim', AUCTION_POLICY_INVALID_CLAIM])
		expect(tags).toContainEqual(['observed_at', '1700000000'])
	})

	test('the bid parser refuses the claim instead of treating it as a bid condemnation', () => {
		const claim = assessAuctionPolicyClaim(singleValidatorInput).claim!
		const event = asRawEvent(buildAuctionPolicyInvalidClaimTags(claim), buildAuctionPolicyInvalidClaimContent(claim))
		const parsed = parseValidatorVerdictEvent(event)
		expect(parsed.ok).toBe(false)
		if (parsed.ok) throw new Error('unreachable')
		expect('code' in parsed.error ? parsed.error.code : '').toBe('auction_level_claim')
	})

	test('the auction-level parser accepts it, and the bid parser still accepts a real bid verdict', () => {
		const claim = assessAuctionPolicyClaim(singleValidatorInput).claim!
		const claimEvent = asRawEvent(buildAuctionPolicyInvalidClaimTags(claim), buildAuctionPolicyInvalidClaimContent(claim))
		const parsedClaim = parseAuctionPolicyVerdictEvent(claimEvent)
		expect(parsedClaim.ok).toBe(true)
		if (!parsedClaim.ok) throw new Error('unreachable')
		expect(parsedClaim.value.document.pool_size).toBe(1)
		expect(parsedClaim.value.claim).toBe(AUCTION_POLICY_INVALID_CLAIM)

		// The pre-existing per-bid shape must be untouched by the new one.
		const bidVerdict = parseValidatorVerdictEvent(
			asRawEvent(
				[
					['d', `${BIDDER}:${ROOT}:${BID}`],
					['p', BIDDER],
					['a', COORDINATE],
					['e', ROOT],
					['bid', BID],
					['claim', 'valid_bid_placed'],
					['observed_at', '1700000000'],
				],
				JSON.stringify({ bid_amount: 100 }),
			),
		)
		expect(bidVerdict.ok).toBe(true)
	})

	test('an auction-level event with no issues is refused', () => {
		const claim = assessAuctionPolicyClaim(singleValidatorInput).claim!
		const empty = JSON.stringify({ ...claim.document, issues: [] })
		const parsed = parseAuctionPolicyVerdictEvent(asRawEvent(buildAuctionPolicyInvalidClaimTags(claim), empty))
		expect(parsed.ok).toBe(false)
	})
})

describe('verifyAuctionPolicyInvalidClaim', () => {
	const roundTrip = (input: AuctionPolicyClaimInput) => {
		const claim = assessAuctionPolicyClaim(input).claim!
		return parseAuctionPolicyVerdictEvent(
			asRawEvent(buildAuctionPolicyInvalidClaimTags(claim), buildAuctionPolicyInvalidClaimContent(claim)),
		)
	}

	test('a claim derived from the same root verifies', () => {
		const parsed = roundTrip(singleValidatorInput)
		if (!parsed.ok) throw new Error('expected a parseable claim')
		expect(verifyAuctionPolicyInvalidClaim(parsed.value, singleValidatorInput)).toEqual({ ok: true, reasons: [] })
	})

	test('a claim against a healthy policy is refused', () => {
		const parsed = roundTrip(singleValidatorInput)
		if (!parsed.ok) throw new Error('expected a parseable claim')
		const verdict = verifyAuctionPolicyInvalidClaim(parsed.value, healthyInput)
		expect(verdict.ok).toBe(false)
		expect(verdict.reasons.join(' ')).toContain('not broken')
	})

	test('a claim about another auction is refused', () => {
		const parsed = roundTrip(singleValidatorInput)
		if (!parsed.ok) throw new Error('expected a parseable claim')
		const verdict = verifyAuctionPolicyInvalidClaim(parsed.value, {
			...singleValidatorInput,
			auctionRootEventId: '9'.repeat(64),
		})
		expect(verdict.ok).toBe(false)
		expect(verdict.reasons.length).toBeGreaterThan(0)
	})

	test('a tampered document is refused', () => {
		const parsed = roundTrip(lowQuorumInput)
		if (!parsed.ok) throw new Error('expected a parseable claim')
		const tampered = { ...parsed.value, document: { ...parsed.value.document, required_quorum: 1 } }
		const verdict = verifyAuctionPolicyInvalidClaim(tampered, lowQuorumInput)
		expect(verdict.ok).toBe(false)
		expect(verdict.reasons.join(' ')).toContain('required_quorum')
	})
})
