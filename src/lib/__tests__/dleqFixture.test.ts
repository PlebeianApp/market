/**
 * Tests for the in-process NUT-12 DLEQ fixture (`src/lib/cashu/dleqFixture.ts`).
 *
 * The fixture exists so DLEQ verification can be unit-tested *offline* —
 * no mint, no network. It constructs a keyset plus a DLEQ proof whose
 * `hasValidDleq(proof, keyset)` result is `true` for the honest case, and
 * exposes per-field corruption helpers whose results must NOT verify.
 *
 * The one invariant this suite guards is that the fixture really is honest:
 * a proof minted against a given keyset/amount must pass the *library's*
 * verification (`@cashu/cashu-ts` `hasValidDleq`), because every consumer
 * (auction DLEQ happy-path test, sum-check test) relies on that.
 */

import { describe, expect, test } from 'bun:test'
import { hasValidDleq } from '@cashu/cashu-ts'
import type { MintKeys, Proof } from '@cashu/cashu-ts'
import {
	makeDleqKeyset,
	makeHonestDleqProof,
	makeHonestDleqFixture,
	corruptField,
	type DleqProofWithSecret,
	type CorruptibleField,
} from '../cashu/dleqFixture'

/**
 * `hasValidDleq` *throws* (rather than returns false) when the proof's
 * `amount` has no corresponding key in the keyset. The production wrapper
 * (`verifyProofDleq`) catches that and returns false — fail-closed. For this
 * suite we normalise "not valid" to a single boolean so a throw is treated
 * as invalid, matching the fail-closed contract.
 */
const isValid = (proof: Proof, keyset: MintKeys): boolean => {
	try {
		return hasValidDleq(proof, keyset)
	} catch {
		return false
	}
}

const toProofShape = (p: DleqProofWithSecret): Proof => ({
	id: p.id,
	amount: p.amount,
	secret: p.secret,
	C: p.C,
	dleq: { e: p.e, s: p.s, r: p.r },
})

describe('dleqFixture — honest case', () => {
	test('hasValidDleq returns true for the honest fixture (amount 1)', () => {
		const { keyset, proof } = makeHonestDleqFixture(1)
		expect(hasValidDleq(toProofShape(proof), keyset)).toBe(true)
	})

	test('honest proof verifies for several denominations', () => {
		const keyset = makeDleqKeyset()
		for (const amount of [1, 2, 4, 8, 16, 32, 64, 128]) {
			const proof = makeHonestDleqProof(amount)
			expect(hasValidDleq(toProofShape(proof), keyset)).toBe(true)
		}
	})

	test('keyset is well-formed (id + unit + pubkey per amount)', () => {
		const keyset = makeDleqKeyset([1, 2, 4, 8])
		expect(keyset.id).toBeTruthy()
		expect(keyset.unit).toBe('sat')
		expect(Object.keys(keyset.keys).sort()).toEqual(['1', '2', '4', '8'])
		for (const pubkey of Object.values(keyset.keys)) {
			// compressed secp256k1 pubkey = 66 hex chars, 02/03 prefix
			expect(pubkey).toMatch(/^(02|03)[0-9a-f]{64}$/)
		}
	})

	test('proof is well-formed (hex e/s/r, compressed C, positive amount)', () => {
		const { proof } = makeHonestDleqFixture(8)
		expect(proof.C).toMatch(/^(02|03)[0-9a-f]{64}$/)
		expect(proof.e).toMatch(/^[0-9a-f]{64}$/)
		expect(proof.s).toMatch(/^[0-9a-f]{64}$/)
		expect(proof.r).toMatch(/^[0-9a-f]{64}$/)
		expect(proof.amount).toBe(8)
	})

	test('fixture is deterministic in keyset + C/r/id/amount/secret (fresh DLEQ nonce per call)', () => {
		const a = makeHonestDleqFixture(4)
		const b = makeHonestDleqFixture(4)
		// The public parts are stable: keyset, unblinded signature C, blinding
		// factor r, keyset id, amount, and secret. The DLEQ challenge/response
		// e/s carry a fresh random nonce on each call (exactly as a real mint
		// produces), so they are allowed to differ — but must both verify.
		expect(a.keyset).toEqual(b.keyset)
		expect(a.proof.C).toBe(b.proof.C)
		expect(a.proof.r).toBe(b.proof.r)
		expect(a.proof.id).toBe(b.proof.id)
		expect(a.proof.amount).toBe(b.proof.amount)
		expect(a.proof.secret).toBe(b.proof.secret)
		expect(hasValidDleq(toProofShape(a.proof), a.keyset)).toBe(true)
		expect(hasValidDleq(toProofShape(b.proof), b.keyset)).toBe(true)
	})
})

describe('dleqFixture — corrupt-field negative cases', () => {
	const FIELDS: CorruptibleField[] = ['C', 'e', 's', 'r', 'secret', 'amount']

	test('each corrupt-field permutation fails verification', () => {
		const { keyset, proof } = makeHonestDleqFixture(1)
		for (const field of FIELDS) {
			const corrupted = corruptField(proof, field)
			// Only skip the structural identity; every corruption must be
			// crypto-detectable as "not valid".
			expect(isValid(toProofShape(corrupted), keyset)).toBe(false)
		}
	})

	test('corrupt C yields a different point than the honest proof', () => {
		const { proof } = makeHonestDleqFixture(1)
		expect(corruptField(proof, 'C').C).not.toBe(proof.C)
	})

	test('corrupt r changes the blinding factor', () => {
		const { proof } = makeHonestDleqFixture(1)
		expect(corruptField(proof, 'r').r).not.toBe(proof.r)
	})

	test('corrupt secret changes the secret string', () => {
		const { proof } = makeHonestDleqFixture(1)
		expect(corruptField(proof, 'secret').secret).not.toBe(proof.secret)
	})

	test('corrupt id is structurally detectable (not crypto, documented)', () => {
		const { keyset, proof } = makeHonestDleqFixture(1)
		const corrupted = corruptField(proof, 'id')
		expect(corrupted.id).not.toBe(proof.id)
		// `hasValidDleq` does NOT check keyset id — the id is only used by
		// the caller to fetch the right keyset. This is expected + documented.
		expect(isValid(toProofShape(corrupted), keyset)).toBe(true)
	})
})
