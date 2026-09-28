import { describe, expect, test } from 'bun:test'
import { fetchBidNut7States } from './useNut7Polling'
import type { ParsedBidEvent } from './events'

describe('fetchBidNut7States projection boundary', () => {
	test('skips a projection without the legacy proofYs array without invoking the mint', async () => {
		let calls = 0
		const bidWithoutProofs = {
			id: 'bid-without-proofs',
			mint: 'https://fake-mint.example',
			proofYs: undefined,
		} as unknown as ParsedBidEvent

		const states = await fetchBidNut7States([bidWithoutProofs], ['https://fake-mint.example'], async () => {
			calls += 1
			return new Map()
		})

		expect(calls).toBe(0)
		expect(states.size).toBe(0)
	})
})
