import { describe, expect, test } from 'bun:test'
import { verifyProofDleq, verifyBidDleq, getMintKeyset, buildDleqProofs, type DleqVerifyResult } from '../cashu/dleq'
import type { MintKeys, Proof } from '@cashu/cashu-ts'
import { makeHonestDleqProof, makeHonestDleqFixture, makeDleqKeyset } from '../cashu/dleqFixture'

// ---------- Fixture: minimal keyset with valid secp256k1 public keys ----------

/**
 * Valid secp256k1 compressed public keys used as mock mint keys.
 * These are real curve points (G, 2*G) — `hasValidDleq` needs valid
 * points to compute the reblind verification. Garbage e/s/r will
 * NOT verify against any key, which is exactly what we need for
 * negative-path tests.
 */
const GENERATOR_HEX = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const TWO_G_HEX = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'

const makeKeyset = (amounts: number[]): MintKeys => {
	const keys: Record<number, string> = {}
	for (const amt of amounts) {
		keys[amt] = amt === 1 ? GENERATOR_HEX : TWO_G_HEX
	}
	return { id: '00deadbeef', unit: 'sat', keys }
}

const keyset = makeKeyset([1, 2, 4, 8])

/**
 * Garbage DLEQ — will NEVER pass `hasValidDleq`.
 * `hasValidDleq` calls `verifyDLEQProof_reblind` which does real
 * cryptographic verification; garbage e/s/r always fails.
 */
const garbageDleq = { e: '00', s: '00', r: '00' }

// ---------- verifyProofDleq -------------------------------------------------

describe('verifyProofDleq', () => {
	test('returns false when r is empty string (no blinding factor)', () => {
		const result = verifyProofDleq(
			{ id: '00deadbeef', amount: 1, secret: 'test-secret', C: GENERATOR_HEX, e: 'aa', s: 'bb', r: '' },
			keyset,
		)
		expect(result).toBe(false)
	})

	test('returns false when amount key is absent from keyset', () => {
		// keyset has no key for amount 16 → hasValidDleq throws
		const result = verifyProofDleq(
			{ id: '00deadbeef', amount: 16, secret: 'test-secret', C: GENERATOR_HEX, e: 'ff', s: 'ff', r: 'ff' },
			keyset,
		)
		expect(result).toBe(false)
	})

	test('returns false with garbage dleq data (crypto verification fails)', () => {
		// Amount 1 exists in keyset, but e/s/r are garbage
		const result = verifyProofDleq({ id: '00deadbeef', amount: 1, secret: 'test-secret', C: GENERATOR_HEX, ...garbageDleq }, keyset)
		expect(result).toBe(false)
	})

	test('does not throw on any input (non-throwing contract)', () => {
		expect(() => {
			verifyProofDleq({ id: '', amount: 0, secret: '', C: '', e: '', s: '', r: '' }, keyset)
		}).not.toThrow()

		expect(() => {
			verifyProofDleq({ id: '', amount: 1, secret: '', C: '', e: 'aa', s: 'bb', r: 'cc' }, { id: '', unit: 'sat', keys: {} })
		}).not.toThrow()
	})

	// ── happy path (A3 fixture) ───────────────────────────────────────

	test('returns true for an honest DLEQ proof (A3 fixture, offline)', () => {
		const { keyset: fixtureKeyset, proof } = makeHonestDleqFixture(1)
		const result = verifyProofDleq(proof, fixtureKeyset)
		expect(result).toBe(true)
	})

	test('returns true for honest proofs across several denominations', () => {
		// Construct ONE keyset and derive every proof against it, so the
		// test does not depend on cross-call keyset determinism.
		const fixtureKeyset = makeDleqKeyset()
		for (const amount of [1, 2, 4, 8, 16, 32, 64, 128]) {
			const { proof } = makeHonestDleqFixture(amount)
			expect(verifyProofDleq(proof, fixtureKeyset)).toBe(true)
		}
	})
})

// ---------- verifyBidDleq ---------------------------------------------------

