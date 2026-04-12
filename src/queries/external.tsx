import { queryOptions, useQuery } from '@tanstack/react-query'
import { currencyKeys } from './queryKeyFactory'
import { CURRENCIES } from '@/lib/constants'
import { CVM_SERVER_PUBKEY, getCurrencyServerRelays } from '@/lib/constants'
import { configStore } from '@/lib/stores/config'

const numSatsInBtc = 100000000
export type SupportedCurrency = (typeof CURRENCIES)[number]

export const CURRENCY_CACHE_CONFIG = {
	STALE_TIME: 1000 * 60 * 5,
	RETRY_DELAY: 1000,
	RETRY_COUNT: 2,
	RESOLVE_TIMEOUT: 5000,
} as const

let currencyClient: InstanceType<typeof import('@/lib/ctxcn-client').PlebianCurrencyClient> | null = null
let currencyClientInitPromise: Promise<any> | null = null

async function getCurrencyClient() {
	if (currencyClient) return currencyClient
	if (currencyClientInitPromise) return currencyClientInitPromise

	currencyClientInitPromise = (async () => {
		try {
			const { PlebianCurrencyClient } = await import('@/lib/ctxcn-client')

			const privateKey = crypto.getRandomValues(new Uint8Array(32))

			const mainRelay = typeof window !== 'undefined' ? await getMainRelayFromConfig() : undefined
			const cvmRelays = getCurrencyServerRelays()
			const relays = mainRelay ? [mainRelay, ...cvmRelays] : cvmRelays

			const client = new PlebianCurrencyClient({
				privateKey,
				relays,
				serverPubkey: configStore.state.config.cvmServerPubkey || CVM_SERVER_PUBKEY,
			})

			currencyClient = client
			return client
		} catch (error) {
			console.warn('Failed to initialize ContextVM currency client:', error)
			currencyClientInitPromise = null
			return null
		}
	})()

	return currencyClientInitPromise
}

async function getMainRelayFromConfig(): Promise<string | undefined> {
	try {
		const { configStore } = await import('@/lib/stores/config')
		return configStore.state.config.appRelay
	} catch {
		return undefined
	}
}

const CONTEXTVM_CALL_TIMEOUT = 5000

async function fetchFromContextVm(): Promise<Record<string, number> | null> {
	try {
		const client = await getCurrencyClient()
		if (!client) return null

		const startedAt = Date.now()
		console.info(`ContextVM BTC fetch starting (timeout ${CONTEXTVM_CALL_TIMEOUT}ms)`)
		const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CONTEXTVM_CALL_TIMEOUT))
		const callPromise = client.callTool({
			name: 'get_btc_price',
			arguments: {},
		})

		const result = await Promise.race([callPromise, timeout])
		if (result === null) {
			console.warn(`ContextVM call timed out after ${Date.now() - startedAt}ms`)
			return null
		}

		if (!result?.rates || result.error) {
			console.warn('ContextVM returned error:', result?.error ?? 'missing rates')
			return null
		}

		console.info(`ContextVM BTC fetch succeeded in ${Date.now() - startedAt}ms`)
		return result.rates as Record<string, number>
	} catch (error) {
		console.warn('ContextVM fetch failed:', error)
		return null
	}
}

export const fetchBtcExchangeRates = async (): Promise<Record<SupportedCurrency, number>> => {
	let rates: Record<string, number> | null = null

	rates = await fetchFromContextVm()

	if (!rates) {
		console.info('Falling back to Yadio BTC rates')
		try {
			const response = await fetch('https://api.yadio.io/exrates/BTC')
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}
			const data = await response.json()
			rates = data.BTC
		} catch (error) {
			console.error('Failed to fetch BTC exchange rates (ContextVM + Yadio fallback):', error)
			throw new Error('Failed to fetch BTC exchange rates')
		}
	}

	return rates as Record<SupportedCurrency, number>
}

export const fetchCurrencyExchangeRate = async (currency: SupportedCurrency): Promise<number> => {
	const rates = await fetchBtcExchangeRates()
	if (!rates || !rates[currency]) {
		throw new Error(`Exchange rate not available for ${currency}`)
	}
	return rates[currency]
}

export const convertCurrencyToSats = async (currency: string, amount: number): Promise<number | null> => {
	if (!currency || !amount || amount <= 0.0001) return null

	if (['sats', 'sat'].includes(currency.toLowerCase())) {
		return amount
	}

	try {
		const normalizedCurrency = currency.toUpperCase()

		if (CURRENCIES.includes(normalizedCurrency as SupportedCurrency)) {
			const rate = await fetchCurrencyExchangeRate(normalizedCurrency as SupportedCurrency)

			return (amount / rate) * numSatsInBtc
		} else {
			console.warn(`Unsupported currency: ${currency}`)
			return null
		}
	} catch (error) {
		console.error(`Currency conversion failed for ${currency}:`, error)
		return null
	}
}

export const btcExchangeRatesQueryOptions = queryOptions({
	queryKey: currencyKeys.btc(),
	queryFn: fetchBtcExchangeRates,
	staleTime: CURRENCY_CACHE_CONFIG.STALE_TIME,
})

export const currencyExchangeRateQueryOptions = (currency: SupportedCurrency) =>
	queryOptions({
		queryKey: currencyKeys.forCurrency(currency),
		queryFn: () => fetchCurrencyExchangeRate(currency),
		staleTime: CURRENCY_CACHE_CONFIG.STALE_TIME,
		retry: CURRENCY_CACHE_CONFIG.RETRY_COUNT,
		retryDelay: CURRENCY_CACHE_CONFIG.RETRY_DELAY,
	})

export const currencyConversionQueryOptions = (currency: string, amount: number) =>
	queryOptions({
		queryKey: currencyKeys.conversion(currency, amount),
		queryFn: () => convertCurrencyToSats(currency, amount),
		enabled: Boolean(currency && amount > 0),
		staleTime: CURRENCY_CACHE_CONFIG.STALE_TIME,
		retry: CURRENCY_CACHE_CONFIG.RETRY_COUNT,
	})

export const useBtcExchangeRates = () => {
	return useQuery(btcExchangeRatesQueryOptions)
}

export const useCurrencyExchangeRate = (currency: SupportedCurrency) => {
	return useQuery(currencyExchangeRateQueryOptions(currency))
}

export const useCurrencyConversion = (currency: string, amount: number) => {
	return useQuery(currencyConversionQueryOptions(currency, amount))
}

export const createCurrencyConversionQuery = (fromCurrency: string, amount: number) =>
	useQuery(currencyConversionQueryOptions(fromCurrency, amount))
