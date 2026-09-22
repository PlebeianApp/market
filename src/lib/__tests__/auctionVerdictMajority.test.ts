import { describe, expect, test } from 'bun:test'
import { computeVerdictQuorum } from '../auction/verdictQuorum'
import { effectiveVerdictQuorum, requiredVerdictMajority } from '../auction/verdictMajority'
import type { ParsedValidatorVerdictEvent } from '../auction/events'

const pool = (size: number): string[] => Array.from({ length: size }, (_, index) => (index + 1).toString(16).repeat(64).slice(0, 64))

const verdict = (validatorPubkey: string, claim: string, bidEventId = 'bid-1'): ParsedValidatorVerdictEvent =>
	({
		validatorPubkey,
		claim,
		bidEventId,
		observedAt: 1_800_000_000,
		eventId: `${validatorPubkey.slice(0, 8)}-${claim}`,
	}) as unknown as ParsedValidatorVerdictEvent

const CONFIRM = 'valid_bid_placed'
const CONDEMN = 'bid_invalid'

describe('Strict-majority quorum floor', () => {
	test('the floor is the smallest count no disjoint group can match', () => {
		expect(requiredVerdictMajority(0)).toBe(1)
		expect(requiredVerdictMajority(1)).toBe(1)
		expect(requiredVerdictMajority(2)).toBe(2)
		expect(requiredVerdictMajority(3)).toBe(2)
		expect(requiredVerdictMajority(4)).toBe(3)
		expect(requiredVerdictMajority(5)).toBe(3)
		expect(requiredVerdictMajority(6)).toBe(4)
		expect(requiredVerdictMajority(7)).toBe(4)
	})

	test('the declared quorum may raise the bar but never lower it below the floor', () => {
		expect(effectiveVerdictQuorum(undefined, 1)).toBe(1)
		expect(effectiveVerdictQuorum(1, 1)).toBe(1)
		// A seller declaring 1 for a four-validator pool does not get a forkable auction.
		expect(effectiveVerdictQuorum(1, 4)).toBe(3)
		// Declaring above the floor is honoured.
		expect(effectiveVerdictQuorum(4, 4)).toBe(4)
		expect(effectiveVerdictQuorum(3, 3)).toBe(3)
		// Garbage declarations fall back to the floor, not to zero.
		expect(effectiveVerdictQuorum(-5, 3)).toBe(2)
		expect(effectiveVerdictQuorum(Number.NaN, 3)).toBe(2)
	})

	test('the pool is counted by distinct validator, so duplicates cannot weaken the floor', () => {
		const duplicated = [pool(1)[0] as string, pool(1)[0] as string, pool(1)[0] as string]
		const result = computeVerdictQuorum([verdict(pool(1)[0] as string, CONFIRM)], 'bid-1', duplicated, 1)
		expect(result.majorityFloor).toBe(1)
		expect(result.requiredQuorum).toBe(1)
		expect(result.hasPositiveVerdict).toBe(true)
	})

	test('a single-validator auction behaves exactly as before', () => {
		const [only] = pool(1)
		const result = computeVerdictQuorum([verdict(only as string, CONFIRM)], 'bid-1', [only as string], 1)
		expect(result.requiredQuorum).toBe(1)
		expect(result.hasPositiveVerdict).toBe(true)
		expect(result.declaredBelowMajority).toBe(false)
	})

	test('with two validators, one confirmation is not enough — the pool must agree', () => {
		const [a, b] = pool(2)
		const partial = computeVerdictQuorum([verdict(a as string, CONFIRM)], 'bid-1', [a as string, b as string], 1)
		expect(partial.requiredQuorum).toBe(2)
		expect(partial.hasPositiveVerdict).toBe(false)
		expect(partial.hasNeutralVerdict).toBe(true)

		const unanimous = computeVerdictQuorum(
			[verdict(a as string, CONFIRM), verdict(b as string, CONFIRM)],
			'bid-1',
			[a as string, b as string],
			1,
		)
		expect(unanimous.hasPositiveVerdict).toBe(true)
	})

	test('two disjoint groups on opposite outcomes produce no outcome at all', () => {
		// The whole point of the floor: with four validators and a declared quorum of 2,
		// two pairs could each reach quorum on opposite results and both would be valid.
		const [a, b, c, d] = pool(4)
		const auditors = [a, b, c, d] as string[]
		const fork = computeVerdictQuorum(
			[verdict(a as string, CONFIRM), verdict(b as string, CONFIRM), verdict(c as string, CONDEMN), verdict(d as string, CONDEMN)],
			'bid-1',
			auditors,
			2,
		)
		expect(fork.confirmCount).toBe(2)
		expect(fork.condemnCount).toBe(2)
		expect(fork.requiredQuorum).toBe(3)
		expect(fork.hasPositiveVerdict).toBe(false)
		expect(fork.hasNegativeVerdict).toBe(false)
		expect(fork.hasNeutralVerdict).toBe(true)
		expect(fork.declaredBelowMajority).toBe(true)
	})

	test('a genuine majority on three validators decides, and the minority cannot fork it', () => {
		const [a, b, c] = pool(3)
		const auditors = [a, b, c] as string[]
		const decided = computeVerdictQuorum(
			[verdict(a as string, CONFIRM), verdict(b as string, CONFIRM), verdict(c as string, CONDEMN)],
			'bid-1',
			auditors,
			1,
		)
		expect(decided.requiredQuorum).toBe(2)
		expect(decided.hasPositiveVerdict).toBe(true)
		expect(decided.hasNegativeVerdict).toBe(false)

		// The lone condemner plus nothing else is still not an outcome.
		const minority = computeVerdictQuorum([verdict(c as string, CONDEMN)], 'bid-1', auditors, 1)
		expect(minority.hasNegativeVerdict).toBe(false)
		expect(minority.hasNeutralVerdict).toBe(true)
	})

	test('a declared quorum above the floor is respected, and is not flagged', () => {
		const [a, b, c, d] = pool(4)
		const auditors = [a, b, c, d] as string[]
		const result = computeVerdictQuorum(
			[verdict(a as string, CONFIRM), verdict(b as string, CONFIRM), verdict(c as string, CONFIRM)],
			'bid-1',
			auditors,
			4,
		)
		expect(result.requiredQuorum).toBe(4)
		expect(result.hasPositiveVerdict).toBe(false)
		expect(result.declaredBelowMajority).toBe(false)
	})

	test('verdicts from outside the pool never count toward any floor', () => {
		const [a, b, c] = pool(3)
		const outsider = 'ff'.repeat(32)
		const result = computeVerdictQuorum(
			[verdict(outsider, CONFIRM), verdict(outsider, CONFIRM), verdict(a as string, CONFIRM)],
			'bid-1',
			[a as string, b as string, c as string],
			1,
		)
		expect(result.confirmCount).toBe(1)
		expect(result.hasPositiveVerdict).toBe(false)
	})
})
