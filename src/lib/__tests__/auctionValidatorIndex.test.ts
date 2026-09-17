import { describe, expect, test } from 'bun:test'
import { startAuctionValidator } from '../../server/auction-validator'

describe('auction validator startup policy resolution', () => {
	test('returns and reuses one resolved spam policy object', async () => {
		const logs: unknown[][] = []
		let publishedContent = ''
		const handle = await startAuctionValidator({
			signer: {
				getPublicKey: async () => 'a'.repeat(64),
				signEvent: async (template: any) => ({
					...template,
					id: '1'.repeat(64),
					pubkey: 'a'.repeat(64),
					sig: '2'.repeat(128),
				}),
			} as any,
			relayPool: {
				subscribe: async (_filters: unknown[], _handler: (event: unknown) => void, onEose?: () => void) => {
					onEose?.()
					return () => undefined
				},
				publish: async (event: { content?: string }) => {
					publishedContent = event.content ?? ''
				},
			} as any,
			spamPolicy: { maxBidsPerWindow: 3, maxTagCount: 9 },
			logger: {
				info: (...args: unknown[]) => logs.push(args),
				warn: (...args: unknown[]) => logs.push(args),
				error: (...args: unknown[]) => logs.push(args),
			},
		})

		expect(handle.spamPolicy.maxBidsPerWindow).toBe(3)
		expect(handle.spamPolicy.maxTagCount).toBe(9)
		expect(handle.spamPolicy.rateWindowSec).toBe(60)
		expect(publishedContent).toContain('"maxBidsPerWindow":3')
		expect(publishedContent).toContain('"maxTagCount":9')
		expect(logs.some((args) => args[0] === '[validator] resolved admission policy')).toBe(true)

		await handle.stop()
	})
})