describe('verifyBidDleq', () => {
	test('allProofsValid=false with garbage proofs (crypto verification fails)', () => {
		// Garbage DLEQ fails hasValidDleq → both proofs fail
		const result: DleqVerifyResult = verifyBidDleq(
			{
				legDelta: 3,
				proofs: [
					{ id: '00deadbeef', amount: 1, secret: 's1', C: GENERATOR_HEX, ...garbageDleq },
					{ id: '00deadbeef', amount: 2, secret: 's2', C: TWO_G_HEX, ...garbageDleq },
				],
			},
			keyset,
		)
		expect(result.ok).toBe(false)
		// Garbage DLEQ always fails crypto verification
		expect(result.allProofsValid).toBe(false)
		expect(result.failedProofIndex).toBe(0) // first proof fails first
		// Sum check is independent: 1+2=3 === legDelta=3
		expect(result.matchesAmount).toBe(true)
	})

	test('matchesAmount=false when sum != legDelta', () => {
		const result = verifyBidDleq(
			{
				legDelta: 10,
				proofs: [{ id: '00deadbeef', amount: 1, secret: 's1', C: GENERATOR_HEX, ...garbageDleq }],
			},
			keyset,
		)
		expect(result.matchesAmount).toBe(false)
		expect(result.ok).toBe(false)
	})

	test('failedProofIndex points to the first failing proof', () => {
		// First proof (index 0, amount 4) has garbage → fails
		// Second proof (index 1, amount 16) is absent from keyset → also would fail,
		// but we break on first failure.
		const result = verifyBidDleq(
			{
				legDelta: 20,
				proofs: [
					{ id: '00deadbeef', amount: 4, secret: 's1', C: GENERATOR_HEX, ...garbageDleq },
					{ id: '00deadbeef', amount: 16, secret: 's2', C: TWO_G_HEX, e: 'ff', s: 'ff', r: 'ff' },
				],
			},
			keyset,
		)
		expect(result.allProofsValid).toBe(false)
		expect(result.failedProofIndex).toBe(0) // first proof fails on garbage DLEQ
		expect(result.ok).toBe(false)
	})

	test('missing amount key produces failedProofIndex correctly', () => {
		// Only this proof, amount 16 absent from keyset
		const result = verifyBidDleq(
			{
				legDelta: 16,
				proofs: [{ id: '00deadbeef', amount: 16, secret: 's16', C: TWO_G_HEX, e: 'ff', s: 'ff', r: 'ff' }],
			},
			keyset,
		)
		expect(result.allProofsValid).toBe(false)
		expect(result.failedProofIndex).toBe(0)
		expect(result.ok).toBe(false)
	})

	test('empty proofs: sum 0, legDelta 0 → ok=true (vacuous truth)', () => {
		// Zero proofs, sum=0 === legDelta=0, and vacuously all proofs pass
		const result = verifyBidDleq({ legDelta: 0, proofs: [] }, keyset)
		expect(result.allProofsValid).toBe(true)
		expect(result.matchesAmount).toBe(true)
		expect(result.ok).toBe(true)
		expect(result.failedProofIndex).toBeUndefined()
	})

	test('empty proofs with non-zero legDelta has matchesAmount=false', () => {
		const result = verifyBidDleq({ legDelta: 5, proofs: [] }, keyset)
		expect(result.matchesAmount).toBe(false)
		expect(result.allProofsValid).toBe(true) // vacuous
		expect(result.ok).toBe(false)
	})

	test('failedProofIndex is undefined when no proofs to check (empty array)', () => {
		const result = verifyBidDleq({ legDelta: 0, proofs: [] }, keyset)
		expect(result.failedProofIndex).toBeUndefined()
	})

	// ── E1: sum-check with honest A3 fixture ────────────────────────────

	test('single-leg bid: ok=true when sum(proofs.amount) === legDelta (honest proofs, A3 fixture)', () => {
		const dleqKeyset = makeDleqKeyset()
		const proof = makeHonestDleqProof(8)
		const result = verifyBidDleq({ legDelta: 8, proofs: [proof] }, dleqKeyset)
		expect(result.ok).toBe(true)
		expect(result.allProofsValid).toBe(true)
		expect(result.matchesAmount).toBe(true)
		expect(result.failedProofIndex).toBeUndefined()
	})

	test('single-leg bid: ok=false when sum(proofs.amount) !== legDelta (honest proofs, A3 fixture)', () => {
		const dleqKeyset = makeDleqKeyset()
		const proof = makeHonestDleqProof(8)
		const result = verifyBidDleq({ legDelta: 4, proofs: [proof] }, dleqKeyset)
		expect(result.allProofsValid).toBe(true) // proof is honest
		expect(result.matchesAmount).toBe(false) // 8 !== 4
		expect(result.failedProofIndex).toBeUndefined() // sum-mismatch is not a per-proof failure
		expect(result.ok).toBe(false)
	})

	test('rebid-leg: ok=true when sum(proofs.amount) === legDelta (multiple honest proofs, A3 fixture)', () => {
		const dleqKeyset = makeDleqKeyset()
		const proof1 = makeHonestDleqProof(2)
		const proof2 = makeHonestDleqProof(4)
		const result = verifyBidDleq({ legDelta: 6, proofs: [proof1, proof2] }, dleqKeyset)
		expect(result.ok).toBe(true)
		expect(result.allProofsValid).toBe(true)
		expect(result.matchesAmount).toBe(true)
	})

	test('rebid-leg: ok=false when sum(proofs.amount) !== legDelta (multiple honest proofs, A3 fixture)', () => {
		const dleqKeyset = makeDleqKeyset()
		const proof1 = makeHonestDleqProof(2)
		const proof2 = makeHonestDleqProof(4)
		const result = verifyBidDleq({ legDelta: 10, proofs: [proof1, proof2] }, dleqKeyset)
		expect(result.allProofsValid).toBe(true) // both proofs honest
		expect(result.matchesAmount).toBe(false) // 6 !== 10
		expect(result.failedProofIndex).toBeUndefined() // sum-mismatch is not a per-proof failure
		expect(result.ok).toBe(false)
	})

	// ── happy path (A3 fixture) ───────────────────────────────────────

	test('ok=true for a single honest proof matching legDelta (happy path)', () => {
		const { keyset: fixtureKeyset, proof: p1 } = makeHonestDleqFixture(1)
		const result: DleqVerifyResult = verifyBidDleq({ legDelta: 1, proofs: [p1] }, fixtureKeyset)
		expect(result.allProofsValid).toBe(true)
		expect(result.matchesAmount).toBe(true)
		expect(result.ok).toBe(true)
		expect(result.failedProofIndex).toBeUndefined()
	})

	test('ok=true for multiple honest proofs summing to legDelta (happy path, multi-proof)', () => {
		const { keyset: fixtureKeyset, proof: p1 } = makeHonestDleqFixture(1)
		const { proof: p2 } = makeHonestDleqFixture(2)
		const { proof: p4 } = makeHonestDleqFixture(4)
		const result: DleqVerifyResult = verifyBidDleq({ legDelta: 7, proofs: [p1, p2, p4] }, fixtureKeyset)
		expect(result.allProofsValid).toBe(true)
		expect(result.matchesAmount).toBe(true)
		expect(result.ok).toBe(true)
		expect(result.failedProofIndex).toBeUndefined()
	})

	test('allProofsValid=true but matchesAmount=false when honest proofs but sum ≠ legDelta', () => {
		const { keyset: fixtureKeyset, proof: p1 } = makeHonestDleqFixture(1)
		const { proof: p2 } = makeHonestDleqFixture(2)
		// DLEQ proofs are honest (all verifiable), but declared legDelta is wrong
		const result: DleqVerifyResult = verifyBidDleq({ legDelta: 10, proofs: [p1, p2] }, fixtureKeyset)
		expect(result.allProofsValid).toBe(true)
		expect(result.matchesAmount).toBe(false)
		expect(result.ok).toBe(false)
		// No proof failed crypto verification, so no failure index is set.
		expect(result.failedProofIndex).toBeUndefined()
	})
})

