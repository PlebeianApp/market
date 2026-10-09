/**
 * Multiparty settlement attestation.
 *
 * The test that carries the weight is the *order* rule: a settled verdict may only be published from an
 * attestation where **every** row passed. A row whose proofs never arrived is `row_proofs_missing` — not
 * a pass, and not silently skipped — because D7 makes one unrespected recipient grief.
 *
 * The second is the honest limit recorded in the module: the settlement key check is a projection of the
 * manifest's x-only child key, so it is **parity-blind**, and there is a test asserting that limit rather
 * than pretending the check is stronger than it is.
 */
import { describe, expect, test } from 'bun:test'
import type { Proof } from '@cashu/cashu-ts'
import {
	attestMultipartySettlement,
	multipartySettlementLegTotalOk,
	proofsFromRowToken,
	isAttestableChildKey,
} from '../auction/multipartySettlementAttestation'
import type { AuctionMultipartyCanonicalManifestRow } from '../auction/multipartyManifestWire'
import {
	buildMultipartyReleaseTags,
	parseMultipartyReleaseTags,
	type ParsedMultipartyReleasePacket,
} from '../auction/multipartyReleasePacket'

const BID = 'b'.repeat(64)
const SCHEDULE_COMMITMENT = 'c'.repeat(64)
const MANIFEST_COMMITMENT = 'd'.repeat(64)
const PATH = 'm/0/71/0'
const SELLER = 'a'.repeat(64)

const CHILDREN = ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)]
const XPUBS = ['xpub-seller', 'xpub-validator', 'xpub-v4v']
const AMOUNTS = [8_800, 200, 1_000]

/** The derivation a verifier is given: each xpub derives its own row's child key for the released path. */
const derive = (xpub: string, _path: string): string => CHILDREN[XPUBS.indexOf(xpub)] ?? CHILDREN[0]

const manifestRows: AuctionMultipartyCanonicalManifestRow[] = AMOUNTS.map((amount_sats, index) => ({
	manifest_index: index,
	role: index === 0 ? 'seller' : index === 1 ? 'validator' : 'v4v',
	recipient_pubkey: `0${index + 1}${'e'.repeat(62)}`,
	child_pubkey: CHILDREN[index],
	amount_sats,
}))

const lockSecret = (compressedKey: string, refund: string): string =>
	JSON.stringify([
		'P2PK',
		{
			nonce: 'n',
			data: compressedKey,
			tags: [
				['locktime', '1790000600'],
				['refund', refund],
			],
		},
	])

const REFUND = `02${'c'.repeat(64)}`
const lockedProof = (amount: number, xOnlyChild: string, compressedPrefix = '02'): Proof =>
	({
		amount,
		id: `00${'a'.repeat(14)}`,
		secret: lockSecret(`${compressedPrefix}${xOnlyChild}`, REFUND),
		C: 'b'.repeat(64),
	}) as unknown as Proof

/** The packets the release builder produces from this leg. */
const packet = (overrides: Record<string, unknown> = {}): ParsedMultipartyReleasePacket => {
	const built = buildMultipartyReleaseTags({
		bidEventId: BID,
		auctionCoordinate: `30408:${SELLER}:lot-1`,
		sellerPubkey: SELLER,
		releaseReason: 'settlement',
		derivationPath: PATH,
		scheduleCommitment: SCHEDULE_COMMITMENT,
		manifestCommitment: MANIFEST_COMMITMENT,
		rows: CHILDREN.map((childPubkey) => ({ childPubkey })),
		...overrides,
	})
	if (!built.ok) throw new Error(`fixture packet refused: ${built.code}`)
	const parsed = parseMultipartyReleaseTags(built.tags)
	if (!parsed.ok) throw new Error(`fixture packet unparsable: ${parsed.code}`)
	return parsed.packet
}

const expectation = {
	bidEventId: BID,
	scheduleCommitment: SCHEDULE_COMMITMENT,
	manifestCommitment: MANIFEST_COMMITMENT,
	rowCount: AMOUNTS.length,
}

const proofsFor =
	(indexes: number[] = [0, 1, 2]) =>
	(row: AuctionMultipartyCanonicalManifestRow) =>
		indexes.includes(row.manifest_index) ? [lockedProof(row.amount_sats, row.child_pubkey)] : undefined

const attest = (overrides: Record<string, unknown> = {}) =>
	attestMultipartySettlement({
		packet: packet(),
		manifestRows,
		payoutXpubForRow: (row) => XPUBS[row.manifest_index],
		deriveChildPubkey: derive,
		expectation,
		proofsForRow: proofsFor(),
		expectedLegTotalSats: AMOUNTS.reduce((sum, amount) => sum + amount, 0),
		...overrides,
	})

