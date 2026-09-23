import { describe, expect, test } from 'bun:test'
import { AUCTION_RECOMMENDED_VALIDATOR_POOL, describeValidatorPoolCaution } from '@/lib/auction/auctionValidatorPolicy'

/**
 * The caution shown with the errors at the bottom of the V4V step. It is copy, not
 * policy — but it is the only thing that tells a seller what a one- or two-validator
 * pool costs, so its boundaries are worth pinning: no validator and a full pool say
 * nothing here (the empty state and the green confirmation own those cases).
 */
describe('the small-pool caution', () => {
	test('says nothing when no validator is chosen, or when the pool is big enough', () => {
		expect(describeValidatorPoolCaution(0)).toBeNull()
		expect(describeValidatorPoolCaution(AUCTION_RECOMMENDED_VALIDATOR_POOL)).toBeNull()
		expect(describeValidatorPoolCaution(AUCTION_RECOMMENDED_VALIDATOR_POOL + 4)).toBeNull()
	})

	test('one validator is called out as having nothing to corroborate it', () => {
		const caution = describeValidatorPoolCaution(1)
		expect(caution).toContain('nothing corroborates')
		expect(caution).toContain('no outcome at all')
	})

	test('two validators are called out as stalling the auction when one is absent', () => {
		const caution = describeValidatorPoolCaution(2)
		expect(caution).toContain('both must agree')
		expect(caution).toContain(String(AUCTION_RECOMMENDED_VALIDATOR_POOL))
	})
})
