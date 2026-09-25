/**
 * Multiparty redemption isolation.
 *
 * The test that carries the weight is the foreign-proof one: a row's token holding a proof locked to a
 * key that is not the row's is the isolation violation this module exists to refuse. The second is the
 * ambiguity rule — spent proofs alone are never completion, because a spent proof can be a bidder
 * reclaim after the locktime.
 */
import { describe, expect, test } from 'bun:test'
import { getEncodedToken, type Proof } from '@cashu/cashu-ts'
import {
	assessMultipartyLegRedemption,
	describeMultipartyLegRedemption,
	verifyMultipartyRowRedemption,
} from '../auction/multipartyRedemptionIsolation'

const MINT = 'https://mint.example.com'
const OTHER_MINT = 'https://mint.example.org'
const REFUND = `02${'c'.repeat(64)}`
const OTHER_REFUND = `03${'d'.repeat(64)}`
const CHILD = '11'.repeat(32)
const OTHER_CHILD = '22'.repeat(32)
const XPUB = 'xpub-fake-for-tests'
const PATH = 'm/0/71/0'

const lockSecret = (compressedKey: string, refund = REFUND, nonce = 'n'): string =>
	JSON.stringify([
		'P2PK',
		{
			nonce,
			data: compressedKey,
			tags: [
				['locktime', '1790000600'],
				['refund', refund],
			],
		},
	])

/** A NUT-11 proof as a real mint returns it: the secret carries the COMPRESSED lock key. */
const lockedProof = (amount: number, child: string = CHILD, refund = REFUND, nonce = 'n'): Proof =>
	({ amount, id: `00${'a'.repeat(14)}`, secret: lockSecret(`02${child}`, refund, nonce), C: 'b'.repeat(64) }) as unknown as Proof

const tokenOf = (proofs: Proof[], mint = MINT): string => getEncodedToken({ mint, proofs })

const rowInput = (overrides: Record<string, unknown> = {}) => ({
	manifestIndex: 0,
	childPubkey: CHILD,
	cashuToken: tokenOf([lockedProof(8_800)]),
	mintUrl: MINT,
	refundPubkey: REFUND,
	amountSats: 8_800,
	payoutXpub: XPUB,
	derivationPath: PATH,
	// The injected derivation: this payee's xpub derives this row's key for the released path.
	derive: () => CHILD,
	...overrides,
})

const verify = (overrides: Record<string, unknown> = {}) => verifyMultipartyRowRedemption(rowInput(overrides))

describe('multiparty row redemption', () => {
	test('accepts a row this payee’s xpub derives, locked to its own key and reclaimable under the leg authority', () => {
		const result = verify()

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.redemption.amountSats).toBe(8_800)
		expect(result.redemption.mintUrl).toBe(MINT)
		expect(result.redemption.proofs).toHaveLength(1)
		expect(result.redemption.lockPubkeyCompressed.slice(2)).toBe(CHILD)
	})

	test('refuses a row that belongs to another payee', () => {
		const result = verify({ derive: () => OTHER_CHILD })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('redemption_row_not_mine')
	})

	test('refuses a token holding a proof locked to a foreign key — the isolation violation', () => {
		const result = verify({ cashuToken: tokenOf([lockedProof(8_800, OTHER_CHILD)]) })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('redemption_row_foreign_proof')
	})

	test('refuses a proof that is not reclaimable under the leg’s refund authority', () => {
		const result = verify({ cashuToken: tokenOf([lockedProof(8_800, CHILD, OTHER_REFUND)]) })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('redemption_row_refund_mismatch')
	})

	test('refuses proofs that do not sum to the row’s amount', () => {
		const result = verify({ cashuToken: tokenOf([lockedProof(8_000)]) })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('redemption_row_amount_mismatch')
	})

	test('refuses a token from a different mint than the leg locked at', () => {
		const result = verify({ cashuToken: tokenOf([lockedProof(8_800)], OTHER_MINT) })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('redemption_row_mint_mismatch')
	})

	test('refuses an undecodable token, an empty token, or a proof that is not a lock', () => {
		const undecodable = verify({ cashuToken: 'not-a-token' })
		const empty = verify({ cashuToken: tokenOf([]) })
		const plain = verify({ cashuToken: tokenOf([{ ...lockedProof(8_800), secret: 'plain' } as Proof]) })

		for (const result of [undecodable, empty, plain]) expect(result.ok).toBe(false)
		if (undecodable.ok || empty.ok || plain.ok) return
		expect(undecodable.code).toBe('redemption_token_invalid')
		expect(empty.code).toBe('redemption_row_no_proofs')
		expect(plain.code).toBe('redemption_proof_not_locked')
	})

	test('refuses a malformed row key or refund authority before decoding anything', () => {
		const badKey = verify({ childPubkey: `02${CHILD}` })
		const badRefund = verify({ refundPubkey: REFUND.slice(2) })

		expect(badKey.ok).toBe(false)
		expect(badRefund.ok).toBe(false)
		if (badKey.ok || badRefund.ok) return
		expect(badKey.code).toBe('redemption_row_key_invalid')
		expect(badRefund.code).toBe('redemption_row_refund_invalid')
	})

	test('reports a derivation that throws as a refusal, not as a crash', () => {
		const result = verify({
			derive: () => {
				throw new Error('xpub is not an extended key')
			},
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.code).toBe('redemption_derivation_failed')
	})
})

