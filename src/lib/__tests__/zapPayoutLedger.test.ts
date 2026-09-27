import { describe, expect, test } from 'bun:test'
import {
	ZAP_PAYOUT_ROW_STATUSES,
	describeZapPayoutRowStatus,
	isZapPayoutRowSettled,
	zapPayoutRowStatusFrom,
	type ZapPayoutEvidence,
	type ZapPayoutRowStatus,
} from '../v4v/payoutLedger'

/**
 * The sentences of §8, copied verbatim from
 * docs/protocol/auction-v4v-zap-payout-v1.md (the surrounding double quotes of the
 * spec are punctuation, not part of the sentence).
 */
const SPEC_SENTENCES: Readonly<Record<ZapPayoutRowStatus, string>> = {
	planned: 'This share is scheduled to be paid when the auction settles.',
	paid: "This share was paid and the recipient's server published a receipt.",
	paid_unconfirmed: 'This share was paid, but no receipt was published yet.',
	rolled_up: 'This share was too small to send on its own and was paid together with another row.',
	no_receipt_expected: 'This destination is a plain Lightning address, so no zap receipt exists.',
	address_unreachable: "The recipient's Lightning address did not answer.",
	not_zap_capable: "The recipient's endpoint does not accept zaps.",
	below_minimum: 'The share is smaller than this endpoint accepts.',
	payment_failed: 'The Lightning payment did not complete.',
	not_paid: 'This share has not been paid.',
}

/** A "nothing is known yet" evidence object; each test overrides what it is about. */
const base: ZapPayoutEvidence = {
	receiptVerified: false,
	endpointAnswered: true,
	zapCapable: true,
	withinLimits: true,
	paymentSucceeded: true,
	receiptExpected: true,
}

describe('payout ledger vocabulary', () => {
	test('the vocabulary is exactly the ten statuses of §8', () => {
		expect([...ZAP_PAYOUT_ROW_STATUSES].sort()).toEqual(Object.keys(SPEC_SENTENCES).sort())
		expect(ZAP_PAYOUT_ROW_STATUSES).toHaveLength(10)
	})

	test('every status has exactly the spec sentence, verbatim', () => {
		for (const status of ZAP_PAYOUT_ROW_STATUSES) {
			expect(describeZapPayoutRowStatus(status)).toBe(SPEC_SENTENCES[status])
		}
	})

	test('the sentences are non-empty and distinct', () => {
		const sentences = ZAP_PAYOUT_ROW_STATUSES.map(describeZapPayoutRowStatus)
		expect(sentences.every((sentence) => sentence.length > 0)).toBe(true)
		expect(new Set(sentences).size).toBe(10)
	})
})

