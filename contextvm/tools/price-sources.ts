const FETCH_TIMEOUT_MS = 5000

const SUPPORTED_FIAT = [
	'USD',
	'EUR',
	'JPY',
	'GBP',
	'CHF',
	'CNY',
	'AUD',
	'CAD',
	'HKD',
	'SGD',
	'INR',
	'MXN',
	'RUB',
	'BRL',
	'TRY',
	'KRW',
	'ZAR',
	'ARS',
	'CLP',
	'COP',
	'PEN',
	'UYU',
	'PHP',
	'THB',
	'IDR',
	'MYR',
	'NGN',
] as const

type FiatCode = (typeof SUPPORTED_FIAT)[number]

interface SourceResult {
	source: string
	rates: Partial<Record<FiatCode, number>>
	fetchedAt: number
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetch(url, { signal: controller.signal })
		return response
	} finally {
		clearTimeout(timer)
	}
}

export async function fetchYadioRates(): Promise<SourceResult> {
	const response = await fetchWithTimeout('https://api.yadio.io/exrates/BTC')
	if (!response.ok) throw new Error(`Yadio HTTP ${response.status}`)
	const data = await response.json()
	const rates: Partial<Record<FiatCode, number>> = {}
	for (const code of SUPPORTED_FIAT) {
		if (typeof data.BTC?.[code] === 'number' && data.BTC[code] > 0) {
			rates[code] = data.BTC[code]
		}
	}
	return { source: 'yadio', rates, fetchedAt: Date.now() }
}

export async function fetchCoinDeskRates(): Promise<SourceResult> {
	const instruments = SUPPORTED_FIAT.map((code) => `BTC-${code}`).join(',')
	const query = `market=ccix&instruments=${encodeURIComponent(instruments)}&groups=VALUE`
	const endpoints = [
		`https://data-api.coindesk.com/index/cc/v1/latest/tick?${query}`,
		`https://data-api.cryptocompare.com/index/cc/v1/latest/tick?${query}`,
	]

	let data: any = null
	let lastError: Error | null = null

	for (const url of endpoints) {
		try {
			const response = await fetchWithTimeout(url)
			if (!response.ok) {
				lastError = new Error(`CoinDesk HTTP ${response.status}`)
				continue
			}

			const parsed = await response.json()
			if (!parsed?.Data || typeof parsed.Data !== 'object') {
				lastError = new Error('CoinDesk: unexpected response format')
				continue
			}

			data = parsed
			break
		} catch (error) {
			lastError = error as Error
		}
	}

	if (!data) {
		throw lastError || new Error('CoinDesk: all endpoints failed')
	}

	const rates: Partial<Record<FiatCode, number>> = {}
	for (const code of SUPPORTED_FIAT) {
		const instrument = `BTC-${code}`
		const value = data.Data?.[instrument]?.VALUE
		if (typeof value === 'number' && value > 0) {
			rates[code] = value
		}
	}
	return { source: 'coindesk', rates, fetchedAt: Date.now() }
}

