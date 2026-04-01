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

function createCoinDeskResponse(rates: Partial<Record<string, number>>) {
	return () =>
		jsonOk({
			Data: Object.fromEntries(Object.entries(rates).map(([code, value]) => [`BTC-${code}`, { VALUE: value }])),
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
			fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((_url: string) => {
				return new Promise<Response>((_resolve, reject) => {
					setTimeout(() => {
						reject(new TypeError('Failed to fetch'))
					}, 10)
				})
			}) as any)

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
		test('parses latest tick format and extracts requested fiat rates', async () => {
			mockFetch({
				'data-api.coindesk.com': createCoinDeskResponse({ USD: 100000, EUR: 92000, GBP: 78000 }),
			})

			const result = await fetchCoinDeskRates()

			expect(result.source).toBe('coindesk')
			expect(result.rates.USD).toBe(100000)
			expect(result.rates.EUR).toBe(92000)
			expect(result.rates.GBP).toBe(78000)
		})

		test('throws when response structure is wrong', async () => {
			mockFetch({
				'data-api.coindesk.com': () => jsonOk({ bpi: {} }),
				'data-api.cryptocompare.com': () => jsonOk({ bpi: {} }),
			})

			await expect(fetchCoinDeskRates()).rejects.toThrow('unexpected response format')
		})

		test('throws on non-200 response', async () => {
			mockFetch({
				'data-api.coindesk.com': () => new Response('error', { status: 503 }),
				'data-api.cryptocompare.com': () => new Response('error', { status: 503 }),
			})

			await expect(fetchCoinDeskRates()).rejects.toThrow('CoinDesk HTTP 503')
		})

		test('falls back to cryptocompare endpoint when coindesk host fails', async () => {
			mockFetch({
				'data-api.coindesk.com': () => new Response('error', { status: 503 }),
				'data-api.cryptocompare.com': createCoinDeskResponse({ USD: 100000, EUR: 92000 }),
			})

			const result = await fetchCoinDeskRates()

			expect(result.source).toBe('coindesk')
			expect(result.rates.USD).toBe(100000)
			expect(result.rates.EUR).toBe(92000)
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

	describe('endpoint contracts', () => {
		test('uses expected Yadio endpoint', async () => {
			const urls: string[] = []
			fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
				urls.push(url)
				return jsonOk({ BTC: { USD: 100000 } })
			}) as any)

			await fetchYadioRates()

			expect(urls).toHaveLength(1)
			expect(urls[0]).toBe('https://api.yadio.io/exrates/BTC')
		})

		test('uses CoinDesk Data API endpoint with expected query params', async () => {
			const urls: string[] = []
			fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
				urls.push(url)
				return jsonOk({ Data: { 'BTC-USD': { VALUE: 100000 } } })
			}) as any)

			await fetchCoinDeskRates()

			expect(urls).toHaveLength(1)
			const firstUrl = new URL(urls[0])
			expect(firstUrl.origin).toBe('https://data-api.coindesk.com')
			expect(firstUrl.pathname).toBe('/index/cc/v1/latest/tick')
			expect(firstUrl.searchParams.get('market')).toBe('ccix')
			expect(firstUrl.searchParams.get('groups')).toBe('VALUE')

			const instruments = firstUrl.searchParams.get('instruments') || ''
			for (const fiat of SUPPORTED_FIAT) {
				expect(instruments).toContain(`BTC-${fiat}`)
			}
		})

		test('falls back to cryptocompare host only after coindesk host fails', async () => {
			const urls: string[] = []
			fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
				urls.push(url)
				if (url.includes('data-api.coindesk.com')) {
					return new Response('error', { status: 503 })
				}
				if (url.includes('data-api.cryptocompare.com')) {
					return jsonOk({ Data: { 'BTC-USD': { VALUE: 100000 } } })
				}
				return new Response('not found', { status: 404 })
			}) as any)

			await fetchCoinDeskRates()

			expect(urls).toHaveLength(2)
			expect(urls[0]).toContain('data-api.coindesk.com')
			expect(urls[1]).toContain('data-api.cryptocompare.com')
		})

		test('uses expected CoinGecko endpoint with full fiat list', async () => {
			const urls: string[] = []
			fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
				urls.push(url)
				return jsonOk({ bitcoin: { usd: 100000 } })
			}) as any)

			await fetchCoinGeckoRates()

			expect(urls).toHaveLength(1)
			const endpoint = new URL(urls[0])
			expect(endpoint.origin).toBe('https://api.coingecko.com')
			expect(endpoint.pathname).toBe('/api/v3/simple/price')
			expect(endpoint.searchParams.get('ids')).toBe('bitcoin')

			const listed = (endpoint.searchParams.get('vs_currencies') || '').split(',')
			for (const fiat of SUPPORTED_FIAT) {
				expect(listed).toContain(fiat.toLowerCase())
			}
		})

		test('uses Binance ticker endpoint for BTCUSDT', async () => {
			const urls: string[] = []
			fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
				urls.push(url)
				if (url.includes('symbol=BTCUSDT')) {
					return jsonOk({ symbol: 'BTCUSDT', price: '100000' })
				}
				return new Response('error', { status: 500 })
			}) as any)

			await fetchBinanceRates()

			expect(urls.length).toBeGreaterThan(0)
			expect(urls[0]).toBe('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
		})
	})

	describe('fetchAllSources', () => {
		test('returns aggregated rates with median when all sources succeed', async () => {
			mockFetch({
				'api.yadio.io': createYadioResponse({ USD: 100000, EUR: 92000, GBP: 78000 }),
				'data-api.coindesk.com': createCoinDeskResponse({ USD: 100100, EUR: 92100, GBP: 78100 }),
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
				'data-api.coindesk.com': createCoinDeskResponse({ USD: 100100, EUR: 92100, GBP: 78000 }),
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
				'data-api.coindesk.com': () => new Response('error', { status: 500 }),
				'data-api.cryptocompare.com': () => new Response('error', { status: 500 }),
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
				'data-api.coindesk.com': () => new Response('error', { status: 500 }),
				'data-api.cryptocompare.com': () => new Response('error', { status: 500 }),
				'api.binance.com': () => new Response('error', { status: 500 }),
				'api.coingecko.com': () => new Response('error', { status: 500 }),
			})

			await expect(fetchAllSources()).rejects.toThrow('All 4 price sources failed')
		})

		test('works correctly when only 1 source succeeds', async () => {
			mockFetch({
				'api.yadio.io': createYadioResponse({ USD: 100000 }),
				'data-api.coindesk.com': () => new Response('error', { status: 500 }),
				'data-api.cryptocompare.com': () => new Response('error', { status: 500 }),
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
				'data-api.coindesk.com': createCoinDeskResponse({ USD: 100100, EUR: 92000, GBP: 78000 }),
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