describe('zapPayoutRowStatusFrom precedence', () => {
	test('each of the ten statuses is reachable from some evidence combination', () => {
		const reachable = new Set<ZapPayoutRowStatus>()
		reachable.add(zapPayoutRowStatusFrom({ ...base, planned: true }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, rolledUp: true }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, endpointAnswered: false }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, zapCapable: false, receiptExpected: false }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, zapCapable: false, receiptExpected: true }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, withinLimits: false }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, paymentSucceeded: false, paymentAttempted: false }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, paymentSucceeded: false }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, receiptVerified: true }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, receiptVerified: false, receiptExpected: true }))
		reachable.add(zapPayoutRowStatusFrom({ ...base, receiptVerified: false, receiptExpected: false }))

		expect([...reachable].sort()).toEqual([...ZAP_PAYOUT_ROW_STATUSES].sort())
	})

	test('a plan-phase row is planned before any failure can be claimed', () => {
		expect(zapPayoutRowStatusFrom({ ...base, planned: true, endpointAnswered: false, paymentSucceeded: false })).toBe('planned')
	})

	test('a rolled-up row reports the roll-up and nothing else', () => {
		expect(zapPayoutRowStatusFrom({ ...base, rolledUp: true, paymentSucceeded: false, receiptVerified: false })).toBe('rolled_up')
	})

	test('no answer is address_unreachable even when other facts look healthy', () => {
		expect(zapPayoutRowStatusFrom({ ...base, endpointAnswered: false, receiptVerified: true })).toBe('address_unreachable')
		expect(zapPayoutRowStatusFrom({ ...base, endpointAnswered: false, zapCapable: true, withinLimits: true, paymentSucceeded: true })).toBe(
			'address_unreachable',
		)
	})

	test('a plain address that answered is no_receipt_expected, a zap endpoint without zaps is not_zap_capable', () => {
		expect(zapPayoutRowStatusFrom({ ...base, zapCapable: false, receiptExpected: false })).toBe('no_receipt_expected')
		expect(zapPayoutRowStatusFrom({ ...base, zapCapable: false, receiptExpected: true })).toBe('not_zap_capable')
	})

	test('outside min/max is below_minimum, ahead of any payment claim', () => {
		expect(zapPayoutRowStatusFrom({ ...base, withinLimits: false, paymentSucceeded: false })).toBe('below_minimum')
		expect(zapPayoutRowStatusFrom({ ...base, withinLimits: false, receiptVerified: true })).toBe('below_minimum')
	})

	test('a failed payment is payment_failed, never paid and never not_paid', () => {
		expect(zapPayoutRowStatusFrom({ ...base, paymentSucceeded: false, receiptVerified: false })).toBe('payment_failed')
		// paymentAttempted is only meaningful when the payment did not succeed.
		expect(zapPayoutRowStatusFrom({ ...base, paymentSucceeded: false, paymentAttempted: true })).toBe('payment_failed')
	})

	test('an attempt that never happened is not_paid, distinct from a failure', () => {
		expect(zapPayoutRowStatusFrom({ ...base, paymentSucceeded: false, paymentAttempted: false })).toBe('not_paid')
	})

	test('a verified receipt is paid; an unverified one with a receipt expected is paid_unconfirmed', () => {
		expect(zapPayoutRowStatusFrom({ ...base, paymentSucceeded: true, receiptVerified: true })).toBe('paid')
		expect(zapPayoutRowStatusFrom({ ...base, paymentSucceeded: true, receiptExpected: true, receiptVerified: false })).toBe(
			'paid_unconfirmed',
		)
	})

	test('paid with no receipt expected is paid — there is no receipt to await', () => {
		expect(zapPayoutRowStatusFrom({ ...base, paymentSucceeded: true, receiptExpected: false, receiptVerified: false })).toBe('paid')
	})

	test('a payment failure is never upgraded by a healthy receipt flag on a different row shape', () => {
		const status = zapPayoutRowStatusFrom({ ...base, paymentSucceeded: false, receiptVerified: true })
		expect(status).toBe('payment_failed')
	})
})

describe('isZapPayoutRowSettled', () => {
	test('settled: paid, paid_unconfirmed, rolled_up, no_receipt_expected', () => {
		expect(isZapPayoutRowSettled('paid')).toBe(true)
		expect(isZapPayoutRowSettled('paid_unconfirmed')).toBe(true)
		expect(isZapPayoutRowSettled('rolled_up')).toBe(true)
		expect(isZapPayoutRowSettled('no_receipt_expected')).toBe(true)
	})

	test('terminal but unacceptable: payment_failed and friends are never settled', () => {
		expect(isZapPayoutRowSettled('payment_failed')).toBe(false)
		expect(isZapPayoutRowSettled('address_unreachable')).toBe(false)
		expect(isZapPayoutRowSettled('not_zap_capable')).toBe(false)
		expect(isZapPayoutRowSettled('below_minimum')).toBe(false)
		expect(isZapPayoutRowSettled('not_paid')).toBe(false)
	})

	test('not terminal: a planned row is pending, not settled', () => {
		expect(isZapPayoutRowSettled('planned')).toBe(false)
	})

	test('covers every status in the vocabulary', () => {
		const settled = ZAP_PAYOUT_ROW_STATUSES.filter(isZapPayoutRowSettled)
		expect(settled).toHaveLength(4)
		expect([...settled].sort()).toEqual(['no_receipt_expected', 'paid', 'paid_unconfirmed', 'rolled_up'])
	})
})
