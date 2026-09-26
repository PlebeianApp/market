import { describe, expect, test } from 'bun:test'
import { AUCTION_V4V_TAB, describeRecipientFailure, resolveAuctionWorkflow } from '../workflow/auctionWorkflowResolver'
import { AUCTION_MULTIPARTY_SETTLEMENT_POLICY } from '../auction/multipartySchedule'

const SELLER = 'f'.repeat(64)
const V1 = '1'.repeat(64)
const V2 = '2'.repeat(64)
const V3 = '3'.repeat(64)
const V4V = '4'.repeat(64)
const CAP = 'a'.repeat(64)
const CAP2 = 'b'.repeat(64)
const OFFER = 'c'.repeat(64)

const MULTIPARTY = AUCTION_MULTIPARTY_SETTLEMENT_POLICY
const SINGLE_PARTY = 'cashu_p2pk_bidder_path_v1'

const validatorLine = (pubkey: string, bps = 625, cap = CAP, offer = OFFER) => `validator, ${pubkey}, ${bps}, ${cap}, ${offer}`
const v4vLine = (pubkey: string, bps = 313, cap = CAP2) => `v4v, ${pubkey}, ${bps}, ${cap}`

const resolve = (overrides: Partial<Parameters<typeof resolveAuctionWorkflow>[0]> = {}) =>
	resolveAuctionWorkflow({
		mode: 'create',
		auditors: [V1, V2],
		auditor_quorum: 2,
		settlement_policy: MULTIPARTY,
		recipientLines: '',
		sellerPubkey: SELLER,
		...overrides,
	})

const codes = (resolution: ReturnType<typeof resolveAuctionWorkflow>): string[] => resolution.issues.map((entry) => entry.code)

describe('Auction workflow resolution', () => {
	test('a draft with an admissible validator set and no recipients is complete', () => {
		const resolution = resolve()
		expect(resolution.v4vComplete).toBe(true)
		expect(resolution.requiresV4VSetup).toBe(false)
		expect(resolution.blockingMessages).toEqual([])
		expect(resolution.recipients).toEqual([])
		expect(resolution.schedule).toBeNull()
		expect(resolution.preview).toBeNull()
		expect(resolution.validators.poolSize).toBe(2)
	})

	test('a draft below the validator minimum is blocked, pointing at the V4V tab', () => {
		const resolution = resolve({ auditors: [V1], auditor_quorum: 1 })
		expect(resolution.v4vComplete).toBe(false)
		expect(resolution.requiresV4VSetup).toBe(true)
		expect(codes(resolution)).toContain('pool_below_minimum')
		expect(resolution.issues.find((entry) => entry.code === 'pool_below_minimum')?.tab).toBe(AUCTION_V4V_TAB)
		expect(resolution.issues.find((entry) => entry.code === 'pool_below_minimum')?.severity).toBe('blocking')
		expect(resolution.blockingMessages).toHaveLength(1)
	})

	test('two validators are enough by default, three are not required', () => {
		expect(resolve({ auditors: [V1, V2] }).v4vComplete).toBe(true)
		expect(resolve({ auditors: [V1, V2, V3] }).v4vComplete).toBe(true)
		expect(resolve({ auditors: [V1, V2, V3] }).validators.poolSize).toBe(3)
	})

	test('a stricter ruleset blocks a draft the default ruleset would accept', () => {
		const strict = resolve({ ruleset: { minimum_validators: 3, minimum_quorum_percent: 100 } })
		expect(strict.v4vComplete).toBe(false)
		expect(codes(strict)).toContain('pool_below_minimum')
		expect(strict.validators.rulesetQuorum).toBe(2)
	})

	test('a multiparty draft compiles a schedule and previews the seller remainder', () => {
		const resolution = resolve({
			recipientLines: [validatorLine(V1), v4vLine(V4V)].join('\n'),
		})
		expect(resolution.v4vComplete).toBe(true)
		expect(resolution.schedule).not.toBeNull()
		expect(resolution.preview?.recipientCount).toBe(2)
		expect(resolution.preview?.auxiliaryAllocationBps).toBe(938)
		expect(resolution.preview?.sellerRemainderBps).toBe(9_062)
		expect(resolution.preview?.commitment).toMatch(/^[0-9a-f]{64}$/)
	})

	test('an unreadable recipient line blocks, and the message names the line', () => {
		const resolution = resolve({ recipientLines: [v4vLine(V4V), `validator, ${V1}, 625`].join('\n') })
		expect(resolution.v4vComplete).toBe(false)
		expect(codes(resolution)).toContain('payout_recipient_line_invalid:2')
		expect(resolution.blockingMessages[0]).toContain('line 2')
	})

	test('a validator recipient that is not an auditor blocks with its own sentence', () => {
		const resolution = resolve({ recipientLines: validatorLine(V3) })
		expect(resolution.v4vComplete).toBe(false)
		expect(codes(resolution)).toContain('payout_recipient_validator_not_listed_as_auditor')
		expect(resolution.blockingMessages[0]).toContain('not one of the auction')
	})

	test('the seller cannot be a recipient', () => {
		const resolution = resolve({ recipientLines: v4vLine(SELLER) })
		expect(resolution.v4vComplete).toBe(false)
		expect(codes(resolution)).toContain('payout_recipient_seller_included')
	})

	test('a schedule that does not compile is never partially published', () => {
		// Two lines for the same recipient and role: the codec refuses it, and the
		// resolution must not hand back a half-built schedule.
		const resolution = resolve({ recipientLines: [v4vLine(V4V), v4vLine(V4V, 100)].join('\n') })
		expect(resolution.v4vComplete).toBe(false)
		expect(resolution.schedule).toBeNull()
		expect(resolution.preview).toBeNull()
		expect(codes(resolution)).toContain('schedule_duplicate_role_recipient')
	})

	test('edit mode reports the same problems as warnings instead of blocking', () => {
		const resolution = resolve({ mode: 'edit', auditors: [V1], auditor_quorum: 1 })
		expect(codes(resolution)).toContain('pool_below_minimum')
		expect(resolution.issues.find((entry) => entry.code === 'pool_below_minimum')?.severity).toBe('warning')
		expect(resolution.v4vComplete).toBe(true)
		expect(resolution.blockingMessages).toEqual([])
	})

	test('a single-party draft is assessed against the legacy policy, not blocked', () => {
		const resolution = resolve({ auditors: [V1], auditor_quorum: 1, settlement_policy: SINGLE_PARTY })
		expect(resolution.v4vComplete).toBe(true)
		expect(resolution.validators.legacyTolerated).toBe(true)
	})

	test('the resolution is frozen and deterministic', () => {
		const first = resolve({ recipientLines: v4vLine(V4V) })
		const second = resolve({ recipientLines: v4vLine(V4V) })
		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(first.issues)).toBe(true)
		expect(first.v4vComplete).toBe(second.v4vComplete)
		expect(codes(first)).toEqual(codes(second))
		expect(first.preview?.commitment).toBe(second.preview?.commitment)
	})

	test('every failure code maps to one sentence for the tab and the refusal', () => {
		expect(describeRecipientFailure('payout_recipient_line_invalid:3')).toContain('line 3')
		expect(describeRecipientFailure('payout_recipient_role_invalid')).toContain("'validator' or 'v4v'")
		expect(describeRecipientFailure('payout_recipient_seller_included')).toContain('keeps the remainder')
		expect(describeRecipientFailure('something_unknown')).toContain('could not be built')
	})
})
