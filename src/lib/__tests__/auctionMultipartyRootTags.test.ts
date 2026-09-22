import { describe, expect, test } from 'bun:test'
import { base64urlnopad } from '@scure/base'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY, compileSourceSchedule } from '../auction/multipartySchedule'
import { AuctionMultipartyRootTagError, buildMultipartyRootTags, readMultipartyRootScheduleTags } from '../auction/multipartyRootTags'

const SELLER_XPUB = 'xpub-seller'
const VALIDATOR = '2'.repeat(64)
const V4V = '3'.repeat(64)

const schedule = compileSourceSchedule([
	{
		role: 'validator',
		recipient_pubkey: VALIDATOR,
		payout_capability_event_id: 'a'.repeat(64),
		allocation_bps: 625,
		validator_offer_event_id: 'b'.repeat(64),
	},
	{
		role: 'v4v',
		recipient_pubkey: V4V,
		payout_capability_event_id: 'c'.repeat(64),
		allocation_bps: 313,
	},
])

/** A stand-in for the single-party builder's output, unmodified by this module. */
const baseTags = (): string[][] => [
	['d', 'auction-1'],
	['title', 'Harvest auction'],
	['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
	['p2pk_xpub', SELLER_XPUB],
	['auditor_quorum', '2'],
]

const codes = (fn: () => unknown): string => {
	try {
		fn()
	} catch (error) {
		return error instanceof AuctionMultipartyRootTagError ? error.code : `not_our_error:${String(error)}`
	}
	return 'no_error'
}

describe('Auction multiparty root tags', () => {
	test('switches the settlement policy and appends the schedule and its commitment', () => {
		const tags = buildMultipartyRootTags({ baseTags: baseTags(), schedule })
		const policy = tags.filter((tag) => tag[0] === 'settlement_policy')
		expect(policy).toEqual([['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY]])
		expect(policy).toHaveLength(1)

		const scheduleTag = tags.find((tag) => tag[0] === 'payout_schedule')
		expect(scheduleTag?.[1]).toBe(base64urlnopad.encode(schedule.canonical_bytes))
		expect(base64urlnopad.decode(scheduleTag?.[1] as string)).toEqual(schedule.canonical_bytes)

		const commitmentTag = tags.find((tag) => tag[0] === 'payout_schedule_commitment')
		expect(commitmentTag).toEqual(['payout_schedule_commitment', schedule.schedule_commitment])
	})

	test('leaves the caller-owned base tags untouched', () => {
		const base = baseTags()
		const snapshot = JSON.stringify(base)
		buildMultipartyRootTags({ baseTags: base, schedule })
		expect(JSON.stringify(base)).toBe(snapshot)
	})

	test('fails when the base has no settlement policy, or more than one', () => {
		const withoutPolicy = baseTags().filter((tag) => tag[0] !== 'settlement_policy')
		expect(codes(() => buildMultipartyRootTags({ baseTags: withoutPolicy, schedule }))).toBe('root_settlement_policy_missing')
		const duplicated = [...baseTags(), ['settlement_policy', 'cashu_p2pk_bidder_path_v1']]
		expect(codes(() => buildMultipartyRootTags({ baseTags: duplicated, schedule }))).toBe('root_settlement_policy_ambiguous')
	})

	test('refuses to overwrite an existing payout_schedule tag rather than replacing it', () => {
		const already = [...baseTags(), ['payout_schedule', 'existing']]
		expect(codes(() => buildMultipartyRootTags({ baseTags: already, schedule }))).toBe('root_schedule_tag_already_present')
	})

	test('reads back what the builder wrote', () => {
		const tags = buildMultipartyRootTags({ baseTags: baseTags(), schedule })
		const read = readMultipartyRootScheduleTags(tags)
		expect(read.settlementPolicy).toBe(AUCTION_MULTIPARTY_SETTLEMENT_POLICY)
		expect(read.payoutScheduleCommitment).toBe(schedule.schedule_commitment)
		expect(base64urlnopad.decode(read.payoutScheduleB64u)).toEqual(schedule.canonical_bytes)
	})

	test('fails closed on a missing policy or incomplete schedule tags', () => {
		const tags = buildMultipartyRootTags({ baseTags: baseTags(), schedule })
		expect(codes(() => readMultipartyRootScheduleTags(tags.filter((tag) => tag[0] !== 'settlement_policy')))).toBe(
			'root_settlement_policy_missing',
		)
		expect(codes(() => readMultipartyRootScheduleTags(tags.filter((tag) => tag[0] !== 'payout_schedule_commitment')))).toBe(
			'root_schedule_tags_incomplete',
		)
		expect(codes(() => readMultipartyRootScheduleTags([...tags, ['payout_schedule', 'duplicate']]))).toBe('root_schedule_tags_incomplete')
		expect(
			codes(() => readMultipartyRootScheduleTags(tags.map((tag) => (tag[0] === 'payout_schedule' ? ['payout_schedule', ''] : tag)))),
		).toBe('root_schedule_tags_incomplete')
	})

	test('the returned tag set is a fresh array, so later edits cannot reach the base', () => {
		const base = baseTags()
		const tags = buildMultipartyRootTags({ baseTags: base, schedule })
		tags[0] = ['d', 'mutated']
		expect(base[0]).toEqual(['d', 'auction-1'])
	})
})