describe('multiparty settlement attestation', () => {
	test('attests a fully correct leg: every row’s derivation, lock and amount, and the leg total', () => {
		const attestation = attest()

		expect(attestation.mayPublishSettledVerdict).toBe(true)
		expect(attestation.settledRowCount).toBe(3)
		expect(attestation.mismatchedIndexes).toEqual([])
		expect(attestation.legTotalOk).toBe(true)
		expect(attestation.bindingFailure).toBeNull()
		expect(attestation.rows.map((row) => row.proofSats)).toEqual(AMOUNTS)
	})

	test('a row whose proofs never arrived is missing, not passed — and the leg cannot settle', () => {
		const attestation = attest({ proofsForRow: proofsFor([0, 2]) })

		expect(attestation.mayPublishSettledVerdict).toBe(false)
		expect(attestation.settledRowCount).toBe(2)
		expect(attestation.mismatchedIndexes).toEqual([1])
		expect(attestation.rows[1].failures).toEqual(['row_proofs_missing'])
		expect(attestation.rows[1].lockOk).toBe(false)
	})

	test('a row whose proofs are locked to another row’s key is refused', () => {
		const attestation = attest({
			proofsForRow: (row: AuctionMultipartyCanonicalManifestRow) =>
				row.manifest_index === 1 ? [lockedProof(row.amount_sats, CHILDREN[0])] : [lockedProof(row.amount_sats, row.child_pubkey)],
		})

		expect(attestation.mayPublishSettledVerdict).toBe(false)
		expect(attestation.rows[1].failures).toEqual(['row_proof_foreign_key'])
	})

	test('a row whose proofs do not sum to the manifest amount is refused', () => {
		const attestation = attest({
			proofsForRow: (row: AuctionMultipartyCanonicalManifestRow) =>
				row.manifest_index === 2 ? [lockedProof(999, row.child_pubkey)] : [lockedProof(row.amount_sats, row.child_pubkey)],
		})

		expect(attestation.mayPublishSettledVerdict).toBe(false)
		expect(attestation.rows[2].amountOk).toBe(false)
		expect(attestation.rows[2].failures).toEqual(['row_amount_mismatch'])
	})

	test('a proof that is not a P2PK lock at all is refused', () => {
		const attestation = attest({
			proofsForRow: (row: AuctionMultipartyCanonicalManifestRow) =>
				row.manifest_index === 1
					? [{ ...lockedProof(row.amount_sats, row.child_pubkey), secret: 'plain' } as Proof]
					: [lockedProof(row.amount_sats, row.child_pubkey)],
		})

		expect(attestation.rows[1].failures).toEqual(['row_proof_not_locked'])
	})

	test('a row whose derivation does not reproduce its child key fails, even with perfect proofs', () => {
		const attestation = attest({
			deriveChildPubkey: (xpub: string, path: string) => (xpub === 'xpub-v4v' ? '99'.repeat(32) : derive(xpub, path)),
		})

		expect(attestation.mayPublishSettledVerdict).toBe(false)
		expect(attestation.rows[2].derivationOk).toBe(false)
		expect(attestation.mismatchedIndexes).toEqual([2])
	})

	test('refuses to settle when the release binds a different bid, schedule or manifest', () => {
		const otherBid = attest({ expectation: { ...expectation, bidEventId: '9'.repeat(64) } })
		const otherSchedule = attest({ expectation: { ...expectation, scheduleCommitment: '9'.repeat(64) } })

		expect(otherBid.mayPublishSettledVerdict).toBe(false)
		expect(otherBid.bindingFailure?.code).toBe('release_bid_mismatch')
		// Even with perfect rows and proofs, a broken binding is fatal on its own.
		expect(otherBid.settledRowCount).toBe(3)
		expect(otherSchedule.bindingFailure?.code).toBe('release_schedule_commitment_mismatch')
		expect(otherSchedule.releaseFailures).toContain('release_schedule_commitment_mismatch')
	})

	test('catches a leg whose attested rows do not sum to what the bid actually locked', () => {
		const attestation = attest({ expectedLegTotalSats: 9_999 })

		expect(attestation.legTotalOk).toBe(false)
		expect(attestation.mayPublishSettledVerdict).toBe(false)
		expect(multipartySettlementLegTotalOk(attestation)).toBe(true)
	})

	test('the settlement key check is parity-blind, and this test records that limit', () => {
		// A proof locked to the parity twin of the intended key projects to the same x-only value, so the
		// attestation accepts it. Parity is only knowable at construction (D16), where the compressed key is
		// held — a settlement verifier cannot see it on the wire.
		const attestation = attest({
			proofsForRow: (row: AuctionMultipartyCanonicalManifestRow) => [lockedProof(row.amount_sats, row.child_pubkey, '03')],
		})

		expect(attestation.mayPublishSettledVerdict).toBe(true)
		expect(attestation.rows.every((row) => row.lockOk)).toBe(true)
	})

	test('decodes a row token into proofs, and refuses garbage', () => {
		expect(proofsFromRowToken('not-a-token')).toBeUndefined()
	})

	test('exposes whether a child key is in the form the projection needs', () => {
		expect(isAttestableChildKey(CHILDREN[0])).toBe(true)
		expect(isAttestableChildKey(`02${CHILDREN[0]}`)).toBe(false)
	})
})