const legRows = (
	rows: Array<{ manifestIndex: number; proofBearing?: boolean; mintState: 'unspent' | 'spent' | 'unknown'; confirmed?: boolean }>,
) => rows.map((row) => ({ proofBearing: true, ...row }))

describe('multiparty leg redemption assessment', () => {
	test('is complete only when every payable row is spent AND confirmed', () => {
		const assessment = assessMultipartyLegRedemption(
			legRows([
				{ manifestIndex: 0, mintState: 'spent', confirmed: true },
				{ manifestIndex: 1, mintState: 'spent', confirmed: true },
			]),
		)

		expect(assessment.state).toBe('complete')
		expect(assessment.spentRowIndexes).toEqual([0, 1])
		expect(assessment.awaitingConfirmationRowIndexes).toEqual([])
	})

	test('a fully spent but unconfirmed leg is not complete — a spent proof can be a reclaim', () => {
		const assessment = assessMultipartyLegRedemption(
			legRows([
				{ manifestIndex: 0, mintState: 'spent' },
				{ manifestIndex: 1, mintState: 'spent', confirmed: false },
			]),
		)

		expect(assessment.state).toBe('spent_awaiting_confirmation')
		expect(assessment.awaitingConfirmationRowIndexes).toEqual([0, 1])
		expect(describeMultipartyLegRedemption(assessment)).toContain('bidder reclaim')
	})

	test('reports partially spent, unredeemed and indeterminate legs', () => {
		const partial = assessMultipartyLegRedemption(
			legRows([
				{ manifestIndex: 0, mintState: 'spent', confirmed: true },
				{ manifestIndex: 1, mintState: 'unspent' },
				{ manifestIndex: 2, mintState: 'unspent' },
			]),
		)
		const unredeemed = assessMultipartyLegRedemption(legRows([{ manifestIndex: 0, mintState: 'unspent' }]))
		const indeterminate = assessMultipartyLegRedemption(
			legRows([
				{ manifestIndex: 0, mintState: 'spent', confirmed: true },
				{ manifestIndex: 1, mintState: 'unknown' },
			]),
		)

		expect(partial.state).toBe('partially_spent')
		expect(partial.unspentRowIndexes).toEqual([1, 2])
		expect(unredeemed.state).toBe('unredeemed')
		expect(indeterminate.state).toBe('indeterminate')
		expect(describeMultipartyLegRedemption(indeterminate)).toContain('cannot be assessed')
	})

	test('excludes a zero-fee logical row from the completion requirement', () => {
		const assessment = assessMultipartyLegRedemption([
			{ manifestIndex: 0, proofBearing: true, mintState: 'spent', confirmed: true },
			{ manifestIndex: 1, proofBearing: false, mintState: 'unspent' },
		])

		expect(assessment.state).toBe('complete')
		expect(assessment.proofBearingRowCount).toBe(1)
		expect(assessment.unspentRowIndexes).toEqual([])
	})

	test('a leg with nothing to redeem says so rather than reporting empty success', () => {
		const assessment = assessMultipartyLegRedemption([{ manifestIndex: 0, proofBearing: false, mintState: 'unspent' }])

		expect(assessment.state).toBe('nothing_to_redeem')
		expect(assessment.proofBearingRowCount).toBe(0)
		expect(describeMultipartyLegRedemption(assessment)).toContain('nothing to redeem')
	})

	test('every state has one sentence', () => {
		const states = [
			assessMultipartyLegRedemption(legRows([{ manifestIndex: 0, mintState: 'spent', confirmed: true }])),
			assessMultipartyLegRedemption(legRows([{ manifestIndex: 0, mintState: 'spent' }])),
			assessMultipartyLegRedemption(
				legRows([
					{ manifestIndex: 0, mintState: 'spent', confirmed: true },
					{ manifestIndex: 1, mintState: 'unspent' },
				]),
			),
			assessMultipartyLegRedemption(legRows([{ manifestIndex: 0, mintState: 'unspent' }])),
			assessMultipartyLegRedemption(legRows([{ manifestIndex: 0, mintState: 'unknown' }])),
			assessMultipartyLegRedemption([{ manifestIndex: 0, proofBearing: false, mintState: 'unspent' }]),
		]

		for (const assessment of states) {
			const sentence = describeMultipartyLegRedemption(assessment)
			expect(sentence.length).toBeGreaterThan(20)
			expect(sentence.endsWith('.')).toBe(true)
		}
	})
})
