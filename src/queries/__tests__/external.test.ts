import { describe, test, expect, afterEach, mock, spyOn } from 'bun:test'

const originalWarn = console.warn
const originalError = console.error
console.warn = () => {}
console.error = () => {}

mock.module('@/lib/ctxcn-client', () => ({
	PlebianCurrencyClient: class {
		constructor() {
			throw new Error('mocked: no real relay connections in tests')
		}
	},
}))

import { convertCurrencyToSats, fetchBtcExchangeRates } from '../external'

const ORIGINAL_FETCH = globalThis.fetch

const MOCK_RATES: Record<string, number> = {
	SATS: 1,
	BTC: 1,
	USD: 100000,
	EUR: 92000,
	GBP: 78000,
	JPY: 15000000,
}

function mockGlobalFetch(responses: Record<string, () => Response | Promise<Response>>) {
	const handler = async (url: string, init?: RequestInit): Promise<Response> => {
		for (const [key, factory] of Object.entries(responses)) {
			if (url.includes(key)) {
				const resp = factory()
				return resp instanceof Promise ? resp : resp
			}
		}
		return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
	}
	globalThis.fetch = mock(handler)
}

function jsonOk(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

describe('external.tsx - fetchBtcExchangeRates', () => {
	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH
	})

	test('fetches fresh rates from Yadio when ContextVM is unavailable', async () => {
		mockGlobalFetch({
			'api.yadio.io': () => jsonOk({ BTC: { USD: 102000, EUR: 94000, GBP: 80000 } }),
		})

		const result = await fetchBtcExchangeRates()

		expect(result.USD).toBe(102000)
		expect(result.EUR).toBe(94000)
		expect(result.GBP).toBe(80000)
	})

	test('throws when both ContextVM and Yadio fail', async () => {
		mockGlobalFetch({
			'api.yadio.io': () => new Response('error', { status: 500 }),
		})

		await expect(fetchBtcExchangeRates()).rejects.toThrow('Failed to fetch BTC exchange rates')
	})

	test('throws when Yadio returns non-JSON error', async () => {
		mockGlobalFetch({
			'api.yadio.io': () => new Response('Service Unavailable', { status: 503 }),
		})

		await expect(fetchBtcExchangeRates()).rejects.toThrow('Failed to fetch BTC exchange rates')
	})

	test('does not cache rates in localStorage', async () => {
		mockGlobalFetch({
			'api.yadio.io': () => jsonOk({ BTC: { USD: 103000 } }),
		})

		await fetchBtcExchangeRates()

		const stored = globalThis.localStorage?.getItem('btc_exchange_rates')
		expect(stored).toBeUndefined()
	})

	test('always fetches fresh rates on every call', async () => {
		let callCount = 0
		mockGlobalFetch({
			'api.yadio.io': () => {
				callCount++
				return jsonOk({ BTC: { USD: 100000 + callCount * 1000 } })
			},
		})

		const result1 = await fetchBtcExchangeRates()
		const result2 = await fetchBtcExchangeRates()
		const result3 = await fetchBtcExchangeRates()

		expect(result1.USD).toBe(101000)
		expect(result2.USD).toBe(102000)
		expect(result3.USD).toBe(103000)
		expect(callCount).toBe(3)
	})
})

describe('external.tsx - convertCurrencyToSats', () => {
	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH
	})

	test('returns amount directly for sats currency', async () => {
		const result = await convertCurrencyToSats('sats', 5000)
		expect(result).toBe(5000)
	})

	test('returns amount directly for SATS currency (uppercase)', async () => {
		const result = await convertCurrencyToSats('SATS', 5000)
		expect(result).toBe(5000)
	})

	test('returns amount directly for sat currency', async () => {
		const result = await convertCurrencyToSats('sat', 1000)
		expect(result).toBe(1000)
	})

	test('returns null for empty currency', async () => {
		const result = await convertCurrencyToSats('', 100)
		expect(result).toBeNull()
	})

	test('returns null for zero amount', async () => {
		const result = await convertCurrencyToSats('USD', 0)
		expect(result).toBeNull()
	})

	test('returns null for negative amount', async () => {
		const result = await convertCurrencyToSats('USD', -50)
		expect(result).toBeNull()
	})

	test('returns null for very small amount', async () => {
		const result = await convertCurrencyToSats('USD', 0.00001)
		expect(result).toBeNull()
	})

	test('returns null for unsupported currency', async () => {
		const result = await convertCurrencyToSats('XYZ', 100)
		expect(result).toBeNull()
	})

	test('converts USD to sats correctly', async () => {
		mockGlobalFetch({
			'api.yadio.io': () => jsonOk({ BTC: MOCK_RATES }),
		})

		const result = await convertCurrencyToSats('USD', 100)

		expect(result).not.toBeNull()
		const sats = result!
		const expectedSats = (100 / 100000) * 100000000
		expect(sats).toBe(expectedSats)
	})

	test('converts EUR to sats correctly', async () => {
		mockGlobalFetch({
			'api.yadio.io': () => jsonOk({ BTC: MOCK_RATES }),
		})

		const result = await convertCurrencyToSats('EUR', 92)

		expect(result).not.toBeNull()
		const sats = result!
		const expectedSats = (92 / 92000) * 100000000
		expect(sats).toBe(expectedSats)
	})

	test('handles currency case insensitively', async () => {
		mockGlobalFetch({
			'api.yadio.io': () => jsonOk({ BTC: MOCK_RATES }),
		})

		const result = await convertCurrencyToSats('usd', 50)

		expect(result).not.toBeNull()
		const sats = result!
		const expectedSats = (50 / 100000) * 100000000
		expect(sats).toBe(expectedSats)
	})

	test('returns null when exchange rate fetch fails', async () => {
		mockGlobalFetch({
			'api.yadio.io': () => new Response('error', { status: 500 }),
		})

		const result = await convertCurrencyToSats('USD', 100)
		expect(result).toBeNull()
	})
})
