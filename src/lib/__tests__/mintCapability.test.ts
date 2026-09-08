import { describe, expect, test } from 'bun:test'
import type { CashuMint } from '@cashu/cashu-ts'
import { mintSupportsDleq } from '../cashu/mintCapability'

/**
 * Mint NUT-12 DLEQ capability probe — ADR-0011 Decision 4/5 (D1).
 *
 * `mintSupportsDleq` probes a mint's `/v1/info` advertisement and must be
 * fail-closed: any error, timeout, malformed response, or missing `"12"`
 * entry resolves to `false`, never a permissive `true`.
 */

/** Build a fake CashuMint whose `getInfo()` returns a caller-controlled object. */
function fakeMint(info: unknown): CashuMint {
	return { getInfo: async () => info } as unknown as CashuMint
}

const DLEQ_SUPPORTED = { nuts: { '12': { supported: true } } }
const DLEQ_UNSUPPORTED = { nuts: { '12': { supported: false } } }

describe('mintSupportsDleq', () => {
	test('returns true when the mint advertises NUT-12 DLEQ support', async () => {
		const mint = fakeMint(DLEQ_SUPPORTED)
		await expect(mintSupportsDleq('https://mint.example', { mintClient: mint })).resolves.toBe(true)
	})

	test('returns false when the mint advertises NUT-12 as unsupported', async () => {
		const mint = fakeMint(DLEQ_UNSUPPORTED)
		await expect(mintSupportsDleq('https://mint.example', { mintClient: mint })).resolves.toBe(false)
	})

	test('returns false when the nuts[12].supported field is undefined', async () => {
		const mint = fakeMint({ nuts: { '12': { supported: undefined } } })
		await expect(mintSupportsDleq('https://mint.example', { mintClient: mint })).resolves.toBe(false)
	})

	test('returns false when the nuts[12] entry is missing entirely', async () => {
		const mint = fakeMint({ nuts: {} })
		await expect(mintSupportsDleq('https://mint.example', { mintClient: mint })).resolves.toBe(false)
	})

	test('returns false when the nuts map itself is missing', async () => {
		const mint = fakeMint({})
		await expect(mintSupportsDleq('https://mint.example', { mintClient: mint })).resolves.toBe(false)
	})

	test('returns false (fail-closed) when getInfo rejects', async () => {
		const mint = {
			getInfo: async () => {
				throw new Error('network down')
			},
		} as unknown as CashuMint
		await expect(mintSupportsDleq('https://mint.example', { mintClient: mint })).resolves.toBe(false)
	})

	test('returns false (fail-closed) when getInfo hangs beyond the timeout', async () => {
		const mint = {
			getInfo: () =>
				new Promise((_resolve) => {
					// never resolves — simulate a hung mint
				}),
		} as unknown as CashuMint
		await expect(mintSupportsDleq('https://mint.example', { mintClient: mint, timeoutMs: 20 })).resolves.toBe(false)
	})

	test('returns false (fail-closed) when getInfo returns a malformed (non-object) response', async () => {
		const mint = fakeMint(null)
		await expect(mintSupportsDleq('https://mint.example', { mintClient: mint })).resolves.toBe(false)
	})
})
