import { describe, expect, test } from 'bun:test'
import { createCommitment } from '../commitment'
import { canonicalizeFakeMintIdentityInfo } from '../freshAuctionsdevBrowser'

const info = (time: number, pubkey = '02'.padEnd(66, '1')) => ({
	name: 'Plebeian Test Mint',
	pubkey,
	version: 'Nutshell/0.21.0',
	description: 'Local test mint for e2e tests',
	contact: [],
	time,
	max_array_length: 1000,
	nuts: { '7': { supported: true } },
})

describe('fake mint identity commitment', () => {
	test('normalizes the volatile NUT-06 server time without weakening the public identity', async () => {
		const first = canonicalizeFakeMintIdentityInfo(info(1_790_000_001))
		const second = canonicalizeFakeMintIdentityInfo(info(1_790_000_999))
		expect(first.time).toBe(0)
		expect(second.time).toBe(0)
		expect(await createCommitment('market-coco-v2-fake-mint-info-v1', first)).toBe(
			await createCommitment('market-coco-v2-fake-mint-info-v1', second),
		)
	})

	test('still commits identity-bearing fields such as the mint public key', async () => {
		const first = canonicalizeFakeMintIdentityInfo(info(1, '02'.padEnd(66, '1')))
		const second = canonicalizeFakeMintIdentityInfo(info(2, '03'.padEnd(66, '2')))
		expect(await createCommitment('market-coco-v2-fake-mint-info-v1', first)).not.toBe(
			await createCommitment('market-coco-v2-fake-mint-info-v1', second),
		)
	})

	test('rejects malformed or missing server time values', () => {
		for (const value of [null, [], { ...info(1), time: -1 }, { ...info(1), time: 1.5 }, { ...info(1), time: '1' }]) {
			expect(() => canonicalizeFakeMintIdentityInfo(value)).toThrow(/identity (document|time)/)
		}
	})
})
