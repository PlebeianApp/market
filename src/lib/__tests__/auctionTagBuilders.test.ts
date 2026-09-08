import { describe, expect, test } from 'bun:test'
import { buildBidEventTags } from '../auction/tagBuilders'
import type { DleqProof } from '../cashu/dleq'

const ROOT_EVENT_ID = '1'.repeat(64)
const SELLER_PK = 'a'.repeat(64)
const CHILD_PK = '02' + 'd'.repeat(64)
const REFUND_PK = '03' + 'e'.repeat(64)
const PROOF_Y = '02' + 'f'.repeat(64)

const dleqProof = (overrides: Partial<DleqProof> = {}): DleqProof => ({
	id: '00' + 'a'.repeat(14),
	amount: 64,
	C: '02' + 'c'.repeat(64),
	e: '0e',
	s: '0f',
	r: '10',
	...overrides,
})

const buildBidInput = (overrides: Partial<Parameters<typeof buildBidEventTags>[0]> = {}) => ({
	auctionRootEventId: ROOT_EVENT_ID,
	auctionCoordinate: `30408:${SELLER_PK}:auction-test`,
	sellerPubkey: SELLER_PK,
	amount: 100,
	mint: 'https://mint.test',
	locktime: 5700,
	refundPubkey: REFUND_PK,
	childPubkey: CHILD_PK,
	lockSecrets: ['lock-secret-1'],
	proofYs: [PROOF_Y],
	createdForEndAt: 2000,
	bidNonce: 'nonce-1',
	...overrides,
})

describe('buildBidEventTags — dleq_proof emission', () => {
	test('emits one dleq_proof tag per proof, JSON-serialized {id,amount,C,e,s,r}', () => {
		const proof = dleqProof()
		const tags = buildBidEventTags(
			buildBidInput({
				lockSecrets: ['lock-secret-1'],
				proofYs: [PROOF_Y],
				dleqProofs: [proof],
			}),
		)

		const dleqTags = tags.filter(([k]) => k === 'dleq_proof')
		expect(dleqTags).toHaveLength(1)
		expect(dleqTags[0][1]).toBe(JSON.stringify({ id: proof.id, amount: proof.amount, C: proof.C, e: proof.e, s: proof.s, r: proof.r }))
	})

	test('emits dleq_proof tags parallel to lock_secret/proof_y (same order)', () => {
		const p1 = dleqProof({ amount: 64 })
		const p2 = dleqProof({ amount: 32, id: '00' + 'b'.repeat(14) })
		const tags = buildBidEventTags(
			buildBidInput({
				lockSecrets: ['lock-secret-1', 'lock-secret-2'],
				proofYs: [PROOF_Y, '02' + '1'.repeat(64)],
				dleqProofs: [p1, p2],
			}),
		)

		const dleqTags = tags.filter(([k]) => k === 'dleq_proof')
		expect(dleqTags).toHaveLength(2)
		expect(dleqTags[0][1]).toBe(JSON.stringify({ id: p1.id, amount: p1.amount, C: p1.C, e: p1.e, s: p1.s, r: p1.r }))
		expect(dleqTags[1][1]).toBe(JSON.stringify({ id: p2.id, amount: p2.amount, C: p2.C, e: p2.e, s: p2.s, r: p2.r }))
	})

	test('throws when dleqProofs.length !== lockSecrets.length', () => {
		expect(() =>
			buildBidEventTags(
				buildBidInput({
					lockSecrets: ['lock-secret-1', 'lock-secret-2'],
					proofYs: [PROOF_Y, '02' + '1'.repeat(64)],
					dleqProofs: [dleqProof()],
				}),
			),
		).toThrow(/dleqProofs/)
	})

	test('omits dleq_proof tags when dleqProofs is absent (grandfathered pre-rollout)', () => {
		const tags = buildBidEventTags(buildBidInput())
		expect(tags.filter(([k]) => k === 'dleq_proof')).toHaveLength(0)
	})
})
