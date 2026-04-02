import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { ContextVmClient } from '../contextvm-client'

const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:10547'
const SERVER_PUBKEY = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'

describe('ContextVmClient integration', () => {
	let client: ContextVmClient

	beforeAll(() => {
		client = new ContextVmClient({
			privateKey: crypto.getRandomValues(new Uint8Array(32)),
			relays: [RELAY_URL],
			serverPubkey: SERVER_PUBKEY,
		})
	})

	afterAll(() => {
		client.close()
	})

	test('callTool returns BTC rates with expected structure', async () => {
		const result = await client.callTool({
			name: 'get_btc_price',
			arguments: {},
		})

		expect(result).toBeDefined()
		expect(result.rates).toBeDefined()
		expect(typeof result.rates).toBe('object')
		expect(result.rates.USD).toBeGreaterThan(0)
		expect(result.rates.EUR).toBeGreaterThan(0)
		expect(result.rates.GBP).toBeGreaterThan(0)
		expect(result.fetchedAt).toBeGreaterThan(0)
		expect(Array.isArray(result.sourcesSucceeded)).toBe(true)
		expect(result.sourcesSucceeded.length).toBeGreaterThan(0)
	}, 10000)

	test('callTool returns rates for all 27 supported currencies', async () => {
		const result = await client.callTool({
			name: 'get_btc_price',
			arguments: {},
		})

		const expectedCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'SGD', 'HKD']
		for (const currency of expectedCurrencies) {
			expect(result.rates[currency], `Missing rate for ${currency}`).toBeGreaterThan(0)
		}
	}, 10000)

	test('callTool with get_btc_price_single returns rate for specific currency', async () => {
		const result = await client.callTool({
			name: 'get_btc_price_single',
			arguments: { currency: 'USD' },
		})

		expect(result).toBeDefined()
		expect(result.currency).toBe('USD')
		expect(typeof result.rate).toBe('number')
		expect(result.rate).toBeGreaterThan(0)
	}, 10000)

	test('callTool with get_btc_price_single returns error for invalid currency', async () => {
		await expect(
			client.callTool({
				name: 'get_btc_price_single',
				arguments: { currency: 'INVALID' },
			}),
		).rejects.toThrow(/Unsupported currency/)
	}, 10000)

	test('rates are reasonable (BTC between $10k and $500k)', async () => {
		const result = await client.callTool({
			name: 'get_btc_price',
			arguments: {},
		})

		expect(result.rates.USD).toBeGreaterThan(10000)
		expect(result.rates.USD).toBeLessThan(500000)
	}, 10000)
})
