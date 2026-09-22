import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { type AuctionMultipartyCanonicalManifestRow, computePathCommitment } from '../auction/multipartyManifestWire'
import { describeReleaseGrief, requireCommittedPath, verifyMultipartyRelease } from '../auction/multipartyReleaseWire'

const SELLER = '1'.repeat(64)
const VALIDATOR = '2'.repeat(64)
const SELLER_XPUB = 'xpub-seller'
const VALIDATOR_XPUB = 'xpub-validator'
const PATH = 'shared-path-0001'
const SCHEDULE_COMMITMENT = 'a'.repeat(64)
const MANIFEST_COMMITMENT = 'b'.repeat(64)

/** Deterministic stand-in for the HD derivation the caller injects. */
const deriveChildPubkey = (payoutXpub: string, derivationPath: string): string =>
	Array.from(sha256(new TextEncoder().encode(`${payoutXpub}|${derivationPath}`)))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const row = (
	manifestIndex: number,
	role: AuctionMultipartyCanonicalManifestRow['role'],
	recipient: string,
	xpub: string,
): AuctionMultipartyCanonicalManifestRow => ({
	manifest_index: manifestIndex,
	role,
	recipient_pubkey: recipient,
	child_pubkey: deriveChildPubkey(xpub, PATH),
	amount_sats: 100,
})

const rows = (): AuctionMultipartyCanonicalManifestRow[] => [
	row(0, 'seller', SELLER, SELLER_XPUB),
	row(1, 'validator', VALIDATOR, VALIDATOR_XPUB),
]

const payoutXpubForRow = (manifestRow: AuctionMultipartyCanonicalManifestRow): string =>
	manifestRow.manifest_index === 0 ? SELLER_XPUB : VALIDATOR_XPUB

const release = (overrides: Record<string, unknown> = {}) => ({
	derivationPath: PATH,
	scheduleCommitment: SCHEDULE_COMMITMENT,
	manifestCommitment: MANIFEST_COMMITMENT,
	...overrides,
})

const verify = (input: Partial<Parameters<typeof verifyMultipartyRelease>[0]> = {}) =>
	verifyMultipartyRelease({
		rows: rows(),
		payoutXpubForRow,
		deriveChildPubkey,
		release: release(),
		expectedScheduleCommitment: SCHEDULE_COMMITMENT,
		expectedManifestCommitment: MANIFEST_COMMITMENT,
		...input,
	})

describe('Auction multiparty release verification', () => {
	test('accepts a release whose path reproduces every locked child key', () => {
		const verification = verify()
		expect(verification.ok).toBe(true)
		expect(verification.failures).toEqual([])
		expect(verification.mismatchedIndexes).toEqual([])
		expect(verification.rows.map((entry) => entry.ok)).toEqual([true, true])
		expect(describeReleaseGrief(verification)).toBeNull()
	})

	test('flags grief when one leg does not derive from its announced xpub', () => {
		const tampered = rows()
		tampered[1] = { ...(tampered[1] as AuctionMultipartyCanonicalManifestRow), child_pubkey: 'f'.repeat(64) }
		const verification = verify({ rows: tampered })
		expect(verification.ok).toBe(false)
		expect(verification.mismatchedIndexes).toEqual([1])
		expect(verification.failures).toContain('release_derivation_mismatch')
		expect(describeReleaseGrief(verification)).toContain('manifest indexes 1')
	})

	test('verifies every row, not only the rows a verifier has an interest in', () => {
		const tampered = rows()
		tampered[0] = { ...(tampered[0] as AuctionMultipartyCanonicalManifestRow), child_pubkey: 'e'.repeat(64) }
		tampered[1] = { ...(tampered[1] as AuctionMultipartyCanonicalManifestRow), child_pubkey: 'f'.repeat(64) }
		const verification = verify({ rows: tampered })
		expect(verification.mismatchedIndexes).toEqual([0, 1])
		expect(describeReleaseGrief(verification)).toContain('2 of 2 payout leg(s)')
	})

	test('rejects a release bound to a different schedule or manifest commitment', () => {
		const wrongSchedule = verify({ release: release({ scheduleCommitment: 'c'.repeat(64) }) })
		expect(wrongSchedule.ok).toBe(false)
		expect(wrongSchedule.failures).toContain('release_schedule_commitment_mismatch')
		expect(describeReleaseGrief(wrongSchedule)).toContain('does not bind')

		const wrongManifest = verify({ release: release({ manifestCommitment: 'd'.repeat(64) }) })
		expect(wrongManifest.failures).toContain('release_manifest_commitment_mismatch')
	})

	test('rejects a release whose path does not match the committed path', () => {
		const verification = verify({
			release: release({ pathCommitment: computePathCommitment('a-different-path') }),
		})
		expect(verification.ok).toBe(false)
		expect(verification.failures).toContain('release_path_commitment_mismatch')

		const matching = verify({ release: release({ pathCommitment: computePathCommitment(PATH) }) })
		expect(matching.ok).toBe(true)
	})

	test('requireCommittedPath distinguishes no commitment from a missing or broken one', () => {
		expect(requireCommittedPath(release(), undefined)).toBeNull()
		expect(requireCommittedPath(release(), computePathCommitment(PATH))).toBe('release_path_commitment_missing')
		expect(requireCommittedPath(release({ pathCommitment: computePathCommitment('other') }), computePathCommitment(PATH))).toBe(
			'release_path_commitment_mismatch',
		)
		expect(requireCommittedPath(release({ pathCommitment: computePathCommitment(PATH) }), computePathCommitment(PATH))).toBeNull()
	})

	test('an empty manifest fails closed', () => {
		const verification = verify({ rows: [] })
		expect(verification.ok).toBe(false)
		expect(verification.failures).toContain('release_rows_empty')
	})

	test('the verification is frozen and deterministic', () => {
		const first = verify()
		const second = verify()
		expect(Object.isFrozen(first)).toBe(true)
		expect(first.ok).toBe(second.ok)
		expect(first.rows).toEqual(second.rows)
		expect(first.failures).toEqual(second.failures)
	})
})
