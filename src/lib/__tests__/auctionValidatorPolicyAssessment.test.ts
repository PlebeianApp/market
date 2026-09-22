import { describe, expect, test } from 'bun:test'
import {
	AUCTION_MINIMUM_VALIDATORS,
	AUCTION_POLICY_INVALID_CLAIM,
	AUCTION_RECOMMENDED_VALIDATOR_POOL,
	DEFAULT_AUCTION_VALIDATOR_RULESET,
	assessAuctionValidatorPolicy,
	bidSelectableUnderAuctionPolicy,
	rulesetRequiredQuorum,
	sanitizeAuctionValidatorRuleset,
} from '../auction/auctionValidatorPolicy'
import { requiredVerdictMajority } from '../auction/verdictMajority'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from '../auction/multipartySchedule'

const MULTIPARTY = AUCTION_MULTIPARTY_SETTLEMENT_POLICY
const SINGLE_PARTY = 'cashu_p2pk_bidder_path_v1'

const pool = (size: number): string[] => Array.from({ length: size }, (_, index) => (index + 1).toString(16).repeat(64).slice(0, 64))

const codes = (assessment: ReturnType<typeof assessAuctionValidatorPolicy>): string[] => assessment.issues.map((issue) => issue.code)

describe('Auction validator policy assessment', () => {
	test('a three-validator multiparty auction with a majority quorum is valid', () => {
		const assessment = assessAuctionValidatorPolicy({
			auditors: pool(3),
			auditor_quorum: 2,
			settlement_policy: MULTIPARTY,
		})
		expect(assessment.valid).toBe(true)
		expect(assessment.issues).toEqual([])
		expect(assessment.poolSize).toBe(3)
		expect(assessment.majorityFloor).toBe(2)
		expect(assessment.requiredQuorum).toBe(2)
		expect(bidSelectableUnderAuctionPolicy(assessment)).toBe(true)
	})

	test('a two-validator multiparty auction is admissible but has no redundancy', () => {
		const assessment = assessAuctionValidatorPolicy({
			auditors: pool(2),
			auditor_quorum: 2,
			settlement_policy: MULTIPARTY,
		})
		expect(assessment.valid).toBe(true)
		expect(assessment.majorityFloor).toBe(2)
		expect(assessment.requiredQuorum).toBe(2)
		expect(AUCTION_MINIMUM_VALIDATORS).toBe(2)
		expect(AUCTION_RECOMMENDED_VALIDATOR_POOL).toBe(3)
	})

	test('a multiparty auction below the minimum pool is invalid', () => {
		const assessment = assessAuctionValidatorPolicy({
			auditors: pool(1),
			auditor_quorum: 1,
			settlement_policy: MULTIPARTY,
		})
		expect(assessment.valid).toBe(false)
		expect(codes(assessment)).toContain('pool_below_minimum')
		expect(assessment.issues.find((issue) => issue.code === 'pool_below_minimum')?.severity).toBe('invalid')
		expect(assessment.issues.find((issue) => issue.code === 'pool_below_minimum')?.detail).toContain(
			`at least ${AUCTION_MINIMUM_VALIDATORS}`,
		)
		expect(bidSelectableUnderAuctionPolicy(assessment)).toBe(false)
	})

	test('a declared quorum below the majority floor makes a multiparty auction invalid', () => {
		const assessment = assessAuctionValidatorPolicy({
			auditors: pool(4),
			auditor_quorum: 2,
			settlement_policy: MULTIPARTY,
		})
		expect(assessment.valid).toBe(false)
		expect(codes(assessment)).toContain('quorum_below_majority')
		expect(assessment.majorityFloor).toBe(3)
		expect(assessment.requiredQuorum).toBe(3)
		expect(assessment.issues.find((issue) => issue.code === 'quorum_below_majority')?.detail).toContain('Two disjoint groups')
	})

	test('a quorum above the pool can never be reached, so the auction is invalid', () => {
		const assessment = assessAuctionValidatorPolicy({
			auditors: pool(3),
			auditor_quorum: 5,
			settlement_policy: MULTIPARTY,
		})
		expect(assessment.valid).toBe(false)
		expect(codes(assessment)).toContain('quorum_exceeds_pool')
	})

	test('duplicate auditor tags are warned about and never inflate the pool or the floor', () => {
		const [a, b] = pool(2)
		const assessment = assessAuctionValidatorPolicy({
			auditors: [a as string, a as string, b as string],
			auditor_quorum: 2,
			settlement_policy: MULTIPARTY,
		})
		expect(assessment.poolSize).toBe(2)
		expect(assessment.majorityFloor).toBe(2)
		expect(codes(assessment)).toContain('duplicate_auditors')
		expect(assessment.valid).toBe(true)
	})

	test('a legacy single-validator auction is tolerated with warnings, not invalidated', () => {
		const assessment = assessAuctionValidatorPolicy({
			auditors: pool(1),
			auditor_quorum: 1,
			settlement_policy: SINGLE_PARTY,
		})
		expect(assessment.valid).toBe(true)
		expect(assessment.legacyTolerated).toBe(true)
		expect(codes(assessment)).toContain('pool_below_minimum')
		expect(assessment.issues.find((issue) => issue.code === 'pool_below_minimum')?.severity).toBe('warning')
		expect(bidSelectableUnderAuctionPolicy(assessment)).toBe(true)
	})

	test('a missing settlement policy is treated as the legacy policy, not as invalid', () => {
		const assessment = assessAuctionValidatorPolicy({ auditors: pool(1), auditor_quorum: 1 })
		expect(assessment.valid).toBe(true)
		expect(assessment.legacyTolerated).toBe(true)
	})

	test('the floor still backstops a low quorum even in a tolerated auction', () => {
		// Legacy policy, four validators, declared quorum 2: the auction is flagged
		// invalid (forkable) regardless of the legacy tolerance for pool size.
		const assessment = assessAuctionValidatorPolicy({
			auditors: pool(4),
			auditor_quorum: 2,
			settlement_policy: SINGLE_PARTY,
		})
		expect(assessment.valid).toBe(false)
		expect(assessment.requiredQuorum).toBe(3)
		expect(assessment.legacyTolerated).toBe(false)
	})

	test('the assessment is frozen and deterministic', () => {
		const first = assessAuctionValidatorPolicy({ auditors: pool(3), auditor_quorum: 2, settlement_policy: MULTIPARTY })
		const second = assessAuctionValidatorPolicy({ auditors: pool(3), auditor_quorum: 2, settlement_policy: MULTIPARTY })
		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(first.issues)).toBe(true)
		expect(first.valid).toBe(second.valid)
		expect(codes(first)).toEqual(codes(second))
	})

	test('exposes the root-level claim name so a validator can mark the auction invalid', () => {
		expect(AUCTION_POLICY_INVALID_CLAIM).toBe('auction_policy_invalid')
	})

	test('an untrusted ruleset cannot weaken the hard >50% rule', () => {
		// A validator publishing a 40% ruleset does not get to fork the auction.
		expect(sanitizeAuctionValidatorRuleset({ minimum_quorum_percent: 40 })).toEqual(DEFAULT_AUCTION_VALIDATOR_RULESET)
		expect(sanitizeAuctionValidatorRuleset({ minimum_quorum_percent: 50 })).toEqual(DEFAULT_AUCTION_VALIDATOR_RULESET)
		expect(sanitizeAuctionValidatorRuleset({ minimum_quorum_percent: 51 }).minimum_quorum_percent).toBe(51)

		const assessment = assessAuctionValidatorPolicy(
			{ auditors: pool(4), auditor_quorum: 3, settlement_policy: MULTIPARTY },
			{ minimum_quorum_percent: 10 },
		)
		expect(assessment.ruleset.minimum_quorum_percent).toBe(51)
		expect(assessment.requiredQuorum).toBe(3)
		expect(assessment.valid).toBe(true)
	})

	test('the default ruleset reproduces the strict-majority floor exactly', () => {
		for (const size of [2, 3, 4, 5, 6, 7]) {
			expect(rulesetRequiredQuorum(DEFAULT_AUCTION_VALIDATOR_RULESET, size)).toBe(requiredVerdictMajority(size))
		}
	})

	test('a stricter ruleset rejects an auction the default ruleset would accept', () => {
		const auction = { auditors: pool(3), auditor_quorum: 2, settlement_policy: MULTIPARTY }
		expect(assessAuctionValidatorPolicy(auction).valid).toBe(true)

		// This validator wants at least 4 validators and unanimity: the same auction
		// is below its floor on both counts.
		const strict = assessAuctionValidatorPolicy(auction, { minimum_validators: 4, minimum_quorum_percent: 100 })
		expect(strict.valid).toBe(false)
		expect(codes(strict)).toContain('pool_below_minimum')
		expect(strict.rulesetQuorum).toBe(3)
		expect(strict.requiredQuorum).toBe(3)

		// 67% of a 3-pool is 3 (ceil), so the ruleset demands unanimity here.
		const twoThirds = assessAuctionValidatorPolicy(auction, { minimum_validators: 3, minimum_quorum_percent: 67 })
		expect(twoThirds.rulesetQuorum).toBe(3)
		expect(codes(twoThirds)).toContain('quorum_below_ruleset')
	})

	test('a ruleset minimum below the protocol default cannot lower the requirement', () => {
		const assessment = assessAuctionValidatorPolicy(
			{ auditors: pool(4), auditor_quorum: 3, settlement_policy: MULTIPARTY },
			{ minimum_validators: 1, minimum_quorum_percent: 51 },
		)
		// The ruleset accepts a 1-validator pool in principle, but this auction has 4
		// and still needs 3 agreeing verdicts.
		expect(assessment.ruleset.minimum_validators).toBe(1)
		expect(assessment.requiredQuorum).toBe(3)
		expect(assessment.valid).toBe(true)
	})

	test('rulesets with nonsense values fall back to the defaults', () => {
		expect(sanitizeAuctionValidatorRuleset({ minimum_validators: 0 })).toEqual(DEFAULT_AUCTION_VALIDATOR_RULESET)
		expect(sanitizeAuctionValidatorRuleset({ minimum_validators: 99 })).toEqual(DEFAULT_AUCTION_VALIDATOR_RULESET)
		expect(sanitizeAuctionValidatorRuleset({ minimum_validators: 2.5 })).toEqual(DEFAULT_AUCTION_VALIDATOR_RULESET)
		expect(sanitizeAuctionValidatorRuleset({ minimum_quorum_percent: Number.NaN })).toEqual(DEFAULT_AUCTION_VALIDATOR_RULESET)
		expect(sanitizeAuctionValidatorRuleset(undefined)).toEqual(DEFAULT_AUCTION_VALIDATOR_RULESET)
	})
})
