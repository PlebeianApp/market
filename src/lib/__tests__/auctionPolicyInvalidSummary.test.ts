/**
 * What a reader is told when validators report an auction's policy as invalid.
 *
 * The two rules that matter, and why:
 *
 * 1. One claim per validator, newest wins. The address is `auction_policy:<root>`, so a newer
 *    claim for the same validator replaces the older one on the relay; a reader handed both (a
 *    stale cache, two relays disagreeing) must not report two findings from one validator.
 * 2. Issues are unioned by CODE, not concatenated. Three validators reporting the same broken
 *    rule is one broken rule. Concatenating would make an auction look three times as broken as
 *    it is, and the reader cannot see which rule the extra complaints are about.
 */
import { describe, expect, test } from 'bun:test'
import { AUCTION_POLICY_INVALID_CLAIM, AUCTION_POLICY_VERDICT_SCHEMA_TYPE } from '@/lib/auction/constants'
import { summarizeAuctionPolicyClaims } from '@/lib/auction/auctionPolicyInvalidClaim'
import type { ParsedAuctionPolicyVerdictEvent } from '@/lib/auction/events'

const ROOT = 'a'.repeat(64)
const VALIDATOR_A = '1'.repeat(64)
const VALIDATOR_B = '2'.repeat(64)

const claim = (validatorPubkey: string, issues: { code: string; detail: string }[], poolSize = 1): ParsedAuctionPolicyVerdictEvent =>
	({
		id: 'c'.repeat(64),
		validatorPubkey,
		createdAt: 1_700_000_000,
		dTag: `auction_policy:${ROOT}`,
		auctionRootEventId: ROOT,
		auctionCoordinate: `30408:${'b'.repeat(64)}:listing-1`,
		claim: AUCTION_POLICY_INVALID_CLAIM,
		observedAt: 1_700_000_000,
		document: {
			type: AUCTION_POLICY_VERDICT_SCHEMA_TYPE,
			pool_size: poolSize,
			declared_quorum: 1,
			required_quorum: 1,
			issues,
		},
		rawEvent: {} as never,
	}) as ParsedAuctionPolicyVerdictEvent

const POOL_ISSUE = { code: 'pool_below_minimum', detail: 'This auction lists 1 validator(s); at least 2 are required.' }
const QUORUM_ISSUE = { code: 'quorum_below_majority', detail: 'The declared quorum is below the strict majority.' }

describe('summarizeAuctionPolicyClaims', () => {
	test('no claims says nothing', () => {
		expect(summarizeAuctionPolicyClaims([])).toEqual({ claims: [], issues: [] })
	})

	test('one claim reports its issue once', () => {
		const summary = summarizeAuctionPolicyClaims([claim(VALIDATOR_A, [POOL_ISSUE])])
		expect(summary.claims).toHaveLength(1)
		expect(summary.issues).toHaveLength(1)
		expect(summary.issues[0].code).toBe('pool_below_minimum')
	})

	test('two validators agreeing on one issue is one issue, two claims', () => {
		const summary = summarizeAuctionPolicyClaims([claim(VALIDATOR_A, [POOL_ISSUE]), claim(VALIDATOR_B, [POOL_ISSUE])])
		expect(summary.claims).toHaveLength(2)
		expect(summary.issues).toHaveLength(1)
		expect(summary.issues[0].detail).toBe(POOL_ISSUE.detail)
	})

	test('the newest claim per validator wins', () => {
		// Caller order is newest-first, so the first of the two VALIDATOR_A entries is current.
		const stale = claim(VALIDATOR_A, [POOL_ISSUE])
		const fresh = claim(VALIDATOR_A, [POOL_ISSUE, QUORUM_ISSUE])
		const summary = summarizeAuctionPolicyClaims([fresh, stale])
		expect(summary.claims).toHaveLength(1)
		expect(summary.claims[0]).toBe(fresh)
		expect(summary.issues.map((issue) => issue.code)).toEqual(['pool_below_minimum', 'quorum_below_majority'])
	})

	test('different issues from different validators are both reported, in first-seen order', () => {
		const summary = summarizeAuctionPolicyClaims([claim(VALIDATOR_B, [QUORUM_ISSUE]), claim(VALIDATOR_A, [POOL_ISSUE])])
		expect(summary.issues.map((issue) => issue.code)).toEqual(['quorum_below_majority', 'pool_below_minimum'])
	})

	test('the same validator claiming twice does not inflate the validator count', () => {
		const summary = summarizeAuctionPolicyClaims([
			claim(VALIDATOR_A, [POOL_ISSUE], 2),
			claim(VALIDATOR_A, [POOL_ISSUE]),
			claim(VALIDATOR_A, [POOL_ISSUE]),
		])
		expect(summary.claims).toHaveLength(1)
	})
})
