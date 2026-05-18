import { z } from 'zod'

export const getBtcPriceInputSchema = {
	refresh: z.boolean().optional().default(false).describe('Force refresh of rates, bypassing the server cache'),
}

export const getBtcPriceOutputSchema = {
	rates: z.record(z.string(), z.number()).describe('BTC exchange rates per fiat currency'),
	sourcesSucceeded: z.array(z.string()).describe('Price sources that returned successfully'),
	sourcesFailed: z.array(z.string()).describe('Price sources that failed'),
	fetchedAt: z.number().describe('Unix timestamp (ms) when rates were fetched'),
	cached: z.boolean().describe('Whether the returned rates were served from cache'),
}

export const getBtcPriceSingleInputSchema = {
	currency: z.string().describe('ISO 4217 currency code, e.g. USD, EUR, JPY'),
	refresh: z.boolean().optional().default(false).describe('Force refresh of rates, bypassing the server cache'),
}

export const getBtcPriceSingleOutputSchema = {
	currency: z.string().describe('The requested currency code'),
	rate: z.number().describe('BTC exchange rate for the requested currency'),
	fetchedAt: z.number().describe('Unix timestamp (ms) when rates were fetched'),
	cached: z.boolean().describe('Whether the returned rate was served from cache'),
}
