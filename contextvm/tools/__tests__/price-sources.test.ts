import { describe, test, expect, afterEach, spyOn } from 'bun:test'
import {
	fetchYadioRates,
	fetchCoinDeskRates,
	fetchBinanceRates,
	fetchCoinGeckoRates,
	fetchAllSources,
	SUPPORTED_FIAT,
	type AggregatedRates,
} from '../price-sources'

let fetchSpy: ReturnType<typeof spyOn>

function mockFetch(responses: Record<string, () => Response | Promise<Response>>) {
	const handler = async (url: string, init?: RequestInit): Promise<Response> => {
		const matcher = Object.keys(responses).find((key) => url.includes(key))
		if (matcher) {
			const resp = responses[matcher]()
			return resp instanceof Promise ? resp : resp
		}
		return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
	}
	fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(handler as any)
}

function restoreFetch() {
	if (fetchSpy) {
		fetchSpy.mockRestore()
		fetchSpy = undefined as any
	}
}

function jsonOk(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

function createYadioResponse(rates: Record<string, number>) {
	return () => jsonOk({ BTC: rates })
}

function createCoinDeskResponse(usd: number, eur: number, gbp: number) {
	return () =>
		jsonOk({
			bpi: {
				USD: { code: 'USD', rate: usd.toLocaleString(), rate_float: usd, description: 'US Dollar' },
				EUR: { code: 'EUR', rate: eur.toLocaleString(), rate_float: eur, description: 'Euro' },
				GBP: { code: 'GBP', rate: gbp.toLocaleString(), rate_float: gbp, description: 'British Pound' },
			},
			time: { updated: 'test', updatedISO: 'test' },
		})
}

function createBinanceUsdtResponse(price: number) {
	return () => jsonOk({ symbol: 'BTCUSDT', price: price.toString() })
}

function createBinancePairResponse(price: number) {
	return () => jsonOk({ symbol: 'BTCEUR', price: price.toString() })
}

function createCoinGeckoResponse(rates: Record<string, number>) {
	return () => jsonOk({ bitcoin: rates })
}

const MOCK_YADIO_RATES: Record<string, number> = {
	USD: 100000,
	EUR: 92000,
	GBP: 78000,
	CHF: 88000,
	JPY: 15000000,
	CNY: 720000,
	AUD: 155000,
	CAD: 137000,
	HKD: 780000,
	SGD: 135000,
	INR: 8300000,
	MXN: 1700000,
	RUB: 9200000,
	BRL: 490000,
	TRY: 3200000,
	KRW: 135000000,
	ZAR: 1800000,
	ARS: 87000000,
	CLP: 90000000,
	COP: 390000000,
	PEN: 370000,
	UYU: 4000000,
	PHP: 5800000,
	THB: 3500000,
	IDR: 1560000000,
	MYR: 470000,
	NGN: 155000000,
}

describe('price-sources', () => {
	afterEach(() => {
		restoreFetch()
	})

	describe('fetchYadioRates', () => {
		test('returns correct rates when API responds with valid data', async () => {
			mockFetch({ 'api.yadio.io': createYadioResponse(MOCK_YADIO_RATES) })

			const result = await fetchYadioRates()

			expect(result.source).toBe('yadio')
			expect(result.rates.USD).toBe(100000)
			expect(result.rates.EUR).toBe(92000)
			expect(result.rates.GBP).toBe(78000)
			expect(result.fetchedAt).toBeGreaterThan(0)
		})

		test('throws on non-200 response', async () => {
			mockFetch({ 'api.yadio.io': () => new Response('error', { status: 500 }) })

			await expect(fetchYadioRates()).rejects.toThrow('Yadio HTTP 500')
		})

		test('throws on timeout', async () => {
			fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((_url: string) => {
				return new Promise<Response>((_resolve, reject) => {
					setTimeout(() => {
						reject(new TypeError('Failed to fetch'))
					}, 10)
				})
			})

			await expect(fetchYadioRates()).rejects.toThrow()
		})

		test('skips currencies with zero or missing values', async () => {
			mockFetch({
				'api.yadio.io': createYadioResponse({ USD: 100000, EUR: 0, GBP: -1 }),
			})

			const result = await fetchYadioRates()

			expect(result.rates.USD).toBe(100000)
			expect(result.rates.EUR).toBeUndefined()
			expect(result.rates.GBP).toBeUndefined()
		})
	})

	describe('fetchCoinDeskRates', () => {
		test('parses BPI format and extracts USD/EUR/GBP', async () => {
			mockFetch({
				'api.coindesk.com': createCoinDeskResponse(100000, 92000, 78000),
			})

			const result = await fetchCoinDeskRates()

			expect(result.source).toBe('coindesk')
			expect(result.rates.USD).toBe(100000)
			expect(result.rates.EUR).toBe(92000)
			expect(result.rates.GBP).toBe(78000)
		})

		test('throws when bpi structure is wrong', async () => {
			mockFetch({
				'api.coindesk.com': () => jsonOk({ bpi: {} }),
			})

			const result = await fetchCoinDeskRates()

			expect(result.source).toBe('coindesk')
			expect(Object.keys(result.rates).length).toBe(0)
		})

		test('throws on non-200 response', async () => {
			mockFetch({
				'api.coindesk.com': () => new Response('error', { status: 503 }),
			})

			await expect(fetchCoinDeskRates()).rejects.toThrow('CoinDesk HTTP 503')
		})
	})

	describe('fetchBinanceRates', () => {
		test('parses BTCUSDT price', async () => {
			mockFetch({
				'api.binance.com/api/v3/ticker/price?symbol=BTCUSDT': createBinanceUsdtResponse(100500),
				BTCEUR: createBinancePairResponse(92500),
				BTCCAD: createBinancePairResponse(137500),
			})

			const result = await fetchBinanceRates()

			expect(result.source).toBe('binance')
			expect(result.rates.USD).toBe(100500)
		})

		test('throws when price is not a string', async () => {
			mockFetch({
				'api.binance.com/api/v3/ticker/price?symbol=BTCUSDT': () => jsonOk({ price: 12345 }),
			})

			await expect(fetchBinanceRates()).rejects.toThrow('unexpected response format')
		})

		test('throws when price is zero or invalid', async () => {
			mockFetch({
				'api.binance.com/api/v3/ticker/price?symbol=BTCUSDT': () => jsonOk({ price: '0' }),
			})

			await expect(fetchBinanceRates()).rejects.toThrow('invalid price')
		})

		test('returns USD even when cross pairs fail', async () => {
			mockFetch({
				BTCUSDT: createBinanceUsdtResponse(100500),
				'api.binance.com': () => new Response('error', { status: 500 }),
			})

			const result = await fetchBinanceRates()

			expect(result.rates.USD).toBe(100500)
		})

		test('throws on non-200 response for main pair', async () => {
			mockFetch({
				'api.binance.com/api/v3/ticker/price?symbol=BTCUSDT': () => new Response('error', { status: 429 }),
			})

			await expect(fetchBinanceRates()).rejects.toThrow('Binance HTTP 429')
		})
	})

	describe('fetchCoinGeckoRates', () => {
		test('parses all fiat currencies from response', async () => {
			const rates: Record<string, number> = {}
			for (const code of SUPPORTED_FIAT) {
				rates[code.toLowerCase()] = Math.random() * 1000000
			}
			mockFetch({
				'api.coingecko.com': createCoinGeckoResponse(rates),
			})

			const result = await fetchCoinGeckoRates()

			expect(result.source).toBe('coingecko')
			expect(Object.keys(result.rates).length).toBe(SUPPORTED_FIAT.length)
			for (const code of SUPPORTED_FIAT) {
				expect(result.rates[code]).toBe(rates[code.toLowerCase()])
			}
		})

		test('throws when bitcoin object is missing', async () => {
			mockFetch({
				'api.coingecko.com': () => jsonOk({ ethereum: { usd: 3000 } }),
			})

			await expect(fetchCoinGeckoRates()).rejects.toThrow('unexpected response format')
		})

		test('throws on non-200 response', async () => {
			mockFetch({
				'api.coingecko.com': () => new Response('rate limited', { status: 429 }),
			})

			await expect(fetchCoinGeckoRates()).rejects.toThrow('CoinGecko HTTP 429')
		})

		test('skips currencies with zero values', async () => {
			mockFetch({
				'api.coingecko.com': createCoinGeckoResponse({ usd: 100000, eur: 0, jpy: -5 }),
			})

			const result = await fetchCoinGeckoRates()

			expect(result.rates.USD).toBe(100000)
			expect(result.rates.EUR).toBeUndefined()
			expect(result.rates.JPY).toBeUndefined()
		})
	})

	describe('fetchAllSources', () => {
		test('returns aggregated rates with median when all sources succeed', async () => {
			mockFetch({
				'api.yadio.io': createYadioResponse({ USD: 100000, EUR: 92000, GBP: 78000 }),
				'api.coindesk.com': createCoinDeskResponse(100100, 92100, 78100),
				'api.binance.com/api/v3/ticker/price?symbol=BTCUSDT': createBinanceUsdtResponse(100200),
				'api.coingecko.com': createCoinGeckoResponse({ usd: 100300, eur: 92300, gbp: 78300 }),
			})

			const result = await fetchAllSources()

			expect(result.sourcesSucceeded).toEqual(['yadio', 'coindesk', 'binance', 'coingecko'])
			expect(result.sourcesFailed).toEqual([])
			expect(result.sources).toEqual(['yadio', 'coindesk', 'binance', 'coingecko'])
			expect(result.rates.USD).toBe(100150)
			expect(result.fetchedAt).toBeGreaterThan(0)
		})

		test('calculates median correctly for even number of values', async () => {
			mockFetch({
				'api.yadio.io': createYadioResponse({ USD: 100000, EUR: 92000 }),
				'api.coindesk.com': createCoinDeskResponse(100100, 92100, 78000),
				'api.binance.com/api/v3/ticker/price?symbol=BTCUSDT': createBinanceUsdtResponse(100200),
				'api.coingecko.com': createCoinGeckoResponse({ usd: 100300, eur: 92300 }),
			})

			const result = await fetchAllSources()

			expect(result.rates.USD).toBe(100150)
			expect(result.rates.EUR).toBe(92100)
		})

		test('calculates median correctly for odd number of values', async () => {
			mockFetch({
				'api.yadio.io': createYadioResponse({ USD: 100000 }),
				'api.binance.com/api/v3/ticker/price?symbol=BTCUSDT': createBinanceUsdtResponse(100200),
				'api.coingecko.com': createCoinGeckoResponse({ usd: 100300 }),
			})

			const result = await fetchAllSources()

			expect(result.rates.USD).toBe(100200)
		})

		test('returns rates from successful sources when some fail', async () => {
			mockFetch({
				'api.yadio.io': createYadioResponse({ USD: 100000, EUR: 92000 }),
				'api.coindesk.com': () => new Response('error', { status: 500 }),
				'api.binance.com/api/v3/ticker/price?symbol=BTCUSDT': createBinanceUsdtResponse(100200),
				'api.coingecko.com': createCoinGeckoResponse({ usd: 100300, eur: 92300 }),
			})

			const result = await fetchAllSources()

			expect(result.sourcesSucceeded).toEqual(['yadio', 'binance', 'coingecko'])
			expect(result.sourcesFailed.length).toBe(1)
			expect(result.sourcesFailed[0]).toContain('CoinDesk HTTP 500')
			expect(result.rates.USD).toBe(100200)
		})

		test('throws when all sources fail', async () => {
			mockFetch({
				'api.yadio.io': () => new Response('error', { status: 500 }),
				'api.coindesk.com': () => new Response('error', { status: 500 }),
				'api.binance.com': () => new Response('error', { status: 500 }),
				'api.coingecko.com': () => new Response('error', { status: 500 }),
			})

			await expect(fetchAllSources()).rejects.toThrow('All 4 price sources failed')
		})

		test('works correctly when only 1 source succeeds', async () => {
			mockFetch({
				'api.yadio.io': createYadioResponse({ USD: 100000 }),
				'api.coindesk.com': () => new Response('error', { status: 500 }),
				'api.binance.com': () => new Response('error', { status: 500 }),
				'api.coingecko.com': () => new Response('error', { status: 500 }),
			})

			const result = await fetchAllSources()

			expect(result.sourcesSucceeded).toEqual(['yadio'])
			expect(result.sourcesFailed.length).toBe(3)
			expect(result.rates.USD).toBe(100000)
		})

		test('includes currencies available from at least one source', async () => {
			mockFetch({
				'api.yadio.io': createYadioResponse({ USD: 100000 }),
				'api.coindesk.com': createCoinDeskResponse(100100, 92000, 78000),
				'api.binance.com/api/v3/ticker/price?symbol=BTCUSDT': createBinanceUsdtResponse(100200),
				'api.coingecko.com': createCoinGeckoResponse({ usd: 100300 }),
			})

			const result = await fetchAllSources()

			expect(result.rates.USD).toBeDefined()
			expect(result.rates.EUR).toBeDefined()
			expect(result.rates.GBP).toBeDefined()
		})
	})
})
