import { describe, expect, test } from 'bun:test'
import { computeVerdictQuorum } from '@/lib/auction/verdictQuorum'
import type { ParsedValidatorVerdictEvent } from '@/lib/auction/events'

const AUDITORS = ['auditor-1', 'auditor-2', 'auditor-3']

function verdict(overrides: {
	bidEventId: string
	validatorPubkey: string
	claim: ParsedValidatorVerdictEvent['claim']
}): ParsedValidatorVerdictEvent {
	return {
		rawEvent: { id: '', pubkey: '', created_at: 0, kind: 30440, tags: [], content: '' },
		id: '',
		validatorPubkey: overrides.validatorPubkey,
		createdAt: 0,
		dTag: '',
		bidderPubkey: 'bidder',
		auctionRootEventId: 'auction-root',
		auctionCoordinate: '',
		bidEventId: overrides.bidEventId,
		claim: overrides.claim,
		observedAt: 0,
	} as ParsedValidatorVerdictEvent
}

describe('computeVerdictQuorum', () => {
	test('no verdicts → not positive/negative/neutral (awaiting)', () => {
		const r = computeVerdictQuorum([], 'bid-1', AUDITORS, 2)
		expect(r.hasPositiveVerdict).toBe(false)
		expect(r.hasNegativeVerdict).toBe(false)
		expect(r.hasNeutralVerdict).toBe(false)
		expect(r.representativeVerdict).toBeNull()
	})

	test('quorum of confirms → positive', () => {
		const verdicts = [
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-1', claim: 'valid_bid_placed' }),
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-2', claim: 'valid_bid_placed' }),
		]
		const r = computeVerdictQuorum(verdicts, 'bid-1', AUDITORS, 2)
		expect(r.confirmCount).toBe(2)
		expect(r.hasPositiveVerdict).toBe(true)
		expect(r.hasNegativeVerdict).toBe(false)
	})

	test('below quorum → still awaiting (not positive)', () => {
		const verdicts = [verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-1', claim: 'valid_bid_placed' })]
		const r = computeVerdictQuorum(verdicts, 'bid-1', AUDITORS, 2)
		expect(r.confirmCount).toBe(1)
		expect(r.hasPositiveVerdict).toBe(false)
		expect(r.hasNegativeVerdict).toBe(false)
		expect(r.hasNeutralVerdict).toBe(true)
	})

	test('quorum of condemns → negative', () => {
		const verdicts = [
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-1', claim: 'bid_invalid' }),
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-2', claim: 'bid_invalid' }),
		]
		const r = computeVerdictQuorum(verdicts, 'bid-1', AUDITORS, 2)
		expect(r.condemnCount).toBe(2)
		expect(r.hasNegativeVerdict).toBe(true)
		expect(r.hasPositiveVerdict).toBe(false)
	})

	test('defaults auditorQuorum to 1', () => {
		const verdicts = [verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-1', claim: 'valid_bid_placed' })]
		expect(computeVerdictQuorum(verdicts, 'bid-1', AUDITORS, undefined).hasPositiveVerdict).toBe(true)
		expect(computeVerdictQuorum(verdicts, 'bid-1', AUDITORS, 0).hasPositiveVerdict).toBe(true)
	})

	test('binds to the exact bid event id — earlier leg verdict does not leak', () => {
		const verdicts = [verdict({ bidEventId: 'bid-old', validatorPubkey: 'auditor-1', claim: 'valid_bid_placed' })]
		const r = computeVerdictQuorum(verdicts, 'bid-new', AUDITORS, 1)
		expect(r.confirmCount).toBe(0)
		expect(r.hasPositiveVerdict).toBe(false)
		expect(r.hasNeutralVerdict).toBe(false)
	})

	test('without bidEventId, does not filter by bid (legacy/back-compat)', () => {
		const verdicts = [verdict({ bidEventId: 'bid-old', validatorPubkey: 'auditor-1', claim: 'valid_bid_placed' })]
		expect(computeVerdictQuorum(verdicts, undefined, AUDITORS, 1).hasPositiveVerdict).toBe(true)
	})

	test('ignores verdicts from non-configured auditors', () => {
		const verdicts = [
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-1', claim: 'valid_bid_placed' }),
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'rogue', claim: 'valid_bid_placed' }),
		]
		const r = computeVerdictQuorum(verdicts, 'bid-1', AUDITORS, 2)
		expect(r.confirmCount).toBe(1)
		expect(r.hasPositiveVerdict).toBe(false)
	})

	test('dedupes by validator pubkey (one latest verdict per validator)', () => {
		// Newest-first list: the same auditor published two verdicts for the bid;
		// only the first (latest) should be counted once.
		const verdicts = [
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-1', claim: 'valid_bid_placed' }),
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-1', claim: 'bid_invalid' }),
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-2', claim: 'valid_bid_placed' }),
		]
		const r = computeVerdictQuorum(verdicts, 'bid-1', AUDITORS, 2)
		expect(r.confirmCount).toBe(2)
		expect(r.condemnCount).toBe(0)
		expect(r.hasPositiveVerdict).toBe(true)
	})

	test('neutral claim (bid_pending_review) is not confirm nor condemn', () => {
		const verdicts = [verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-1', claim: 'bid_pending_review' })]
		const r = computeVerdictQuorum(verdicts, 'bid-1', AUDITORS, 1)
		expect(r.confirmCount).toBe(0)
		expect(r.condemnCount).toBe(0)
		expect(r.hasPositiveVerdict).toBe(false)
		expect(r.hasNegativeVerdict).toBe(false)
		expect(r.hasNeutralVerdict).toBe(true)
	})

	test('won_pending_settlement counts as a confirm (stronger than valid_bid_placed)', () => {
		const verdicts = [
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-1', claim: 'won_pending_settlement' }),
			verdict({ bidEventId: 'bid-1', validatorPubkey: 'auditor-2', claim: 'valid_bid_placed' }),
		]
		const r = computeVerdictQuorum(verdicts, 'bid-1', AUDITORS, 2)
		expect(r.hasPositiveVerdict).toBe(true)
	})
})