// ---------- getMintKeyset ---------------------------------------------------

describe('getMintKeyset', () => {
	test('returns the matching keyset via a customRequest transport (no network)', async () => {
		// Inject a mock transport so `CashuMint.getKeys` never touches the
		// network. `customRequest` receives { endpoint, ... } and returns
		// the raw /v1/keys payload.
		const mockKeyset: MintKeys = { id: '00deadbeef', unit: 'sat', keys: { 1: GENERATOR_HEX } }
		const customRequest = async ({ endpoint }: { endpoint: string }) => {
			// Signal we got the expected keyset-scoped endpoint.
			expect(endpoint).toContain('/v1/keys')
			return { keysets: [mockKeyset] }
		}

		const result = await getMintKeyset('https://mint.example.com', '00deadbeef', { customRequest })
		expect(result.id).toBe('00deadbeef')
		expect(result.keys).toEqual({ 1: GENERATOR_HEX })
	})

	test('propagates a transport failure as a rejected promise (non-throwing contract is caller-side)', async () => {
		const customRequest = async () => {
			throw new Error('mint unreachable')
		}
		// getMintKeyset should propagate the error (the caller decides policy);
		// the pure verification helpers are the non-throwing ones.
		await expect(getMintKeyset('https://mint.example.com', '00deadbeef', { customRequest })).rejects.toThrow('mint unreachable')
	})
})

