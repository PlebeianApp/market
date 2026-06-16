/**
 * Cross-check our `hash_to_curve` implementation against cashu-ts's own
 * `hashToCurve` on a battery of representative inputs.
 *
 * The motivation: validators that poll the mint via NUT-7 look up
 * proofs by `Y = hash_to_curve(secret)`. If our Y doesn't match the
 * mint's index for a proof we just minted, every poll comes back
 * `unknown` and the validator stays in `bid_pending_review` forever.
 *
 * We've verified the algorithms line up by reading both sources:
 *   - Ours: src/lib/cashu/hashToCurve.ts
 *   - cashu-ts: @cashu/cashu-ts/crypto/common
 * — but a byte-level cross-check on real auction-shaped P2PK secret
 * strings is much stronger than a code review.
 *
 * If this test ever fails, the validator's nut7_unknown verdicts on
 * legitimate bids are explained: our Y disagrees with the mint's.
 */

import { describe, expect, test } from 'bun:test'
import { hashToCurve as cashuTsHashToCurve } from '@cashu/cashu-ts/crypto/common'
import { hashToCurveHex, hashToCurveHexFromString } from '../cashu/hashToCurve'

const enc = new TextEncoder()

const compressedHexFromCashuTsPoint = (point: ReturnType<typeof cashuTsHashToCurve>): string => {
	// cashu-ts returns a WeierstrassPoint from @noble/curves. Its
	// `toBytes(true)` method returns the 33-byte compressed
	// serialisation. Fall back to `toRawBytes(true)` for older
	// noble versions; both produce the same wire bytes.
	const anyPoint = point as unknown as {
		toBytes?: (compressed: boolean) => Uint8Array
		toRawBytes?: (compressed: boolean) => Uint8Array
	}
	const compressed = anyPoint.toBytes
		? anyPoint.toBytes(true)
		: anyPoint.toRawBytes
			? anyPoint.toRawBytes(true)
			: (() => {
					throw new Error('cashu-ts hashToCurve return value has neither toBytes nor toRawBytes')
				})()
	let out = ''
	for (let i = 0; i < compressed.length; i++) out += compressed[i].toString(16).padStart(2, '0')
	return out
}

const cases: Array<{ label: string; secret: string }> = [
	// NUT-00 vector 1 (an arbitrary 32-hex-char secret, exactly as a
	// Cashu wallet would emit pre-NUT-10).
	{ label: 'plain 32-hex-char secret', secret: '0000000000000000000000000000000000000000000000000000000000000000' },
	{ label: 'nonzero 32-hex secret', secret: '0000000000000000000000000000000000000000000000000000000000000001' },
	// A realistic NUT-10 P2PK secret shape — what the auction lock
	// flow produces. We test multiple variants because JSON encoding
	// is sensitive to whitespace + key ordering and the validator
	// reads `lock_secret` verbatim from the bid event tag.
	{
		label: 'NUT-10 P2PK secret (compact, sorted keys)',
		secret:
			'["P2PK",{"data":"0233d97a36ef9dde0fbc4d50f9e89a2f37c8ba3dc89dcc88e7ae0a7a17e7fbdd02","nonce":"abc123","tags":[["sigflag","SIG_INPUTS"],["locktime","1735689600"],["refund","039b3f3a1aaa1d5ffd72c3b5d8e8e5a1a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a01a"],["n_sigs_refund","1"]]}]',
	},
	{
		label: 'NUT-10 P2PK secret (Cashu-ts canonical key order: nonce, data, tags)',
		secret:
			'["P2PK",{"nonce":"abc123","data":"0233d97a36ef9dde0fbc4d50f9e89a2f37c8ba3dc89dcc88e7ae0a7a17e7fbdd02","tags":[["sigflag","SIG_INPUTS"],["locktime","1735689600"],["refund","039b3f3a1aaa1d5ffd72c3b5d8e8e5a1a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a01a"],["n_sigs_refund","1"]]}]',
	},
	{
		label: 'long random ASCII',
		secret:
			'the quick brown fox jumps over the lazy dog. the quick brown fox jumps over the lazy dog. the quick brown fox jumps over the lazy dog.',
	},
	{
		label: 'UTF-8 multi-byte chars',
		secret: 'café — naïve — résumé — 日本語 — 🦊',
	},
	{
		label: 'embedded whitespace + newlines',
		secret: '   leading   \n   middle   \n   trailing   ',
	},
	{
		label: 'single byte',
		secret: 'a',
	},
	{
		label: 'empty string',
		secret: '',
	},
]

describe('hash_to_curve: our impl vs @cashu/cashu-ts', () => {
	for (const c of cases) {
		test(c.label, () => {
			const oursHex = hashToCurveHexFromString(c.secret)
			const theirsPoint = cashuTsHashToCurve(enc.encode(c.secret))
			const theirsHex = compressedHexFromCashuTsPoint(theirsPoint)
			expect(oursHex.toLowerCase()).toBe(theirsHex.toLowerCase())
		})
	}

	test('byte-identical for an explicitly-constructed Uint8Array', () => {
		const bytes = new Uint8Array([0x00, 0x01, 0xff, 0x7f, 0x80, 0x42])
		const oursHex = hashToCurveHex(bytes)
		const theirsHex = compressedHexFromCashuTsPoint(cashuTsHashToCurve(bytes))
		expect(oursHex.toLowerCase()).toBe(theirsHex.toLowerCase())
	})
})
