import { describe, expect, test } from 'bun:test'
import { hashToCurveHex, hashToCurveHexFromString } from '../cashu/hashToCurve'

// NUT-00 official test vectors for hash_to_curve.
// Source: https://github.com/cashubtc/nuts/blob/main/tests/00-tests.md
// Input is the hex-encoded secret bytes; expected output is the
// compressed 33-byte point Y, lowercase hex.

const NUT00_VECTORS: Array<{ secretHex: string; expectedY: string }> = [
	{
		secretHex: '0000000000000000000000000000000000000000000000000000000000000000',
		expectedY: '024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725',
	},
	{
		secretHex: '0000000000000000000000000000000000000000000000000000000000000001',
		expectedY: '022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf',
	},
	{
		secretHex: '0000000000000000000000000000000000000000000000000000000000000002',
		expectedY: '026cdbe15362df59cd1dd3c9c11de8aedac2106eca69236ecd9fbe117af897be4f',
	},
]

const hexToBytes = (hex: string): Uint8Array => {
	const out = new Uint8Array(hex.length / 2)
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

describe('hashToCurve', () => {
	for (const vec of NUT00_VECTORS) {
		test(`NUT-00 vector: ${vec.secretHex.slice(0, 16)}... → ${vec.expectedY.slice(0, 16)}...`, () => {
			const Y = hashToCurveHex(hexToBytes(vec.secretHex))
			expect(Y).toBe(vec.expectedY)
		})
	}

	test('string convenience wrapper returns same result as the bytes form', () => {
		// "hello" as UTF-8 bytes → hash_to_curve → should match the bytes path
		const fromString = hashToCurveHexFromString('hello')
		const fromBytes = hashToCurveHex(new TextEncoder().encode('hello'))
		expect(fromString).toBe(fromBytes)
	})

	test('returns a 66-char compressed pubkey hex', () => {
		const Y = hashToCurveHexFromString('arbitrary auction lock secret')
		expect(Y).toMatch(/^0[23][0-9a-f]{64}$/)
	})

	test('different secrets produce different Y values', () => {
		const a = hashToCurveHexFromString('secret-a')
		const b = hashToCurveHexFromString('secret-b')
		expect(a).not.toBe(b)
	})

	test('same secret produces same Y value (deterministic)', () => {
		const a = hashToCurveHexFromString('same input')
		const b = hashToCurveHexFromString('same input')
		expect(a).toBe(b)
	})
})
