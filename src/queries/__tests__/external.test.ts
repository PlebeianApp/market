import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	},
	writable: true,
})

mock.module('@contextvm/sdk', () => ({
	NostrClientTransport: class {
		constructor() {
			throw new Error('mocked: no real relay connections in tests')
		}
	},
	PrivateKeySigner: class {
		constructor() {
			throw new Error('mocked: no real relay connections in tests')
		}
	},
	ApplesauceRelayPool: class {
		constructor() {
			throw new Error('mocked: no real relay connections in tests')
		}
	},
}))

mock.module('@modelcontextprotocol/sdk/client', () => ({
	Client: class {
		constructor() {
			throw new Error('mocked: no real relay connections in tests')
		}
	},
}))

import { convertCurrencyToSats, fetchBtcExchangeRates, CURRENCY_CACHE_CONFIG } from '../external'

const ORIGINAL_FETCH = globalThis.fetch
const EXCHANGE_RATES_CACHE_KEY = 'btc_exchange_rates'

const MOCK_RATES: Record<string, number> = {
	SATS: 1,
	BTC: 1,
	USD: 100000,
	EUR: 92000,
	GBP: 78000,
	JPY: 15000000,
}

function setCachedRates(rates: Record<string, number>, ageMs = 0) {
	const cacheData = {
		rates,
		timestamp: Date.now() - ageMs,
	}
	localStorage.setItem(EXCHANGE_RATES_CACHE_KEY, JSON.stringify(cacheData))
}

function clearCachedRates() {
	localStorage.removeItem(EXCHANGE_RATES_CACHE_KEY)
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
	beforeEach(() => {
		storage.clear()
	})

	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH
		storage.clear()
	})

	test('returns cached rates from localStorage without network call', async () => {
		setCachedRates(MOCK_RATES, 0)

		const result = await fetchBtcExchangeRates()

		expect(result.USD).toBe(100000)
		expect(result.EUR).toBe(92000)
		expect(result.GBP).toBe(78000)
	})

	test('ignores expired cache (older than STALE_TIME)', async () => {
		setCachedRates(MOCK_RATES, CURRENCY_CACHE_CONFIG.STALE_TIME + 1000)

		mockGlobalFetch({
			'api.yadio.io': () => jsonOk({ BTC: { USD: 101000, EUR: 93000 } }),
		})

		const result = await fetchBtcExchangeRates()

		expect(result.USD).toBe(101000)
		expect(result.EUR).toBe(93000)
	})

	test('falls back to Yadio API when ContextVM is unavailable', async () => {
		clearCachedRates()

		mockGlobalFetch({
			'api.yadio.io': () => jsonOk({ BTC: { USD: 102000, EUR: 94000, GBP: 80000 } }),
		})

		const result = await fetchBtcExchangeRates()

		expect(result.USD).toBe(102000)
		expect(result.EUR).toBe(94000)
		expect(result.GBP).toBe(80000)
	})

	test('throws when both ContextVM and Yadio fail', async () => {
		clearCachedRates()

		mockGlobalFetch({
			'api.yadio.io': () => new Response('error', { status: 500 }),
		})

		await expect(fetchBtcExchangeRates()).rejects.toThrow('Failed to fetch BTC exchange rates')
	})

	test('caches successful Yadio fetch in localStorage', async () => {
		clearCachedRates()

		mockGlobalFetch({
			'api.yadio.io': () => jsonOk({ BTC: { USD: 103000 } }),
		})

		await fetchBtcExchangeRates()

		const stored = localStorage.getItem(EXCHANGE_RATES_CACHE_KEY)
		expect(stored).not.toBeNull()
		const parsed = JSON.parse(stored!)
		expect(parsed.rates.USD).toBe(103000)
		expect(parsed.timestamp).toBeGreaterThan(0)
	})
})

describe('external.tsx - convertCurrencyToSats', () => {
	beforeEach(() => {
		storage.clear()
	})

	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH
		storage.clear()
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
		setCachedRates(MOCK_RATES)

		const result = await convertCurrencyToSats('USD', 100)

		expect(result).not.toBeNull()
		const sats = result!
		const expectedSats = (100 / 100000) * 100000000
		expect(sats).toBe(expectedSats)
	})

	test('converts EUR to sats correctly', async () => {
		setCachedRates(MOCK_RATES)

		const result = await convertCurrencyToSats('EUR', 92)

		expect(result).not.toBeNull()
		const sats = result!
		const expectedSats = (92 / 92000) * 100000000
		expect(sats).toBe(expectedSats)
	})

	test('handles currency case insensitively', async () => {
		setCachedRates(MOCK_RATES)

		const result = await convertCurrencyToSats('usd', 50)

		expect(result).not.toBeNull()
		const sats = result!
		const expectedSats = (50 / 100000) * 100000000
		expect(sats).toBe(expectedSats)
	})

	test('returns null when exchange rate fetch fails', async () => {
		clearCachedRates()

		mockGlobalFetch({
			'api.yadio.io': () => new Response('error', { status: 500 }),
		})

		const result = await convertCurrencyToSats('USD', 100)
		expect(result).toBeNull()
	})
})