// ---------- buildDleqProofs -------------------------------------------------

describe('buildDleqProofs', () => {
	const makeProof = (overrides: Partial<Proof> = {}): Proof => ({
		id: '00deadbeef',
		amount: 1,
		secret: 'test-secret',
		C: GENERATOR_HEX,
		dleq: { e: 'aa', s: 'bb', r: 'cc' },
		...overrides,
	})

	test('maps locked proofs to DleqProof entries (id, amount, C, e, s, r)', () => {
		const proofs: Proof[] = [
			makeProof({ amount: 1, C: GENERATOR_HEX, dleq: { e: 'aa', s: 'bb', r: 'cc' } }),
			makeProof({ amount: 2, C: TWO_G_HEX, dleq: { e: 'dd', s: 'ee', r: 'ff' } }),
		]
		const result = buildDleqProofs(proofs)
		expect(result).toEqual([
			{ id: '00deadbeef', amount: 1, C: GENERATOR_HEX, e: 'aa', s: 'bb', r: 'cc' },
			{ id: '00deadbeef', amount: 2, C: TWO_G_HEX, e: 'dd', s: 'ee', r: 'ff' },
		])
	})

	test('preserves proof order (parallel to lockSecrets/proofYs)', () => {
		const proofs: Proof[] = [
			makeProof({ amount: 4, dleq: { e: 'e1', s: 's1', r: 'r1' } }),
			makeProof({ amount: 8, dleq: { e: 'e2', s: 's2', r: 'r2' } }),
			makeProof({ amount: 16, dleq: { e: 'e3', s: 's3', r: 'r3' } }),
		]
		const result = buildDleqProofs(proofs)
		expect(result.map((p) => p.amount)).toEqual([4, 8, 16])
	})

	test('throws when any locked proof lacks dleq (post-rollout fail-closed)', () => {
		const proofs: Proof[] = [makeProof({ amount: 1, dleq: { e: 'aa', s: 'bb', r: 'cc' } }), makeProof({ amount: 2, dleq: undefined })]
		expect(() => buildDleqProofs(proofs)).toThrow(/dleq/i)
	})

	test('throws when dleq.r is missing (blinding factor required for reblind verify)', () => {
		const proofs: Proof[] = [makeProof({ amount: 1, dleq: { e: 'aa', s: 'bb', r: undefined } })]
		expect(() => buildDleqProofs(proofs)).toThrow(/dleq/i)
	})

	test('returns empty array for empty proofs', () => {
		expect(buildDleqProofs([])).toEqual([])
	})
})
