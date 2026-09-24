import { describe, expect, test } from 'bun:test'
import { fetchBidNut7States } from './useNut7Polling'
import type { ParsedBidEvent } from './events'

describe('fetchBidNut7States Coco projection boundary', () => {
	test('skips a Coco projection without legacy proofYs without invoking the mint', async () => {
		let calls = 0
		const cocoProjection = {
			id: 'coco-bid',
			mint: 'https://fake-mint.example',
			proofYs: undefined,
		} as unknown as ParsedBidEvent

		const states = await fetchBidNut7States([cocoProjection], ['https://fake-mint.example'], async () => {
			calls += 1
			return new Map()
		})

		expect(calls).toBe(0)
		expect(states.size).toBe(0)
	})
})
