import { describe, expect, test } from 'bun:test'
import { fetchBidNut7States } from './useNut7Polling'
import type { ParsedBidEvent } from './events'

describe('fetchBidNut7States projection boundary', () => {
	test('reads mint-reported state for a parsed bid and calls the mint once', async () => {
		const calls: Array<{ mintUrl: string; proofYs: string[] }> = []
		const parsedBid = {
			id: 'parsed-bid',
			mint: 'https://fake-mint.example',
			proofYs: ['02' + 'a'.repeat(64)],
		} as unknown as ParsedBidEvent

		const states = await fetchBidNut7States([parsedBid], ['https://fake-mint.example'], async (mintUrl, proofYs) => {
			calls.push({ mintUrl, proofYs })
			return new Map(proofYs.map((proofY) => [proofY.toLowerCase(), 'unspent' as const]))
		})

		expect(calls).toHaveLength(1)
		expect(calls[0]?.mintUrl).toBe('https://fake-mint.example')
		expect(states.get('parsed-bid')).toBe('unspent')
	})

	test('skips a projection without legacy proofYs without invoking the mint', async () => {
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

	// The seller dashboard used to hand this reader the raw `useAuctionBids()`
	// result. A raw relay event carries neither `mint` nor `proofYs`, so every
	// bid was skipped and the returned map stayed empty — while
	// `computeValidatedBids` keeps a bid valid when it has no NUT-7 entry
	// (bidValidation.ts "No NUT-7 evidence, or unspent → valid"). This pins the
	// silent shape so the call site has to pass parsed bids.
	test('a raw relay event shape yields no evidence instead of mint traffic', async () => {
		let calls = 0
		const rawEvent = { id: 'raw-event', tags: [], content: '', sig: 'x'.repeat(128) } as unknown as ParsedBidEvent

		const states = await fetchBidNut7States([rawEvent, rawEvent], ['https://fake-mint.example'], async () => {
			calls += 1
			return new Map()
		})

		expect(calls).toBe(0)
		expect(states.size).toBe(0)
	})
})
