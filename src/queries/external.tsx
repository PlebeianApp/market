import { queryOptions, useQuery } from '@tanstack/react-query'
import { currencyKeys } from './queryKeyFactory'
import { CURRENCIES } from '@/lib/constants'

// Constants
const numSatsInBtc = 100000000
export type SupportedCurrency = (typeof CURRENCIES)[number]

// Configuration for currency exchange rate fetching
export const CURRENCY_CACHE_CONFIG = {
	STALE_TIME: 1000 * 60 * 5, // 5 minutes
	RETRY_DELAY: 1000,
	RETRY_COUNT: 2,
	RESOLVE_TIMEOUT: 5000,
} as const

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches BTC exchange rates against other currencies
 * @returns Record of currency exchange rates with BTC
 */
export const fetchBtcExchangeRates = async (): Promise<Record<SupportedCurrency, number>> => {
	try {
		const response = await fetch('https://api.yadio.io/exrates/BTC')
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}
		const data = await response.json()
		return data.BTC
	} catch (error) {
		console.error('Failed to fetch BTC exchange rates:', error)
		throw new Error('Failed to fetch BTC exchange rates')
	}
}

/**
 * Fetches the exchange rate for a specific currency
 * @param currency The currency code (e.g., 'USD', 'EUR')
 * @returns The exchange rate value
 */
export const fetchCurrencyExchangeRate = async (currency: SupportedCurrency): Promise<number> => {
	const rates = await fetchBtcExchangeRates()
	if (!rates || !rates[currency]) {
		throw new Error(`Exchange rate not available for ${currency}`)
	}
	return rates[currency]
}

/**
 * Converts an amount from a specified currency to sats
 * @param currency The source currency
 * @param amount The amount to convert
 * @returns The equivalent amount in sats
 */
export const convertCurrencyToSats = async (currency: string, amount: number): Promise<number | null> => {
	// Skip conversion if amount is too small or currency is not provided
	if (!currency || !amount || amount <= 0.0001) return null

	// If already in sats, return the amount directly
	if (['sats', 'sat'].includes(currency.toLowerCase())) {
		return amount
	}

	try {
		// For supported currencies, fetch the exchange rate and convert
		if (CURRENCIES.includes(currency as SupportedCurrency)) {
			const rate = await fetchCurrencyExchangeRate(currency as SupportedCurrency)

			// Convert to sats: (amount / exchange rate) * sats in 1 BTC
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

// --- REACT QUERY OPTIONS ---

/**
 * React Query options for fetching BTC exchange rates
 */
export const btcExchangeRatesQueryOptions = queryOptions({
	queryKey: currencyKeys.btc(),
	queryFn: fetchBtcExchangeRates,
	staleTime: CURRENCY_CACHE_CONFIG.STALE_TIME,
})

/**
 * React Query options for fetching a specific currency exchange rate
 * @param currency The currency code
 */
export const currencyExchangeRateQueryOptions = (currency: SupportedCurrency) =>
	queryOptions({
		queryKey: currencyKeys.forCurrency(currency),
		queryFn: () => fetchCurrencyExchangeRate(currency),
		staleTime: CURRENCY_CACHE_CONFIG.STALE_TIME,
		retry: CURRENCY_CACHE_CONFIG.RETRY_COUNT,
		retryDelay: CURRENCY_CACHE_CONFIG.RETRY_DELAY,
	})

/**
 * React Query options for converting currency to sats
 * @param currency The source currency
 * @param amount The amount to convert
 */
export const currencyConversionQueryOptions = (currency: string, amount: number) =>
	queryOptions({
		queryKey: currencyKeys.conversion(currency, amount),
		queryFn: () => convertCurrencyToSats(currency, amount),
		enabled: Boolean(currency && amount > 0),
		staleTime: CURRENCY_CACHE_CONFIG.STALE_TIME,
		retry: CURRENCY_CACHE_CONFIG.RETRY_COUNT,
	})

// --- REACT QUERY HOOKS ---

/**
 * Hook to get all BTC exchange rates
 * @returns Query result with exchange rates
 */
export const useBtcExchangeRates = () => {
	return useQuery(btcExchangeRatesQueryOptions)
}

/**
 * Hook to get a specific currency exchange rate
 * @param currency The currency code
 * @returns Query result with the exchange rate
 */
export const useCurrencyExchangeRate = (currency: SupportedCurrency) => {
	return useQuery(currencyExchangeRateQueryOptions(currency))
}

/**
 * Hook to convert an amount from one currency to sats
 * @param currency The source currency
 * @param amount The amount to convert
 * @returns Query result with the converted amount in sats
 */
export const useCurrencyConversion = (currency: string, amount: number) => {
	return useQuery(currencyConversionQueryOptions(currency, amount))
}

/**
 * Creates a query to convert currency to sats
 * This matches the exact function signature from the template
 */
export const createCurrencyConversionQuery = (fromCurrency: string, amount: number) =>
	useQuery(currencyConversionQueryOptions(fromCurrency, amount))