export async function fetchBinanceRates(): Promise<SourceResult> {
	const response = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
	if (!response.ok) throw new Error(`Binance HTTP ${response.status}`)
	const data = await response.json()
	if (typeof data.price !== 'string') throw new Error('Binance: unexpected response format')
	const btcUsd = parseFloat(data.price)
	if (!btcUsd || btcUsd <= 0) throw new Error('Binance: invalid price')

	const crossPairs: Array<{ from: string; to: string; fiat: FiatCode }> = [
		{ from: 'BTC', to: 'EUR', fiat: 'EUR' },
		{ from: 'BTC', to: 'GBP', fiat: 'GBP' },
		{ from: 'BTC', to: 'JPY', fiat: 'JPY' },
		{ from: 'BTC', to: 'BRL', fiat: 'BRL' },
		{ from: 'BTC', to: 'ARS', fiat: 'ARS' },
		{ from: 'BTC', to: 'TRY', fiat: 'TRY' },
		{ from: 'BTC', to: 'RUB', fiat: 'RUB' },
		{ from: 'BTC', to: 'CHF', fiat: 'CHF' },
		{ from: 'BTC', to: 'AUD', fiat: 'AUD' },
		{ from: 'BTC', to: 'CAD', fiat: 'CAD' },
		{ from: 'BTC', to: 'SGD', fiat: 'SGD' },
		{ from: 'BTC', to: 'HKD', fiat: 'HKD' },
		{ from: 'BTC', to: 'INR', fiat: 'INR' },
		{ from: 'BTC', to: 'MXN', fiat: 'MXN' },
		{ from: 'BTC', to: 'KRW', fiat: 'KRW' },
		{ from: 'BTC', to: 'ZAR', fiat: 'ZAR' },
		{ from: 'BTC', to: 'PHP', fiat: 'PHP' },
		{ from: 'BTC', to: 'THB', fiat: 'THB' },
		{ from: 'BTC', to: 'IDR', fiat: 'IDR' },
		{ from: 'BTC', to: 'NGN', fiat: 'NGN' },
	]

	const rates: Partial<Record<FiatCode, number>> = { USD: btcUsd }

	const pairPromises = crossPairs.map(async ({ from, to, fiat }) => {
		try {
			const resp = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${from}${to}`)
			if (!resp.ok) return
			const d = await resp.json()
			const price = parseFloat(d.price)
			if (price > 0) rates[fiat] = price
		} catch {
			// skip failed cross pairs
		}
	})

	await Promise.allSettled(pairPromises)
	return { source: 'binance', rates, fetchedAt: Date.now() }
}

export async function fetchCoinGeckoRates(): Promise<SourceResult> {
	const response = await fetchWithTimeout(
		'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd%2Ceur%2Cjpy%2Cgbp%2Cchf%2Ccny%2Caud%2Ccad%2Chkd%2Csgd%2Cinr%2Cmxn%2Crub%2Cbrl%2Ctry%2Ckrw%2Czar%2Cars%2Cclp%2Ccop%2Cpen%2Cuyu%2Cphp%2Cthb%2Cidr%2Cmyr%2Cngn',
	)
	if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`)
	const data = await response.json()
	const btc = data.bitcoin
	if (!btc || typeof btc !== 'object') throw new Error('CoinGecko: unexpected response format')

	const rates: Partial<Record<FiatCode, number>> = {}
	for (const code of SUPPORTED_FIAT) {
		const lower = code.toLowerCase()
		if (typeof btc[lower] === 'number' && btc[lower] > 0) {
			rates[code] = btc[lower]
		}
	}
	return { source: 'coingecko', rates, fetchedAt: Date.now() }
}

function median(values: number[]): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface AggregatedRates {
	rates: Record<FiatCode, number>
	sources: string[]
	fetchedAt: number
	sourcesSucceeded: string[]
	sourcesFailed: string[]
	cached?: boolean
}

export async function fetchAllSources(): Promise<AggregatedRates> {
	const fetchers = [
		{ name: 'yadio', fn: fetchYadioRates },
		{ name: 'coindesk', fn: fetchCoinDeskRates },
		{ name: 'binance', fn: fetchBinanceRates },
		{ name: 'coingecko', fn: fetchCoinGeckoRates },
	]

	const results = await Promise.allSettled(fetchers.map(async ({ name, fn }) => ({ name, result: await fn() })))

	const succeeded: SourceResult[] = []
	const sourcesSucceeded: string[] = []
	const sourcesFailed: string[] = []

	for (const r of results) {
		if (r.status === 'fulfilled') {
			succeeded.push(r.value.result)
			sourcesSucceeded.push(r.value.name)
		} else {
			sourcesFailed.push(r.reason?.message || 'unknown')
		}
	}

	const ratesByCurrency: Record<string, number[]> = {}
	for (const s of succeeded) {
		for (const [currency, price] of Object.entries(s.rates)) {
			if (!ratesByCurrency[currency]) ratesByCurrency[currency] = []
			ratesByCurrency[currency].push(price)
		}
	}

	const aggregated: Record<FiatCode, number> = {} as Record<FiatCode, number>
	for (const code of SUPPORTED_FIAT) {
		const values = ratesByCurrency[code]
		if (values && values.length > 0) {
			aggregated[code] = median(values)
		}
	}

	if (Object.keys(aggregated).length === 0) {
		throw new Error(`All ${fetchers.length} price sources failed: ${sourcesFailed.join(', ')}`)
	}

	return {
		rates: aggregated,
		sources: fetchers.map((f) => f.name),
		fetchedAt: Date.now(),
		sourcesSucceeded,
		sourcesFailed,
	}
}

export { SUPPORTED_FIAT }
export type { FiatCode }
